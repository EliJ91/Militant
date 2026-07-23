import { fetchLootLogBundle, fetchLootLogBundles } from './lootLogApi';
import { fetchSiphonedEnergyMembers } from './siphonedEnergyApi';
import { applyLootDeathChecks, buildLootMonitorReportFromEvents } from '../utils/lootMonitor';

const DETAIL_FETCH_CONCURRENCY = 4;

function normalizePlayerName(value) {
  return String(value || '').trim().toLowerCase();
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isMilitantGuild(value) {
  return String(value || '')
    .split(',')
    .some((guild) => normalizePlayerName(guild) === 'militant');
}

function createPlayerHistoryRecord({ playerId = '', playerName = '' } = {}) {
  const cleanPlayerName = String(playerName || '').trim();
  return {
    averageItemsLootedPerCta: 0,
    ctas: [],
    ctaCount: 0,
    itemsKept: 0,
    itemsLooted: 0,
    itemsLost: 0,
    lastCtaAt: '',
    playerId,
    playerKey: normalizePlayerName(cleanPlayerName),
    playerName: cleanPlayerName,
  };
}

export function buildPlayerHistory(members = [], bundles = []) {
  const historyByPlayer = new Map();

  members.forEach((member) => {
    const playerName = String(member?.playerName || '').trim();
    const playerKey = normalizePlayerName(playerName);
    if (!playerKey || historyByPlayer.has(playerKey)) return;
    historyByPlayer.set(playerKey, createPlayerHistoryRecord({
      playerId: member.playerId || '',
      playerName,
    }));
  });

  bundles.forEach((bundle) => {
    const rows = Array.isArray(bundle?.summary?.rows) ? bundle.summary.rows : [];
    rows.forEach((row) => {
      const playerName = String(row?.player || '').trim();
      const playerKey = normalizePlayerName(playerName);
      if (!playerKey || historyByPlayer.has(playerKey) || !isMilitantGuild(row?.guild)) return;
      historyByPlayer.set(playerKey, createPlayerHistoryRecord({ playerName }));
    });
  });

  bundles.forEach((bundle) => {
    const participatingPlayers = new Set();
    const rows = Array.isArray(bundle?.summary?.rows) ? bundle.summary.rows : [];

    rows.forEach((row) => {
      const playerKey = normalizePlayerName(row?.player);
      const player = historyByPlayer.get(playerKey);
      if (!player) return;

      player.itemsLooted += numericValue(row.looted);
      player.itemsLost += numericValue(row.lost);
      participatingPlayers.add(playerKey);
    });

    participatingPlayers.forEach((playerKey) => {
      const player = historyByPlayer.get(playerKey);
      player.ctaCount += 1;
      const ctaAt = String(bundle.startAt || bundle.createdAt || '');
      if (ctaAt && (!player.lastCtaAt || new Date(ctaAt) > new Date(player.lastCtaAt))) {
        player.lastCtaAt = ctaAt;
      }
    });

    if (!bundle.hasChestLog) return;
    const keptItemsByPlayer = new Map();
    const finalizedRows = Array.isArray(bundle.finalizedRows) ? bundle.finalizedRows : [];
    finalizedRows.forEach((row) => {
      const playerKey = normalizePlayerName(row?.player);
      const player = historyByPlayer.get(playerKey);
      const keptQuantity = numericValue(row?.kept);
      if (!player || keptQuantity <= 0) return;
      player.itemsKept += keptQuantity;
      const itemsKept = keptItemsByPlayer.get(playerKey) || [];
      itemsKept.push({
        enchantment: numericValue(row.enchantment),
        item: String(row.item || row.itemId || 'Unknown Item').trim(),
        itemId: String(row.itemId || '').trim(),
        quantity: keptQuantity,
      });
      keptItemsByPlayer.set(playerKey, itemsKept);
    });

    keptItemsByPlayer.forEach((itemsKept, playerKey) => {
      const player = historyByPlayer.get(playerKey);
      player.ctas.push({
        bundleId: String(bundle.id || ''),
        date: String(bundle.startAt || bundle.createdAt || ''),
        itemsKept: itemsKept.sort((left, right) => (
          right.quantity - left.quantity || left.item.localeCompare(right.item)
        )),
        lootLogTitle: String(bundle.lootFileName || bundle.summary?.displayLootFileName || 'Loot Log').trim(),
      });
    });
  });

  return [...historyByPlayer.values()].map((player) => ({
    ...player,
    averageItemsLootedPerCta: player.ctaCount ? player.itemsLooted / player.ctaCount : 0,
    ctas: player.ctas.sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0)),
  })).sort((left, right) => (
    right.ctaCount - left.ctaCount
    || right.itemsLooted - left.itemsLooted
    || left.playerName.localeCompare(right.playerName)
  ));
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

async function loadFinalizedChestRows(bundle) {
  if (!bundle?.hasChestLog || !bundle?.id) return { ...bundle, finalizedRows: [] };
  const result = await fetchLootLogBundle(bundle.id);
  const detail = result?.bundle || {};
  const chestLogText = detail.chestLogReportText || detail.chestLogText || '';
  if (!detail.hasChestLog || !String(chestLogText).trim()) {
    return { ...bundle, finalizedRows: [], hasChestLog: false };
  }
  const baseReport = buildLootMonitorReportFromEvents(
    detail.events || [],
    chestLogText,
    { endAt: detail.endAt || bundle.endAt, startAt: detail.startAt || bundle.startAt },
  );
  const hasComparableChestData = (baseReport?.chest?.rows?.length || 0) > 0
    || (baseReport?.chest?.withdrawals?.length || 0) > 0;
  if (!hasComparableChestData) {
    return { ...bundle, finalizedRows: [], hasChestLog: false };
  }
  const finalizedReport = applyLootDeathChecks(baseReport, detail.deathChecks || []);
  return {
    ...bundle,
    finalizedRows: finalizedReport?.rows || [],
  };
}

export async function fetchPlayerHistory() {
  const [memberResult, lootLogResult] = await Promise.all([
    fetchSiphonedEnergyMembers(),
    fetchLootLogBundles(),
  ]);

  const members = Array.isArray(memberResult?.members) ? memberResult.members : [];
  const bundles = Array.isArray(lootLogResult?.bundles) ? lootLogResult.bundles : [];
  const finalizedBundles = await mapWithConcurrency(bundles, DETAIL_FETCH_CONCURRENCY, loadFinalizedChestRows);
  return {
    players: buildPlayerHistory(members, finalizedBundles),
    updatedAt: new Date().toISOString(),
  };
}

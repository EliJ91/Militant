import { fetchLootLogBundles } from './lootLogApi';
import { fetchSiphonedEnergyMembers } from './siphonedEnergyApi';

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
    averageItemsKeptPerCta: 0,
    averageItemsLootedPerCta: 0,
    ctaCount: 0,
    itemsKept: 0,
    itemsLooted: 0,
    itemsLost: 0,
    lastCtaAt: '',
    playerId,
    playerKey: normalizePlayerName(cleanPlayerName),
    playerName: cleanPlayerName,
    uniqueItemsLooted: 0,
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

  const uniqueItemsByPlayer = new Map();
  bundles.forEach((bundle) => {
    const participatingPlayers = new Set();
    const rows = Array.isArray(bundle?.summary?.rows) ? bundle.summary.rows : [];

    rows.forEach((row) => {
      const playerKey = normalizePlayerName(row?.player);
      const player = historyByPlayer.get(playerKey);
      if (!player) return;

      player.itemsLooted += numericValue(row.looted);
      player.itemsKept += numericValue(row.kept);
      player.itemsLost += numericValue(row.lost);
      participatingPlayers.add(playerKey);

      const itemKey = String(row.itemId || row.item || '').trim().toLowerCase();
      if (itemKey && numericValue(row.looted) > 0) {
        const items = uniqueItemsByPlayer.get(playerKey) || new Set();
        items.add(itemKey);
        uniqueItemsByPlayer.set(playerKey, items);
      }
    });

    participatingPlayers.forEach((playerKey) => {
      const player = historyByPlayer.get(playerKey);
      player.ctaCount += 1;
      const ctaAt = String(bundle.startAt || bundle.createdAt || '');
      if (ctaAt && (!player.lastCtaAt || new Date(ctaAt) > new Date(player.lastCtaAt))) {
        player.lastCtaAt = ctaAt;
      }
    });
  });

  return [...historyByPlayer.values()].map((player) => ({
    ...player,
    averageItemsKeptPerCta: player.ctaCount ? player.itemsKept / player.ctaCount : 0,
    averageItemsLootedPerCta: player.ctaCount ? player.itemsLooted / player.ctaCount : 0,
    uniqueItemsLooted: uniqueItemsByPlayer.get(player.playerKey)?.size || 0,
  })).sort((left, right) => (
    right.ctaCount - left.ctaCount
    || right.itemsLooted - left.itemsLooted
    || left.playerName.localeCompare(right.playerName)
  ));
}

export async function fetchPlayerHistory() {
  const [memberResult, lootLogResult] = await Promise.all([
    fetchSiphonedEnergyMembers(),
    fetchLootLogBundles(),
  ]);

  const members = Array.isArray(memberResult?.members) ? memberResult.members : [];
  const bundles = Array.isArray(lootLogResult?.bundles) ? lootLogResult.bundles : [];
  return {
    players: buildPlayerHistory(members, bundles),
    updatedAt: new Date().toISOString(),
  };
}

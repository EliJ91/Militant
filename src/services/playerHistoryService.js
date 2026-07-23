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
    ctas: [],
    ctaCount: 0,
    ctaCountWithChestLog: 0,
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
    const keptItemsByPlayer = new Map();
    const hasChestLog = Boolean(bundle?.hasChestLog);
    const rows = Array.isArray(bundle?.summary?.rows) ? bundle.summary.rows : [];

    rows.forEach((row) => {
      const playerKey = normalizePlayerName(row?.player);
      const player = historyByPlayer.get(playerKey);
      if (!player) return;

      player.itemsLooted += numericValue(row.looted);
      if (hasChestLog) player.itemsKept += numericValue(row.kept);
      player.itemsLost += numericValue(row.lost);
      participatingPlayers.add(playerKey);

      const keptQuantity = numericValue(row.kept);
      if (hasChestLog && keptQuantity > 0) {
        const keptItems = keptItemsByPlayer.get(playerKey) || [];
        keptItems.push({
          enchantment: numericValue(row.enchantment),
          item: String(row.item || row.itemId || 'Unknown Item').trim(),
          itemId: String(row.itemId || '').trim(),
          quantity: keptQuantity,
        });
        keptItemsByPlayer.set(playerKey, keptItems);
      }

    });

    participatingPlayers.forEach((playerKey) => {
      const player = historyByPlayer.get(playerKey);
      player.ctaCount += 1;
      if (hasChestLog) player.ctaCountWithChestLog += 1;
      const ctaAt = String(bundle.startAt || bundle.createdAt || '');
      if (ctaAt && (!player.lastCtaAt || new Date(ctaAt) > new Date(player.lastCtaAt))) {
        player.lastCtaAt = ctaAt;
      }
      const itemsKept = keptItemsByPlayer.get(playerKey) || [];
      if (itemsKept.length > 0) {
        player.ctas.push({
          bundleId: String(bundle.id || ''),
          date: ctaAt,
          itemsKept: itemsKept.sort((left, right) => (
            right.quantity - left.quantity || left.item.localeCompare(right.item)
          )),
          lootLogTitle: String(bundle.lootFileName || bundle.summary?.displayLootFileName || 'Loot Log').trim(),
        });
      }
    });
  });

  return [...historyByPlayer.values()].map((player) => ({
    ...player,
    averageItemsKeptPerCta: player.ctaCountWithChestLog ? player.itemsKept / player.ctaCountWithChestLog : 0,
    averageItemsLootedPerCta: player.ctaCount ? player.itemsLooted / player.ctaCount : 0,
    ctas: player.ctas.sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0)),
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

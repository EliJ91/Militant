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

export function createPlayerHistoryRecord({ playerId = '', playerName = '' } = {}) {
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
    const playerName = String(member?.playerName || member?.player_name || '').trim();
    const playerKey = normalizePlayerName(playerName);
    if (!playerKey || historyByPlayer.has(playerKey)) return;
    historyByPlayer.set(playerKey, createPlayerHistoryRecord({
      playerId: member.playerId || member.player_id || '',
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
    const ctaStatsByPlayer = new Map();
    const rows = Array.isArray(bundle?.summary?.rows) ? bundle.summary.rows : [];

    rows.forEach((row) => {
      const playerKey = normalizePlayerName(row?.player);
      const player = historyByPlayer.get(playerKey);
      if (!player) return;
      const looted = numericValue(row.looted);
      const lost = numericValue(row.lost);
      player.itemsLooted += looted;
      player.itemsLost += lost;
      const ctaStats = ctaStatsByPlayer.get(playerKey) || {
        itemsKept: 0,
        itemsKeptList: [],
        itemsLooted: 0,
        itemsLost: 0,
      };
      ctaStats.itemsLooted += looted;
      ctaStats.itemsLost += lost;
      ctaStatsByPlayer.set(playerKey, ctaStats);
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

    if (bundle.hasChestLog) {
      const finalizedRows = Array.isArray(bundle.finalizedRows) ? bundle.finalizedRows : [];
      finalizedRows.forEach((row) => {
        const playerKey = normalizePlayerName(row?.player);
        const player = historyByPlayer.get(playerKey);
        const keptQuantity = numericValue(row?.kept);
        if (!player || keptQuantity <= 0) return;
        player.itemsKept += keptQuantity;
        const ctaStats = ctaStatsByPlayer.get(playerKey) || {
          itemsKept: 0,
          itemsKeptList: [],
          itemsLooted: 0,
          itemsLost: 0,
        };
        ctaStats.itemsKept += keptQuantity;
        ctaStats.itemsKeptList.push({
          enchantment: numericValue(row.enchantment),
          item: String(row.item || row.itemId || 'Unknown Item').trim(),
          itemId: String(row.itemId || '').trim(),
          quantity: keptQuantity,
        });
        ctaStatsByPlayer.set(playerKey, ctaStats);
      });
    }

    ctaStatsByPlayer.forEach((ctaStats, playerKey) => {
      const player = historyByPlayer.get(playerKey);
      if (!player || !participatingPlayers.has(playerKey)) return;
      player.ctas.push({
        averageItemsLootedPerCta: ctaStats.itemsLooted,
        bundleId: String(bundle.id || ''),
        date: String(bundle.startAt || bundle.createdAt || ''),
        ctaCount: 1,
        itemsKept: ctaStats.itemsKept,
        itemsKeptList: ctaStats.itemsKeptList.sort((left, right) => (
          right.quantity - left.quantity || left.item.localeCompare(right.item)
        )),
        itemsLooted: ctaStats.itemsLooted,
        itemsLost: ctaStats.itemsLost,
        lastCtaAt: String(bundle.startAt || bundle.createdAt || ''),
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

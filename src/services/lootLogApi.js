const DEFAULT_LOOT_LOG_API_URL = '/api/loot-logs';
import { recordActionLog } from './actionLogsApi';

function getLootLogApiUrl() {
  if (import.meta.env.PROD) {
    return import.meta.env.VITE_PRODUCTION_LOOT_LOG_API_URL || DEFAULT_LOOT_LOG_API_URL;
  }

  return import.meta.env.VITE_LOCAL_LOOT_LOG_API_URL || DEFAULT_LOOT_LOG_API_URL;
}

export async function submitLootLog({ bundleId = null, lootLogText, originalFileName, username }) {
  const response = await fetch(getLootLogApiUrl(), {
    body: JSON.stringify({
      bundleId,
      lootLogText,
      originalFileName,
      username,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Could not upload loot log.');
  }

  void recordActionLog({
    action: 'Loot log uploaded',
    details: { fileName: originalFileName, source: 'webapp' },
    targetId: result.bundleId || bundleId,
    targetName: result.lootFileName || result.summary?.displayLootFileName || originalFileName,
    targetType: 'loot-log',
  });

  return result;
}

export async function submitChestLog({ bundleId, chestLogText, username }) {
  const response = await fetch(getLootLogApiUrl(), {
    body: JSON.stringify({
      action: 'chest',
      bundleId,
      chestLogText,
      username,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Could not upload chest log.');
  }

  void recordActionLog({
    action: 'Chest log uploaded',
    targetId: result.bundleId || bundleId,
    targetName: result.fileName || 'Chest log',
    targetType: 'chest-log',
  });

  return result;
}

export async function mergeLootLogBundles({ bundleIds, username }) {
  const response = await fetch(getLootLogApiUrl(), {
    body: JSON.stringify({
      action: 'merge',
      bundleIds,
      username,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Could not merge loot logs.');
  }

  void recordActionLog({
    action: 'Loot logs merged',
    details: { count: bundleIds.length, sourceBundleIds: bundleIds },
    targetId: result.bundleId,
    targetName: result.lootFileName || 'Merged loot log',
    targetType: 'loot-log',
  });

  return result;
}

export async function checkLootLogDeath({ bundleId, keptItems, player }) {
  const response = await fetch(getLootLogApiUrl(), {
    body: JSON.stringify({
      action: 'death-check',
      bundleId,
      keptItems,
      player,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Could not check the player death log.');
  }

  void recordActionLog({
    action: 'Death check completed',
    details: { player, status: result.deathCheck?.status || 'checked' },
    targetId: bundleId,
    targetName: player,
    targetType: 'death-check',
  });

  return result;
}

export async function checkLootLogDeaths({ bundleId, checks }) {
  const response = await fetch(getLootLogApiUrl(), {
    body: JSON.stringify({
      action: 'death-check-batch',
      bundleId,
      checks,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Could not check the visible player deaths.');
  }

  void recordActionLog({
    action: 'Death checks completed',
    details: { count: checks.length },
    targetId: bundleId,
    targetName: `${checks.length} players`,
    targetType: 'death-check',
  });

  return result;
}

export async function deleteLootLogBundle(bundleId) {
  const response = await fetch(getLootLogApiUrl(), {
    body: JSON.stringify({ bundleId }),
    headers: { 'Content-Type': 'application/json' },
    method: 'DELETE',
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Could not delete loot log.');
  }

  void recordActionLog({
    action: 'Loot log deleted',
    targetId: bundleId,
    targetName: result.lootFileName || bundleId,
    targetType: 'loot-log',
  });

  return result;
}

export async function updateLootLogBundle({ bundleId, ctaHour, dateUtc, fileNames, submitters }) {
  const response = await fetch(getLootLogApiUrl(), {
    body: JSON.stringify({ bundleId, ctaHour, dateUtc, fileNames, submitters }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Could not update loot log.');
  }

  void recordActionLog({
    action: 'Loot log updated',
    details: { ctaHour, dateUtc },
    targetId: bundleId,
    targetName: result.displayLootFileName || fileNames?.baseName || fileNames?.loot || bundleId,
    targetType: 'loot-log',
  });

  return result;
}

export async function fetchLootLogBundles() {
  const response = await fetch(getLootLogApiUrl());
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Could not load loot logs.');
  }

  return result;
}

export async function fetchLootLogBundle(bundleId) {
  const requestUrl = new URL(getLootLogApiUrl(), window.location.href);
  requestUrl.searchParams.set('bundleId', bundleId);
  const response = await fetch(requestUrl);
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Could not load the selected loot log.');
  }

  return result;
}

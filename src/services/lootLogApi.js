const DEFAULT_LOOT_LOG_API_URL = '/api/loot-logs';
const PUBLIC_LOOT_LOG_SHARE_URL = 'https://militant-discord-interactions.ejjernigan.workers.dev/share/loot-log';
import { recordActionLog } from './actionLogsApi';

function getLootLogApiUrl() {
  if (import.meta.env.PROD) {
    return import.meta.env.VITE_PRODUCTION_LOOT_LOG_API_URL || DEFAULT_LOOT_LOG_API_URL;
  }

  return import.meta.env.VITE_LOCAL_LOOT_LOG_API_URL || DEFAULT_LOOT_LOG_API_URL;
}

export function buildLootLogShareUrl(bundleId, filterQuery = '') {
  const shareUrl = new URL(
    import.meta.env.VITE_PRODUCTION_LOOT_LOG_SHARE_URL || PUBLIC_LOOT_LOG_SHARE_URL,
  );
  shareUrl.searchParams.set('bundle', String(bundleId || '').trim());
  const filterParams = new URLSearchParams(String(filterQuery || '').replace(/^\?/, ''));
  filterParams.forEach((value, key) => shareUrl.searchParams.append(key, value));
  return shareUrl;
}

export async function submitLootLog({
  actorName = username,
  bundleId = null,
  lootLogText,
  originalFileName,
  username,
}) {
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
    actorName,
    details: { fileName: originalFileName, source: 'webapp' },
    targetId: result.bundleId || bundleId,
    targetName: result.lootFileName || result.summary?.displayLootFileName || originalFileName,
    targetType: 'loot-log',
  });

  return result;
}

export async function submitChestLog({
  actorName = username,
  bundleId,
  chestLogText,
  lootLogName = '',
  username,
}) {
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
    actorName,
    details: { lootLogName },
    targetId: result.bundleId || bundleId,
    targetName: result.fileName || 'Chest log',
    targetType: 'chest-log',
  });

  return result;
}

export async function mergeLootLogBundles({ actorName = username, bundleIds, username }) {
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
    actorName,
    details: { count: bundleIds.length, sourceBundleIds: bundleIds },
    targetId: result.bundleId,
    targetName: result.lootFileName || 'Merged loot log',
    targetType: 'loot-log',
  });

  return result;
}

export async function checkLootLogDeath({
  actorName,
  bundleId,
  keptItems,
  lootLogName = '',
  player,
}) {
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
    actorName,
    details: {
      lootLogName,
      players: [player],
      status: result.deathCheck?.status || 'checked',
    },
    targetId: bundleId,
    targetName: lootLogName || player,
    targetType: 'death-check',
  });

  return result;
}

export async function checkLootLogDeaths({
  actorName,
  bundleId,
  checks,
  lootLogName = '',
}) {
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
    actorName,
    details: {
      count: checks.length,
      lootLogName,
      players: checks.map((check) => check.player).filter(Boolean),
      statuses: Array.isArray(result.deathChecks)
        ? result.deathChecks.map((check) => ({
          player: check.playerName || check.player,
          status: check.status,
        }))
        : [],
    },
    targetId: bundleId,
    targetName: lootLogName || `${checks.length} players`,
    targetType: 'death-check',
  });

  return result;
}

export async function deleteLootLogBundle(bundleId, { actorName, bundle = {} } = {}) {
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
    actorName,
    details: {
      lootLogDate: bundle.startAt || bundle.start_at || '',
      lootLogName: bundle.lootFileName || bundle.displayLootFileName || bundle.fileName || '',
      lootLogNumber: bundle.logNumber || null,
    },
    targetId: bundleId,
    targetName: bundle.lootFileName || bundle.displayLootFileName || bundle.fileName || result.lootFileName || bundleId,
    targetType: 'loot-log',
  });

  return result;
}

export async function deleteChestLogs(bundleId, { actorName, bundle = {} } = {}) {
  const response = await fetch(getLootLogApiUrl(), {
    body: JSON.stringify({ bundleId, deleteChestLogs: true }),
    headers: { 'Content-Type': 'application/json' },
    method: 'DELETE',
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Could not delete chest logs.');
  }

  void recordActionLog({
    action: 'Chest log deleted',
    actorName,
    details: {
      lootLogDate: bundle.startAt || bundle.start_at || '',
      lootLogName: bundle.lootFileName || bundle.displayLootFileName || bundle.fileName || '',
      lootLogNumber: bundle.logNumber || null,
    },
    targetId: bundleId,
    targetName: bundle.lootFileName || bundle.displayLootFileName || bundle.fileName || bundleId,
    targetType: 'chest-log',
  });

  return result;
}

export async function updateLootLogBundle({
  actorName,
  bundleId,
  ctaHour,
  dateUtc,
  fileNames,
  submitters,
}) {
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
    actorName,
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

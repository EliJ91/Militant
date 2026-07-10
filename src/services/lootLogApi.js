const DEFAULT_LOOT_LOG_API_URL = '/api/loot-logs';

export function getLootLogApiUrl() {
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

  return result;
}

export async function clearLootLogDeath({ bundleId, player }) {
  const response = await fetch(getLootLogApiUrl(), {
    body: JSON.stringify({
      action: 'clear-death-check',
      bundleId,
      player,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Could not remove the saved death check.');
  }

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

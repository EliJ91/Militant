const DEFAULT_API_URL = '/api/action-logs';
const PRODUCTION_API_URL = 'https://maeljnrgffgrljqusnre.supabase.co/functions/v1/action-logs';

let currentActorName = 'Unknown User';

function getActionLogsApiUrl() {
  if (import.meta.env.PROD) {
    return import.meta.env.VITE_PRODUCTION_ACTION_LOGS_API_URL || PRODUCTION_API_URL;
  }
  return import.meta.env.VITE_LOCAL_ACTION_LOGS_API_URL || DEFAULT_API_URL;
}

export async function fetchActionLogs({ before = '', limit = 100 } = {}) {
  const requestUrl = new URL(getActionLogsApiUrl(), window.location.href);
  requestUrl.searchParams.set('limit', String(limit));
  if (before) requestUrl.searchParams.set('before', before);

  const response = await fetch(requestUrl);
  const contentType = response.headers?.get?.('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('Could not load action logs.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load action logs.');
  return result;
}

export function setActionLogActorName(actorName) {
  currentActorName = String(actorName || '').trim() || 'Unknown User';
}

export async function recordActionLog({
  action,
  actorName = currentActorName,
  details = {},
  targetId = '',
  targetName = '',
  targetType = 'webapp',
}) {
  try {
    const response = await fetch(getActionLogsApiUrl(), {
      body: JSON.stringify({ action, actorName, details, targetId, targetName, targetType }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error('Could not record action.');
    return await response.json();
  } catch (error) {
    console.warn('[action log]', error.message || error);
    return null;
  }
}

import { getCurrentAuthSession } from './authService';

const DEFAULT_API_URL = '/api/action-logs';
const PRODUCTION_API_URL = 'https://maeljnrgffgrljqusnre.supabase.co/functions/v1/action-logs';

let currentActorName = 'System';
let currentAuthSession = null;

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
  currentActorName = String(actorName || '').trim() || 'System';
}

export function setActionLogAuthSession(session) {
  currentAuthSession = session || null;
}

function getActionLogAuthHeaders(session) {
  const isDirectDiscordSession = session?.provider === 'discord' && !session?.access_token;
  const accessToken = session?.access_token
    || (!isDirectDiscordSession ? session?.accessToken : '')
    || '';
  const discordAccessToken = session?.provider_token
    || (isDirectDiscordSession ? session?.accessToken : '')
    || '';

  return {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(discordAccessToken ? { 'X-Discord-Access-Token': discordAccessToken } : {}),
  };
}

function getSessionDiscordUserId(session) {
  const user = session?.user || {};
  const metadata = user.user_metadata || user.userMetadata || {};
  const identity = Array.isArray(user.identities)
    ? user.identities.find((currentIdentity) => currentIdentity.provider === 'discord') || user.identities[0]
    : null;
  const identityData = identity?.identity_data || {};
  const userId = session?.provider === 'discord' ? user.id : '';
  const discordUserId = String(
    user.discordUserId
      || metadata.discordUserId
      || metadata.discord_user_id
      || metadata.provider_id
      || metadata.providerId
      || metadata.sub
      || identityData.sub
      || identityData.provider_id
      || identity?.id
      || userId
      || '',
  ).trim();
  return /^\d{15,25}$/.test(discordUserId) ? discordUserId : '';
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
    const authSession = currentAuthSession || await getCurrentAuthSession().catch(() => null);
    const response = await fetch(getActionLogsApiUrl(), {
      body: JSON.stringify({
        action,
        actorName,
        details,
        discordUserId: getSessionDiscordUserId(authSession),
        targetId,
        targetName,
        targetType,
      }),
      headers: { 'Content-Type': 'application/json', ...getActionLogAuthHeaders(authSession) },
      method: 'POST',
    });
    if (!response.ok) throw new Error('Could not record action.');
    return await response.json();
  } catch (error) {
    console.warn('[action log]', error.message || error);
    return null;
  }
}

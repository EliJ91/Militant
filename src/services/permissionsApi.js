const DEFAULT_API_URL = '/api/permissions';
import { recordActionLog } from './actionLogsApi';
const PRODUCTION_API_URL = 'https://maeljnrgffgrljqusnre.supabase.co/functions/v1/permissions';

function getPermissionsApiUrl() {
  if (import.meta.env.PROD) {
    return import.meta.env.VITE_PRODUCTION_PERMISSIONS_API_URL || PRODUCTION_API_URL;
  }

  return import.meta.env.VITE_LOCAL_PERMISSIONS_API_URL || DEFAULT_API_URL;
}

async function readResult(response, fallbackMessage) {
  const contentType = response.headers?.get?.('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(fallbackMessage);
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || fallbackMessage);
  return result;
}

export async function fetchPermissionSettings() {
  try {
    const response = await fetch(getPermissionsApiUrl());
    return readResult(response, 'Could not load permissions.');
  } catch (error) {
    throw new Error(error.message === 'Failed to fetch' ? 'Could not reach permissions database.' : error.message);
  }
}

export async function fetchDiscordMemberRoles(sessionOrToken) {
  const session = typeof sessionOrToken === 'string' ? null : sessionOrToken;
  const accessToken = typeof sessionOrToken === 'string'
    ? sessionOrToken
    : session?.access_token || session?.accessToken || session?.provider_token || '';
  const discordAccessToken = session?.provider_token
    || (session?.provider === 'discord' ? session?.accessToken : '')
    || '';
  if (!accessToken) return { roleIds: [] };

  try {
    const requestUrl = new URL(getPermissionsApiUrl(), window.location.origin);
    requestUrl.searchParams.set('resource', 'discord-member-roles');
    const response = await fetch(requestUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(discordAccessToken ? { 'X-Discord-Access-Token': discordAccessToken } : {}),
      },
    });
    return readResult(response, 'Could not load Discord roles.');
  } catch (error) {
    throw new Error(error.message === 'Failed to fetch' ? 'Could not reach permissions database.' : error.message);
  }
}

export async function updatePermissionSettings(settings) {
  try {
    const response = await fetch(getPermissionsApiUrl(), {
      body: JSON.stringify({ settings }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    const result = await readResult(response, 'Could not save permissions.');
    void recordActionLog({
      action: 'Permissions updated',
      details: { count: Array.isArray(settings?.roles) ? settings.roles.length : 0 },
      targetName: 'Role Access Matrix',
      targetType: 'permissions',
    });
    return result;
  } catch (error) {
    throw new Error(error.message === 'Failed to fetch' ? 'Could not reach permissions database.' : error.message);
  }
}

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
  let previousSettings = null;
  try {
    previousSettings = await fetchPermissionSettings();
  } catch {
    previousSettings = null;
  }

  try {
    const response = await fetch(getPermissionsApiUrl(), {
      body: JSON.stringify({ settings }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });
    const result = await readResult(response, 'Could not save permissions.');
    void recordActionLog({
      action: 'Permissions updated',
      details: buildPermissionChangeDetails(previousSettings?.settings || previousSettings, settings),
      targetName: 'Role Access Matrix',
      targetType: 'permissions',
    });
    return result;
  } catch (error) {
    throw new Error(error.message === 'Failed to fetch' ? 'Could not reach permissions database.' : error.message);
  }
}

function roleKey(role) {
  return String(role?.roleId || role?.id || role?.name || '').trim();
}

function permissionLabel(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildPermissionChangeDetails(previousSettings, nextSettings) {
  const previousRoles = Array.isArray(previousSettings?.roles) ? previousSettings.roles : [];
  const nextRoles = Array.isArray(nextSettings?.roles) ? nextSettings.roles : [];
  const previousByKey = new Map(previousRoles.map((role, index) => [roleKey(role), { index, role }]));
  const nextByKey = new Map(nextRoles.map((role, index) => [roleKey(role), { index, role }]));
  const changes = [];

  nextByKey.forEach(({ index, role }, key) => {
    const previous = previousByKey.get(key);
    const roleName = String(role?.name || 'Unnamed role').trim();
    if (!previous) {
      changes.push(`Added role ${roleName}`);
      return;
    }

    const previousName = String(previous.role?.name || '').trim();
    if (previousName && previousName !== roleName) changes.push(`Renamed ${previousName} to ${roleName}`);
    if (previous.index !== index) changes.push(`Moved ${roleName} to column ${index + 1}`);

    const permissionKeys = new Set([
      ...Object.keys(previous.role?.permissions || {}),
      ...Object.keys(role?.permissions || {}),
    ]);
    permissionKeys.forEach((permissionKey) => {
      const before = Boolean(previous.role?.permissions?.[permissionKey]);
      const after = Boolean(role?.permissions?.[permissionKey]);
      if (before === after) return;
      changes.push(`${after ? 'Enabled' : 'Disabled'} ${permissionLabel(permissionKey)} for ${roleName}`);
    });
  });

  previousByKey.forEach(({ role }, key) => {
    if (!nextByKey.has(key)) changes.push(`Deleted role ${String(role?.name || 'Unnamed role').trim()}`);
  });

  return {
    changes,
    count: changes.length,
    roleCount: nextRoles.length,
  };
}

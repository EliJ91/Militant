import { recordActionLog } from './actionLogsApi';
import { getCurrentAuthSession } from './authService';

const DEFAULT_API_URL = '/api/zvz-builds';
export const PRODUCTION_API_URL = 'https://maeljnrgffgrljqusnre.supabase.co/functions/v1/zvz-builds';

function getApiUrl() {
  if (import.meta.env.PROD) {
    return import.meta.env.VITE_PRODUCTION_ZVZ_BUILDS_API_URL || PRODUCTION_API_URL;
  }
  return import.meta.env.VITE_LOCAL_ZVZ_BUILDS_API_URL || DEFAULT_API_URL;
}

async function readResult(response, fallbackMessage) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || fallbackMessage);
  return result;
}

async function getAuthHeaders() {
  const session = await getCurrentAuthSession().catch(() => null);
  const accessToken = session?.access_token
    || session?.accessToken
    || session?.provider_token
    || '';
  const discordAccessToken = session?.provider_token
    || (session?.provider === 'discord' ? session?.accessToken : '')
    || '';
  return {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(discordAccessToken ? { 'X-Discord-Access-Token': discordAccessToken } : {}),
  };
}

export async function fetchZvZBuildLayouts() {
  const response = await fetch(getApiUrl(), { headers: await getAuthHeaders() });
  return readResult(response, 'Could not load saved ZvZ builds.');
}

export async function createZvZBuildLayout({ builds, sourceFileName, title, uploadedBy }) {
  const response = await fetch(getApiUrl(), {
    body: JSON.stringify({ builds, sourceFileName, title, uploadedBy }),
    headers: { 'Content-Type': 'application/json', ...await getAuthHeaders() },
    method: 'POST',
  });
  const result = await readResult(response, 'Could not save the ZvZ build.');
  void recordActionLog({
    action: 'ZvZ build added',
    targetId: result.layout?.id || '',
    targetName: result.layout?.title || title,
    targetType: 'zvz-build',
  });
  return result;
}

export async function updateZvZBuildLayout({ builds, id, sourceFileName, title, uploadedBy }) {
  const response = await fetch(getApiUrl(), {
    body: JSON.stringify({ builds, id, sourceFileName, title, uploadedBy }),
    headers: { 'Content-Type': 'application/json', ...await getAuthHeaders() },
    method: 'PUT',
  });
  const result = await readResult(response, 'Could not overwrite the ZvZ build.');
  void recordActionLog({
    action: 'ZvZ build updated',
    targetId: result.layout?.id || id,
    targetName: result.layout?.title || title,
    targetType: 'zvz-build',
  });
  return result;
}

export async function deleteZvZBuildLayout({ id, title }) {
  const response = await fetch(getApiUrl(), {
    body: JSON.stringify({ id }),
    headers: { 'Content-Type': 'application/json', ...await getAuthHeaders() },
    method: 'DELETE',
  });
  const result = await readResult(response, 'Could not delete the ZvZ build.');
  void recordActionLog({
    action: 'ZvZ build deleted',
    targetId: id,
    targetName: title,
    targetType: 'zvz-build',
  });
  return result;
}

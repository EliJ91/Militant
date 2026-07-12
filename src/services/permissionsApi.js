const DEFAULT_API_URL = '/api/permissions';
export const PRODUCTION_API_URL = 'https://maeljnrgffgrljqusnre.supabase.co/functions/v1/permissions';

export function getPermissionsApiUrl() {
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
  const response = await fetch(getPermissionsApiUrl());
  return readResult(response, 'Could not load permissions.');
}

export async function updatePermissionSettings(settings) {
  const response = await fetch(getPermissionsApiUrl(), {
    body: JSON.stringify({ settings }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  });
  return readResult(response, 'Could not save permissions.');
}

const DEFAULT_API_URL = '/api/siphoned-energy';
export const PRODUCTION_API_URL = 'https://maeljnrgffgrljqusnre.supabase.co/functions/v1/siphoned-energy';

export function getSiphonedEnergyApiUrl() {
  if (import.meta.env.PROD) {
    return import.meta.env.VITE_PRODUCTION_SIPHONED_ENERGY_API_URL || PRODUCTION_API_URL;
  }

  return import.meta.env.VITE_LOCAL_SIPHONED_ENERGY_API_URL || DEFAULT_API_URL;
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

export async function fetchSiphonedEnergyTransactions() {
  const response = await fetch(getSiphonedEnergyApiUrl());
  return readResult(response, 'Could not load Siphoned Energy transactions.');
}

export async function updateSiphonedEnergyTransactions(logText) {
  const response = await fetch(getSiphonedEnergyApiUrl(), {
    body: JSON.stringify({ logText }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return readResult(response, 'Could not update Siphoned Energy transactions.');
}

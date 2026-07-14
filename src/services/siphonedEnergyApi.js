const DEFAULT_API_URL = '/api/siphoned-energy';
import { recordActionLog } from './actionLogsApi';
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

export async function fetchSiphonedEnergyMembers() {
  const requestUrl = new URL(getSiphonedEnergyApiUrl(), window.location.href);
  requestUrl.searchParams.set('resource', 'members');
  const response = await fetch(requestUrl);
  return readResult(response, 'Could not load Militant members.');
}

export async function updateSiphonedEnergyTransactions(logText) {
  const response = await fetch(getSiphonedEnergyApiUrl(), {
    body: JSON.stringify({ logText }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const result = await readResult(response, 'Could not update Siphoned Energy transactions.');
  void recordActionLog({
    action: 'Siphoned Energy log updated',
    details: { insertedRows: result.inserted || result.insertedRows || 0 },
    targetName: 'Siphoned Energy Ledger',
    targetType: 'siphoned-energy',
  });
  return result;
}

export async function updateSiphonedEnergyPlayerStar({ player, starred }) {
  const response = await fetch(getSiphonedEnergyApiUrl(), {
    body: JSON.stringify({ player, starred }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
  });
  const result = await readResult(response, 'Could not update player star.');
  void recordActionLog({
    action: starred ? 'Siphoned Energy player starred' : 'Siphoned Energy player unstarred',
    details: { player },
    targetName: player,
    targetType: 'siphoned-energy-player',
  });
  return result;
}

export async function purgeSiphonedEnergyTransactions({ date }) {
  const response = await fetch(getSiphonedEnergyApiUrl(), {
    body: JSON.stringify({ date }),
    headers: { 'Content-Type': 'application/json' },
    method: 'DELETE',
  });
  const result = await readResult(response, 'Could not purge Siphoned Energy transactions.');
  void recordActionLog({
    action: 'Siphoned Energy transactions purged',
    details: { count: result.deleted || result.deletedRows || 0 },
    targetName: date,
    targetType: 'siphoned-energy',
  });
  return result;
}

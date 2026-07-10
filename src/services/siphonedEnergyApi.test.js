import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSiphonedEnergyMembers,
  fetchSiphonedEnergyTransactions,
  purgeSiphonedEnergyTransactions,
  PRODUCTION_API_URL,
} from './siphonedEnergyApi';

afterEach(() => vi.unstubAllGlobals());

describe('Siphoned Energy API', () => {
  it('keeps a concrete production Edge Function endpoint', () => {
    expect(PRODUCTION_API_URL).toBe(
      'https://maeljnrgffgrljqusnre.supabase.co/functions/v1/siphoned-energy',
    );
  });

  it('reports a useful error when a host returns HTML instead of JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      headers: { get: () => 'text/html' },
      ok: true,
    }));

    await expect(fetchSiphonedEnergyTransactions())
      .rejects.toThrow('Could not load Siphoned Energy transactions.');
  });

  it('loads guild members through the Siphoned Energy endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ members: [{ playerName: 'Onslawht' }] }),
      ok: true,
    }));

    await expect(fetchSiphonedEnergyMembers()).resolves.toEqual({
      members: [{ playerName: 'Onslawht' }],
    });
    expect(fetch).toHaveBeenCalledWith(new URL(`${PRODUCTION_API_URL}?resource=members`));
  });

  it('purges Siphoned Energy transactions with a selected date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ deletedRows: 3 }),
      ok: true,
    }));

    await expect(purgeSiphonedEnergyTransactions({ date: '2026-06-20' }))
      .resolves.toEqual({ deletedRows: 3 });
    expect(fetch).toHaveBeenCalledWith(PRODUCTION_API_URL, {
      body: JSON.stringify({ date: '2026-06-20' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'DELETE',
    });
  });
});

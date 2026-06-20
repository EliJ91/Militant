import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSiphonedEnergyTransactions,
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
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWestAveragePrices, getEstimatedMarketValue, getWestMultiHistoryUrl } from './albionMarket';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Albion West market data', () => {
  it('builds West history URLs with encoded item IDs', () => {
    expect(getWestMultiHistoryUrl(['T4_CAPEITEM_FW_LYMHURST@3'])).toBe(
      'https://west.albion-online-data.com/api/v2/stats/history/T4_CAPEITEM_FW_LYMHURST%403.json?time-scale=24',
    );
  });

  it('uses the same weighted-average EMV calculation as market history', () => {
    expect(getEstimatedMarketValue([
      {
        data: [
          { avg_price: 100, item_count: 2 },
          { avg_price: 200, item_count: 1 },
        ],
      },
    ])).toBeCloseTo(133.333, 2);
  });

  it('returns null for items with no available price points', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([]),
    })));

    await expect(fetchWestAveragePrices(['T4_MAIN_SWORD'])).resolves.toEqual({
      T4_MAIN_SWORD: { averagePrice: null },
    });
  });
});

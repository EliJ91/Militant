import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RatCatcherTool from './RatCatcherTool';
import { fetchWestAveragePrices } from '../services/albionMarket';
import { fetchIgnoredLootItems, fetchLootLogBundle, fetchLootLogBundles } from '../services/lootLogApi';

vi.mock('../services/albionMarket', () => ({
  fetchWestAveragePrices: vi.fn(),
}));

vi.mock('../services/lootLogApi', () => ({
  fetchIgnoredLootItems: vi.fn(),
  fetchLootLogBundle: vi.fn(),
  fetchLootLogBundles: vi.fn(),
}));

const bundle = {
  id: 'bundle-1',
  events: [{
    alliance: '',
    enchantment: 0,
    eventType: 'looted',
    guild: '',
    item: "Adept's Broadsword",
    itemId: 'T4_MAIN_SWORD',
    player: 'RatPlayer',
    quantity: 2,
    timestamp: '2026-08-19T12:00:00Z',
  }],
  lootFileName: 'Rat Test',
  summary: { hiddenPlayers: [] },
};

describe('RatCatcherTool', () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchLootLogBundles.mockResolvedValue({ bundles: [{ id: bundle.id, logNumber: 1, lootFileName: bundle.lootFileName }] });
    fetchIgnoredLootItems.mockResolvedValue({ items: [] });
    fetchLootLogBundle.mockResolvedValue({ bundle });
    fetchWestAveragePrices.mockResolvedValue({ T4_MAIN_SWORD: { averagePrice: 1000 } });
  });

  it('prices only after the user checks the currently displayed players', async () => {
    render(<RatCatcherTool />);

    fireEvent.click(await screen.findByRole('button', { name: /0 selected/i }));
    fireEvent.click(screen.getByRole('button', { name: /#1 Rat Test/i }));
    expect(screen.queryByText('RatPlayer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Combine' }));

    expect(await screen.findByText('RatPlayer')).toBeInTheDocument();
    expect(fetchWestAveragePrices).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Check EMV' }));

    await waitFor(() => expect(fetchWestAveragePrices).toHaveBeenCalledWith(['T4_MAIN_SWORD']));
    expect(await screen.findByText('EMV $2,300')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stats/i })).toBeEnabled();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const rawBundle = {
  id: 'bundle-raw',
  lootFileName: 'Raw Rat Test',
  submissions: [{
    rawLogText: [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name;location',
      "2026-08-19T12:34:00Z;CHAIR;Militant;RatPlayer;T4_MAIN_SWORD;Adept's Broadsword;1;ENEMY;EnemyGuild;DeadPlayer;Skysand Ridge",
    ].join('\n'),
  }],
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

  afterEach(() => {
    cleanup();
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

  it('opens Rat Catcher item history as links to the source loot log', async () => {
    fetchLootLogBundles.mockResolvedValue({
      bundles: [{ id: rawBundle.id, logNumber: 2, lootFileName: rawBundle.lootFileName }],
    });
    fetchLootLogBundle.mockResolvedValue({ bundle: rawBundle });

    render(<RatCatcherTool />);

    fireEvent.click(await screen.findByRole('button', { name: /0 selected/i }));
    fireEvent.click(await screen.findByRole('button', { name: /#2 Raw Rat Test/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Combine' }));

    const itemTile = await screen.findByLabelText(/RatPlayer Kept 1 Adept's Broadsword/i);
    fireEvent.click(itemTile);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      "12:34 Looted by RatPlayer: Adept's Broadsword x1 from DeadPlayer ([ENEMY] EnemyGuild) at Skysand Ridge",
    );
    expect(screen.getByRole('link', { name: /Raw Rat Test/i })).toHaveAttribute(
      'href',
      "#loot-monitor/bundle-raw?player=RatPlayer&itemId=T4_MAIN_SWORD&item=Adept%27s+Broadsword",
    );
  });
});

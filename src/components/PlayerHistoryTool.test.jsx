import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPlayerHistory } from '../services/playerHistoryService';
import PlayerHistoryTool from './PlayerHistoryTool';

vi.mock('../services/playerHistoryService', () => ({ fetchPlayerHistory: vi.fn() }));

describe('PlayerHistoryTool', () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchPlayerHistory.mockResolvedValue({
      players: [
        {
          averageItemsKeptPerCta: 4,
          averageItemsLootedPerCta: 6,
          ctas: [{
            bundleId: 'cta-one',
            date: '2026-07-20T20:00:00.000Z',
            itemsKept: [
              { enchantment: 0, item: 'Elder Sword', itemId: 'T8_MAIN_SWORD', quantity: 5 },
              { enchantment: 1, item: 'Elder Armor', itemId: 'T8_ARMOR', quantity: 3 },
            ],
            lootLogTitle: '20UTC-JUL-20',
          }],
          ctaCount: 2,
          itemsKept: 8,
          itemsLooted: 12,
          itemsLost: 4,
          lastCtaAt: '2026-07-20T20:00:00.000Z',
          playerId: 'one',
          playerKey: 'militantone',
          playerName: 'MilitantOne',
        },
        {
          averageItemsKeptPerCta: 0,
          averageItemsLootedPerCta: 0,
          ctas: [],
          ctaCount: 0,
          itemsKept: 0,
          itemsLooted: 0,
          itemsLost: 0,
          lastCtaAt: '',
          playerId: 'two',
          playerKey: 'militanttwo',
          playerName: 'MilitantTwo',
        },
      ],
    });
  });

  afterEach(cleanup);

  it('shows member-only statistics and searches by player name', async () => {
    render(<PlayerHistoryTool />);
    expect(screen.getByRole('heading', { level: 1, name: 'Player Loot History' })).toBeInTheDocument();
    expect(await screen.findByText('MilitantOne')).toBeInTheDocument();
    expect(screen.getByText('MilitantTwo')).toBeInTheDocument();

    expect(screen.queryByRole('region', { name: 'Player history summary' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search player loot history'), { target: { value: 'one' } });
    await waitFor(() => expect(screen.queryByText('MilitantTwo')).not.toBeInTheDocument());
    expect(screen.getByText('MilitantOne')).toBeInTheDocument();
  });

  it('sorts every statistical column', async () => {
    render(<PlayerHistoryTool />);
    await screen.findByText('MilitantOne');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Player' }));
    expect(screen.getByRole('columnheader', { name: /Player/ })).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Items Kept' }));
    expect(screen.getByRole('columnheader', { name: /Items Kept/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('expands a player row to show items kept under each loot log title', async () => {
    render(<PlayerHistoryTool />);
    await screen.findByText('MilitantOne');

    fireEvent.click(screen.getByRole('button', { name: 'View loot history for MilitantOne' }));
    expect(screen.getByRole('heading', { level: 3, name: '20UTC-JUL-20' })).toBeInTheDocument();
    expect(screen.getByText('Elder Sword')).toBeInTheDocument();
    expect(screen.getByText('5 kept')).toBeInTheDocument();
    expect(screen.getByText('Elder Sword').closest('.player-history-kept-item').querySelector('img').getAttribute('src')).toContain('/item-image/T8_MAIN_SWORD.png');
    expect(screen.getByText('Elder Armor')).toBeInTheDocument();
    expect(screen.getByText('3 kept')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide loot history for MilitantOne' }));
    expect(screen.queryByRole('heading', { level: 3, name: '20UTC-JUL-20' })).not.toBeInTheDocument();
  });

  it('filters kept items by tier and type and remembers the filters', async () => {
    const firstRender = render(<PlayerHistoryTool />);
    await screen.findByText('MilitantOne');
    const tierControl = screen.getByText('Tier').closest('.filter-dropdown-control');
    fireEvent.click(within(tierControl).getByText('All tiers'));
    fireEvent.click(within(tierControl).getByRole('button', { name: 'Disable All' }));
    fireEvent.click(within(tierControl).getByRole('button', { name: 'T8' }));
    const typeControl = screen.getByText('Item Type').closest('.filter-dropdown-control');
    fireEvent.click(within(typeControl).getByText('All item types'));
    fireEvent.click(within(typeControl).getByRole('button', { name: 'Disable All' }));
    fireEvent.click(within(typeControl).getByRole('button', { name: 'Gear' }));
    fireEvent.click(screen.getByRole('button', { name: 'View loot history for MilitantOne' }));
    expect(screen.getByText('Elder Sword')).toBeInTheDocument();

    firstRender.unmount();
    render(<PlayerHistoryTool />);
    expect(screen.getByText('Tier').closest('.filter-dropdown-control').querySelector('summary')).toHaveTextContent('T8');
    expect(screen.getByText('Item Type').closest('.filter-dropdown-control').querySelector('summary')).toHaveTextContent('Gear');
  });
});

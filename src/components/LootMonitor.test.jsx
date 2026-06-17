import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LootMonitor from './LootMonitor';

const STORAGE_KEY = 'militant.lootMonitor.filters.v3';

const lootText = [
  'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
  "2026-06-17T00:08:30.420Z;CHAIR;Militant;Windyyyzz;T4_CAPEITEM_FW_LYMHURST@3;Adept's Lymhurst Cape;2;FURIX;EnemyGuild;Enemy",
  "2026-06-17T00:10:30.420Z;FURIX;EnemyGuild;Enemy;T4_CAPEITEM_FW_LYMHURST@3;Adept's Lymhurst Cape;1;CHAIR;Militant;Windyyyzz",
  "2026-06-17T00:11:30.420Z;;;SoloLoot;T5_BAG@1;Expert's Bag;1;;;@MOB_T5",
].join('\n');

const chestText = [
  '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
  '"06/17/2026 00:41:56"\t"Windyyyzz"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
  '"06/17/2026 00:41:56"\t"Donor"\t"Expert\'s Bag"\t"1"\t"2"\t"4"',
].join('\n');

const weaponLootText = [
  'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
  "2026-06-17T00:08:30.420Z;CHAIR;Militant;WeaponUser;T4_MAIN_SWORD;Adept's Broadsword;1;FURIX;EnemyGuild;Enemy",
  "2026-06-17T00:09:30.420Z;CHAIR;Militant;WeaponUser;T5_BAG@1;Expert's Bag;1;FURIX;EnemyGuild;Enemy",
].join('\n');

function marketResponse(data) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function stubMarketPrices() {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('locations=')) return marketResponse([]);

    return marketResponse([
      {
        item_id: 'T4_CAPEITEM_FW_LYMHURST@3',
        location: 'Lymhurst',
        quality: 1,
        data: [{ timestamp: '2026-06-01T00:00:00', avg_price: 100, item_count: 5 }],
      },
      {
        item_id: 'T5_BAG@1',
        location: 'Bridgewatch',
        quality: 1,
        data: [{ timestamp: '2026-06-01T00:00:00', avg_price: 200, item_count: 2 }],
      },
    ]);
  }));
}

function uploadMonitorFiles(container, files) {
  const input = container.querySelector('input[type="file"]');

  fireEvent.change(input, {
    target: { files },
  });
}

describe('LootMonitor', () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubMarketPrices();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('discerns both files from one upload and keeps saved filter settings', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      alliances: ['CHAIR'],
      guilds: ['Militant'],
      sortDirection: 'asc',
      status: 'lost',
      tierFilters: ['tier4'],
      typeFilters: ['cape'],
    }));

    const { container } = render(<LootMonitor />);
    uploadMonitorFiles(container, [
      new File([lootText], 'loot-events.txt', { type: 'text/plain' }),
      new File([chestText], 'chest.txt', { type: 'text/plain' }),
    ]);

    expect(await screen.findByText('loot-events.txt')).toBeInTheDocument();
    expect(screen.getByText('chest.txt')).toBeInTheDocument();
    expect(screen.getByText('Tier')).toBeInTheDocument();
    expect(screen.getByText('Item Type')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Least to most')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Lost')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Resolved' })).toBeInTheDocument();
    const screenshotButton = screen.getByRole('button', { name: 'Copy Screenshot' });
    expect(screenshotButton).toBeInTheDocument();
    expect(container.querySelector('.loot-board-section')).not.toContainElement(screenshotButton);
    const renderedTile = container.querySelector('.loot-item-tile');
    expect(renderedTile.querySelector('img').getAttribute('src')).toContain('/item-image/');
    expect(renderedTile).toHaveAttribute('title', expect.stringContaining('T4_CAPEITEM_FW_LYMHURST@3'));
    expect(screen.queryByText('Search')).not.toBeInTheDocument();
    expect(screen.queryByText('Player')).not.toBeInTheDocument();

    const tierControl = screen.getByText('Tier').closest('.filter-dropdown-control');
    const tierDetails = tierControl.querySelector('details');
    const tierSummary = tierControl.querySelector('summary');

    fireEvent.click(tierSummary);
    expect(tierDetails).toHaveAttribute('open');

    const tierFive = within(tierControl).getByRole('button', { name: 'T5' });
    expect(tierFive).toHaveClass('unselected-option');
    fireEvent.click(tierFive);
    expect(tierDetails).toHaveAttribute('open');

    fireEvent.click(tierSummary);
    expect(tierDetails).not.toHaveAttribute('open');

    fireEvent.click(tierSummary);
    fireEvent.mouseDown(document.body);
    expect(tierDetails).not.toHaveAttribute('open');

    fireEvent.click(tierSummary);
    fireEvent.click(within(tierControl).getByRole('button', { name: 'Enable All' }));
    expect(tierDetails).toHaveAttribute('open');
    fireEvent.click(within(tierControl).getByRole('button', { name: 'Disable All' }));
    expect(tierDetails).toHaveAttribute('open');

    const typeControl = screen.getByText('Item Type').closest('.filter-dropdown-control');
    fireEvent.click(typeControl.querySelector('summary'));
    expect(within(typeControl).getByRole('button', { name: 'Memento' })).toBeInTheDocument();

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      expect(saved.tierFilters).toEqual(['__none__']);
      expect(saved.sortDirection).toBe('asc');
    });
  });

  it('shows loot without a chest log and disables status filtering', async () => {
    const { container } = render(<LootMonitor />);
    uploadMonitorFiles(container, [
      new File([lootText], 'loot-events.txt', { type: 'text/plain' }),
    ]);

    expect(await screen.findByText('loot-events.txt')).toBeInTheDocument();
    expect(screen.getByText('No chest log loaded')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeDisabled();
    expect(screen.getByTitle('There must be a chest log uploaded to sort by status.')).toBeInTheDocument();
    expect(screen.getByText(/Windyyyzz/)).toBeInTheDocument();
    expect(await screen.findByText('EMV $230')).toBeInTheDocument();
  });

  it('keeps weapons visible when item type filters exclude ordinary item types', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      typeFilters: ['__none__'],
    }));

    const { container } = render(<LootMonitor />);
    uploadMonitorFiles(container, [
      new File([weaponLootText], 'loot-events.txt', { type: 'text/plain' }),
    ]);

    expect(await screen.findByText(/WeaponUser/)).toBeInTheDocument();
    expect(screen.getByLabelText("WeaponUser Kept 1 Adept's Broadsword")).toBeInTheDocument();
    expect(screen.queryByLabelText("WeaponUser Kept 1 Expert's Bag")).not.toBeInTheDocument();
  });
});

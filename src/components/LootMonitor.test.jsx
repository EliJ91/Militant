import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteLootLogBundle,
  fetchLootLogBundle,
  fetchLootLogBundles,
  submitChestLog,
  submitLootLog,
  updateLootLogBundle,
} from '../services/lootLogApi';
import LootMonitor, { LootLogArchive } from './LootMonitor';

vi.mock('../services/lootLogApi', () => ({
  deleteLootLogBundle: vi.fn(),
  fetchLootLogBundle: vi.fn(),
  fetchLootLogBundles: vi.fn(),
  submitChestLog: vi.fn(),
  submitLootLog: vi.fn(),
  updateLootLogBundle: vi.fn(),
}));

const STORAGE_KEY = 'militant.lootMonitor.filters.v3';

const lootText = [
  'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
  "2026-06-18T18:33:30.420Z;CHAIR;Militant;Windyyyzz;T4_CAPEITEM_FW_LYMHURST@3;Adept's Lymhurst Cape;2;FURIX;EnemyGuild;Enemy",
].join('\n');

const chestText = [
  '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
  '"06/18/2026 19:30:56"\t"Windyyyzz"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
].join('\n');

const storedEvents = [
  {
    alliance: 'CHAIR',
    enchantment: 3,
    eventType: 'looted',
    guild: 'Militant',
    item: "Adept's Lymhurst Cape",
    itemId: 'T4_CAPEITEM_FW_LYMHURST@3',
    lostTo: '',
    player: 'Windyyyzz',
    quantity: 2,
    timestamp: '2026-06-18T18:33:30.420Z',
  },
  {
    alliance: 'CHAIR',
    enchantment: 3,
    eventType: 'lost',
    guild: 'Militant',
    item: "Adept's Lymhurst Cape",
    itemId: 'T4_CAPEITEM_FW_LYMHURST@3',
    lostTo: 'Enemy',
    player: 'Windyyyzz',
    quantity: 1,
    timestamp: '2026-06-18T18:45:30.420Z',
  },
];

function createBundle(overrides = {}) {
  return {
    chestFileName: '18UTC-JUN-18',
    chestLogText: chestText,
    ctaTimer: '18 UTC',
    endAt: '2026-06-18T19:30:00.000Z',
    events: storedEvents,
    hasChestLog: true,
    id: 'bundle-18',
    lootFileName: '18UTC-JUN-18',
    lootLogText: lootText,
    startAt: '2026-06-18T18:33:00.000Z',
    chestSubmissions: [{ id: 'chest-submission-1', submittedBy: 'Manual' }],
    chestSubmitters: ['Manual'],
    submissions: [{ id: 'submission-1', submittedBy: 'Manual' }],
    submitters: ['Manual'],
    summary: { totals: { keptQuantity: 0, lootedQuantity: 2, players: 1 } },
    ...overrides,
  };
}

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
        data: [{ timestamp: '2026-06-01T00:00:00', avg_price: 100, item_count: 5 }],
        item_id: 'T4_CAPEITEM_FW_LYMHURST@3',
        location: 'Lymhurst',
        quality: 1,
      },
      {
        data: [{ timestamp: '2026-06-01T00:00:00', avg_price: 200, item_count: 2 }],
        item_id: 'T5_BAG@1',
        location: 'Bridgewatch',
        quality: 1,
      },
    ]);
  }));
}

describe('LootMonitor', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    stubMarketPrices();
    fetchLootLogBundle.mockResolvedValue({ bundle: createBundle() });
    fetchLootLogBundles.mockResolvedValue({ bundles: [createBundle()] });
    submitLootLog.mockResolvedValue({ summary: { fileNames: { loot: '18UTC-JUN-18 Loot Log' } } });
    submitChestLog.mockResolvedValue({ fileName: '18UTC-JUN-18 Chest Log' });
    deleteLootLogBundle.mockResolvedValue({ bundleId: 'bundle-18', deleted: true });
    updateLootLogBundle.mockResolvedValue({
      bundleId: 'bundle-18',
      displayLootFileName: 'Custom',
      fileNames: {
        chest: 'Custom Chest Log',
        loot: 'Custom Loot Log',
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not show the local file upload panel on the loot detail page', () => {
    render(<LootMonitor />);

    expect(screen.getByRole('heading', { name: 'View Loot Log' })).toBeInTheDocument();
    expect(screen.queryByText('Local Files Only')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose files' })).not.toBeInTheDocument();
    expect(submitLootLog).not.toHaveBeenCalled();
    expect(submitChestLog).not.toHaveBeenCalled();
  });

  it('shows unique loot-log uploaders without using chest-log submitters', async () => {
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        submissions: [
          { id: 'submission-1', submittedBy: 'Onslawt' },
          { id: 'submission-2', submittedBy: 'Manual' },
          { id: 'submission-3', submittedBy: 'Onslawt' },
        ],
        submitters: ['Onslawt', 'Manual'],
      }),
    });

    render(<LootMonitor bundleId="bundle-18" />);

    const summary = await screen.findByRole('region', { name: 'Selected CTA log' });
    expect(within(summary).getByText('Loot Loggers')).toBeInTheDocument();
    expect(within(summary).getByText('Onslawt, Manual')).toBeInTheDocument();
  });

  it('loads a saved bundle and keeps the saved monitor filters', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      alliances: ['CHAIR'],
      guilds: ['Militant'],
      sortDirection: 'asc',
      status: 'lost',
      tierFilters: ['tier4'],
      typeFilters: ['cape'],
    }));

    const { container } = render(<LootMonitor bundleId="bundle-18" />);

    expect(await screen.findByText('18UTC-JUN-18')).toBeInTheDocument();
    expect(screen.queryByText('Log Upload')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose files' })).not.toBeInTheDocument();
    expect(screen.getByText('Tier')).toBeInTheDocument();
    expect(screen.getByText('Item Type')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Least to most')).toBeInTheDocument();
    const statusControl = screen.getByText('Status').closest('.filter-dropdown-control');
    expect(statusControl.querySelector('summary')).toHaveTextContent('Lost');
    fireEvent.click(statusControl.querySelector('summary'));
    expect(within(statusControl).getByRole('button', { name: 'Resolved' })).toBeInTheDocument();
    fireEvent.click(statusControl.querySelector('summary'));
    const screenshotButton = screen.getByRole('button', { name: 'Copy Screenshot' });
    expect(container.querySelector('.loot-board-section')).not.toContainElement(screenshotButton);
    const renderedTile = container.querySelector('.loot-item-tile');
    expect(renderedTile.querySelector('img').getAttribute('src')).toContain('/item-image/');
    expect(renderedTile).toHaveAttribute('title', expect.stringContaining('T4_CAPEITEM_FW_LYMHURST@3'));

    const tierControl = screen.getByText('Tier').closest('.filter-dropdown-control');
    const tierDetails = tierControl.querySelector('details');
    const tierSummary = tierControl.querySelector('summary');

    fireEvent.click(tierSummary);
    const tierFive = within(tierControl).getByRole('button', { name: 'T5' });
    fireEvent.click(tierFive);
    expect(tierDetails).toHaveAttribute('open');

    fireEvent.mouseDown(document.body);
    expect(tierDetails).not.toHaveAttribute('open');

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      expect(saved.sortDirection).toBe('asc');
    });
  });

  it('copies a share link for the selected bundle', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<LootMonitor bundleId="bundle-18" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('#shared-log/bundle-18'),
    ));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('only disables Kept status when no chest log is loaded', async () => {
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        chestLogText: '',
        events: [storedEvents[0]],
        hasChestLog: false,
      }),
    });

    render(<LootMonitor bundleId="bundle-18" />);

    expect(await screen.findByText(/Windyyyzz/)).toBeInTheDocument();
    expect(await screen.findByText('EMV $230')).toBeInTheDocument();
    const statusLabel = screen.getByText('Status');
    fireEvent.click(statusLabel.nextElementSibling.querySelector('summary'));
    expect(screen.getByRole('button', { name: 'Kept' })).toBeDisabled();
    expect(screen.getAllByTitle('A chest log must be uploaded to select Kept.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Lost' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deselect All' })).toHaveClass('disable-all');
    const lostOption = screen.getByRole('button', { name: 'Lost' });
    fireEvent.click(lostOption);
    expect(lostOption).toHaveClass('unselected-option');
    expect(statusLabel.nextElementSibling.querySelector('summary')).toHaveTextContent('3 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
    expect(screen.getByRole('button', { name: 'Lost' })).toHaveClass('selected-option');
    expect(statusLabel.nextElementSibling.querySelector('summary')).toHaveTextContent('All');
  });

  it('keeps weapons visible when item type filters exclude ordinary item types', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ typeFilters: ['__none__'] }));
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        chestLogText: '',
        events: [
          {
            ...storedEvents[0],
            enchantment: 0,
            item: "Adept's Broadsword",
            itemId: 'T4_MAIN_SWORD',
            player: 'WeaponUser',
            quantity: 1,
          },
          {
            ...storedEvents[0],
            enchantment: 1,
            item: "Expert's Bag",
            itemId: 'T5_BAG@1',
            player: 'WeaponUser',
            quantity: 1,
          },
        ],
        hasChestLog: false,
      }),
    });

    render(<LootMonitor bundleId="bundle-18" />);

    expect(await screen.findByText(/WeaponUser/)).toBeInTheDocument();
    expect(screen.getByLabelText("WeaponUser Kept 1 Adept's Broadsword")).toBeInTheDocument();
    expect(screen.queryByLabelText("WeaponUser Kept 1 Expert's Bag")).not.toBeInTheDocument();
  });

  it('shows uncategorized items in Other while gear remains visible', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ typeFilters: ['other'] }));
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        chestLogText: '',
        events: [
          {
            ...storedEvents[0],
            enchantment: 0,
            item: "Smuggler's Coin",
            itemId: 'QUESTITEM_TOKEN_SMUGGLER',
            player: 'TokenHolder',
            quantity: 3,
          },
          {
            ...storedEvents[0],
            enchantment: 0,
            item: "Adept's Broadsword",
            itemId: 'T4_MAIN_SWORD',
            player: 'TokenHolder',
            quantity: 1,
          },
          {
            ...storedEvents[0],
            enchantment: 1,
            item: "Expert's Bag",
            itemId: 'T5_BAG@1',
            player: 'TokenHolder',
            quantity: 1,
          },
        ],
        hasChestLog: false,
      }),
    });

    render(<LootMonitor bundleId="bundle-18" />);

    expect(await screen.findByLabelText("TokenHolder Kept 3 Smuggler's Coin")).toBeInTheDocument();
    expect(screen.getByLabelText("TokenHolder Kept 1 Adept's Broadsword")).toBeInTheDocument();
    expect(screen.queryByLabelText("TokenHolder Kept 1 Expert's Bag")).not.toBeInTheDocument();
  });

  it('keeps uploads on View Loot Logs and opens a selected bundle with View', async () => {
    const onView = vi.fn();
    fetchLootLogBundles.mockResolvedValue({
      bundles: [createBundle({
        chestLogText: '',
        hasChestLog: false,
        lootFileName: 'loot-events-original',
      })],
    });
    const { container } = render(<LootLogArchive onView={onView} />);

    expect(await screen.findByText('loot-events-original')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Loot Logs' })).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.queryByText(/18:33 UTC/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Loot Monitor' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh logs' })).toHaveAttribute('title', 'Refresh logs');
    expect(screen.getByText('Loot Log Uploaded by')).toBeInTheDocument();
    expect(screen.getByText('Chest Log Uploaded by')).toBeInTheDocument();
    const stats = container.querySelector('.saved-log-totals');
    expect(within(stats).getByText('1')).toBeInTheDocument();
    expect(within(stats).getByText('player')).toBeInTheDocument();
    expect(within(stats).getByText('2')).toBeInTheDocument();
    expect(within(stats).getByText('items')).toBeInTheDocument();
    expect(screen.queryByText('2 looted')).not.toBeInTheDocument();
    expect(screen.queryByText('0 kept')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add chest log/i })).toBeInTheDocument();
    expect([...container.querySelector('.saved-log-actions').querySelectorAll('button')]
      .map((button) => button.textContent)).toEqual(['Edit', 'Download', 'Delete', 'View']);

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(onView).toHaveBeenCalledWith('bundle-18');

    const lootInput = container.querySelector('input[accept^=".csv"]');
    fireEvent.change(lootInput, {
      target: { files: [new File([lootText], 'loot-events.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => expect(submitLootLog).toHaveBeenCalledWith({
      bundleId: null,
      lootLogText: lootText,
      originalFileName: 'loot-events.txt',
      username: 'manual-web-upload',
    }));

    submitLootLog.mockClear();
    const addLootInput = container.querySelectorAll('input[accept^=".csv"]')[1];
    fireEvent.change(addLootInput, {
      target: { files: [new File([lootText], 'additional-loot-events.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => expect(submitLootLog).toHaveBeenCalledWith({
      bundleId: 'bundle-18',
      lootLogText: lootText,
      originalFileName: 'additional-loot-events.txt',
      username: 'manual-web-upload',
    }));

    submitLootLog.mockClear();
    const secondLootText = lootText.replace('Windyyyzz', 'SecondLogger');
    fireEvent.change(lootInput, {
      target: {
        files: [
          new File([lootText], 'first-loot-events.txt', { type: 'text/plain' }),
          new File([secondLootText], 'second-loot-events.txt', { type: 'text/plain' }),
        ],
      },
    });
    await waitFor(() => expect(submitLootLog).toHaveBeenCalledTimes(2));
    expect(submitLootLog).toHaveBeenNthCalledWith(1, {
      bundleId: null,
      lootLogText: lootText,
      originalFileName: 'first-loot-events.txt',
      username: 'manual-web-upload',
    });
    expect(submitLootLog).toHaveBeenNthCalledWith(2, {
      bundleId: null,
      lootLogText: secondLootText,
      originalFileName: 'second-loot-events.txt',
      username: 'manual-web-upload',
    });

    submitLootLog.mockClear();
    const uploadButton = screen.getByRole('button', { name: /upload log/i });
    const droppedLootFile = new File([lootText], 'dropped-loot-events.txt', { type: 'text/plain' });
    fireEvent.dragEnter(uploadButton, { dataTransfer: { files: [droppedLootFile] } });
    expect(uploadButton).toHaveClass('drag-over');
    expect(uploadButton).toHaveTextContent('Drop Loot Log');
    fireEvent.drop(uploadButton, { dataTransfer: { files: [droppedLootFile] } });
    await waitFor(() => expect(submitLootLog).toHaveBeenCalledWith({
      bundleId: null,
      lootLogText: lootText,
      originalFileName: 'dropped-loot-events.txt',
      username: 'manual-web-upload',
    }));
    expect(uploadButton).not.toHaveClass('drag-over');

    const chestInput = container.querySelector('input[accept^=".txt"]');
    fireEvent.change(chestInput, {
      target: { files: [new File([chestText], 'chest.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => expect(submitChestLog).toHaveBeenCalledWith({
      bundleId: 'bundle-18',
      chestLogText: chestText,
      username: 'manual-web-upload',
    }));

    submitChestLog.mockClear();
    fireEvent.change(chestInput, {
      target: {
        files: [
          new File([chestText], 'first-chest.txt', { type: 'text/plain' }),
          new File([chestText], 'second-chest.txt', { type: 'text/plain' }),
        ],
      },
    });
    await waitFor(() => expect(submitChestLog).toHaveBeenCalledTimes(2));
    expect(submitChestLog).toHaveBeenNthCalledWith(1, {
      bundleId: 'bundle-18',
      chestLogText: chestText,
      username: 'manual-web-upload',
    });
    expect(submitChestLog).toHaveBeenNthCalledWith(2, {
      bundleId: 'bundle-18',
      chestLogText: chestText,
      username: 'manual-web-upload',
    });
  });

  it('deletes a saved bundle only after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<LootLogArchive />);

    const deleteButton = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(deleteButton);
    expect(deleteLootLogBundle).not.toHaveBeenCalled();

    fireEvent.click(deleteButton);
    await waitFor(() => expect(deleteLootLogBundle).toHaveBeenCalledWith('bundle-18'));
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it('allows adding chest logs after one is already linked', async () => {
    render(<LootLogArchive />);

    expect(await screen.findByText('Chest linked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add chest log/i })).toBeInTheDocument();
  });

  it('previews, customizes, cancels, and saves log metadata edits', async () => {
    const { container } = render(<LootLogArchive />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('UTC Date'), { target: { value: '2026-06-20' } });
    fireEvent.change(screen.getByLabelText('CTA Time'), { target: { value: '4' } });

    expect(screen.getByLabelText('Loot Log Name')).toHaveValue('04UTC-JUN-20');
    expect(screen.getByLabelText('Loot Log Uploaded By')).toHaveValue('Manual');
    expect(screen.getByLabelText('Chest Log Uploaded By')).toHaveValue('Manual');
    expect(screen.queryByRole('textbox', { name: 'Chest Log Name' })).not.toBeInTheDocument();
    expect(container.querySelector('.saved-log-name-suffix')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(updateLootLogBundle).not.toHaveBeenCalled();
    expect(screen.getAllByText('18UTC-JUN-18')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('UTC Date'), { target: { value: '2026-06-20' } });
    fireEvent.change(screen.getByLabelText('CTA Time'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Loot Log Name'), { target: { value: 'Custom' } });
    fireEvent.change(screen.getByLabelText('Loot Log Uploaded By'), { target: { value: 'Onslawt' } });
    fireEvent.change(screen.getByLabelText('Chest Log Uploaded By'), { target: { value: 'Banker' } });
    fireEvent.keyDown(screen.getByLabelText('Chest Log Uploaded By'), { key: 'Enter' });

    await waitFor(() => expect(updateLootLogBundle).toHaveBeenCalledWith({
      bundleId: 'bundle-18',
      ctaHour: 4,
      dateUtc: '2026-06-20',
      fileNames: {
        baseName: 'Custom',
        chest: 'Custom Chest Log',
        loot: 'Custom Loot Log',
      },
      submitters: {
        chest: 'Banker',
        loot: 'Onslawt',
      },
    }));
    expect(await screen.findByText('Custom updated.')).toBeInTheDocument();
    expect(screen.getByText('Onslawt')).toBeInTheDocument();
    expect(screen.getByText('Banker')).toBeInTheDocument();
  });

  it('shows retention countdowns and downloads older logs as a zip archive', async () => {
    const oldStartAt = new Date(Date.now() - (61 * 24 * 60 * 60 * 1000)).toISOString();
    const oldBundle = createBundle({ startAt: oldStartAt });
    fetchLootLogBundles.mockResolvedValue({ bundles: [oldBundle] });
    fetchLootLogBundle.mockResolvedValue({ bundle: oldBundle });

    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:loot-archive'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    const linkClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<LootLogArchive />);

    expect(await screen.findByText('Deletes in 29 days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(fetchLootLogBundle).toHaveBeenCalledWith('bundle-18'));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    expect(linkClick).toHaveBeenCalledTimes(1);
    expect(linkClick.mock.instances[0].download).toBe('18UTC-JUN-18.zip');

    const archiveBlob = URL.createObjectURL.mock.calls[0][0];
    const { default: JSZip } = await import('jszip');
    const archive = await JSZip.loadAsync(await archiveBlob.arrayBuffer());
    expect(Object.keys(archive.files)).toEqual([
      '18UTC-JUN-18 Loot Log.txt',
      '18UTC-JUN-18 Chest Log.txt',
    ]);
    expect(await archive.file('18UTC-JUN-18 Loot Log.txt').async('string')).toBe(lootText);
    expect(await archive.file('18UTC-JUN-18 Chest Log.txt').async('string')).toBe(chestText);

    linkClick.mockRestore();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectUrl });
  });
});

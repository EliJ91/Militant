import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addLootLogDeathId,
  deleteChestLogs,
  deleteLootLogBundle,
  fetchLootLogBundle,
  fetchLootLogBundles,
  mergeLootLogBundles,
  setLootLogPlayerHidden,
  submitChestLog,
  submitLootLog,
  updateLootLogBundle,
} from '../services/lootLogApi';
import LootMonitor, { applySoldierScreenshotView, LootLogArchive } from './LootMonitor';

vi.mock('../services/lootLogApi', () => ({
  addLootLogDeathId: vi.fn(),
  buildLootLogShareUrl: (bundleId, filterQuery = '') => {
    const shareUrl = new URL('https://militant-discord-interactions.ejjernigan.workers.dev/share/loot-log');
    shareUrl.searchParams.set('bundle', bundleId);
    new URLSearchParams(filterQuery).forEach((value, key) => {
      shareUrl.searchParams.append(key, value);
    });
    return shareUrl;
  },
  deleteChestLogs: vi.fn(),
  deleteLootLogBundle: vi.fn(),
  fetchLootLogBundle: vi.fn(),
  fetchLootLogBundles: vi.fn(),
  mergeLootLogBundles: vi.fn(),
  setLootLogPlayerHidden: vi.fn(),
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
    createdAt: '2026-06-20T15:45:00.000Z',
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
  it('limits screenshot content to the Soldier role permissions', () => {
    const board = document.createElement('section');
    board.innerHTML = `
      <div class="loot-player-list">
        <article class="loot-player-row has-visibility-control"><button class="loot-player-visibility-button">Hide</button><button class="death-id-button">Add Death ID</button></article>
        <article class="loot-player-row has-visibility-control hidden-player-row"><button class="loot-player-visibility-button">Unhide</button></article>
      </div>
    `;

    applySoldierScreenshotView(board, {
      addDeathId: false,
      viewHiddenLootLogPlayers: false,
    });

    expect(board.querySelectorAll('.loot-player-row')).toHaveLength(1);
    expect(board.querySelector('.hidden-player-row')).not.toBeInTheDocument();
    expect(board.querySelector('.loot-player-visibility-button')).not.toBeInTheDocument();
    expect(board.querySelector('.death-id-button')).not.toBeInTheDocument();
    expect(board.querySelector('.has-visibility-control')).not.toBeInTheDocument();
  });

  beforeEach(() => {
    window.location.hash = '';
    window.localStorage.clear();
    vi.clearAllMocks();
    stubMarketPrices();
    fetchLootLogBundle.mockResolvedValue({ bundle: createBundle() });
    fetchLootLogBundles.mockResolvedValue({ bundles: [createBundle()] });
    mergeLootLogBundles.mockResolvedValue({ bundleId: 'merged-bundle', lootFileName: 'Merged - 18UTC-JUN-18' });
    setLootLogPlayerHidden.mockResolvedValue({ bundleId: 'bundle-18', hidden: false, hiddenPlayers: [] });
    submitLootLog.mockResolvedValue({ bundleId: 'bundle-18', summary: { fileNames: { loot: '18UTC-JUN-18 Loot Log' } } });
    submitChestLog.mockResolvedValue({ fileName: '18UTC-JUN-18 Chest Log' });
    deleteChestLogs.mockResolvedValue({ bundleId: 'bundle-18', deleted: true, deletedChestLogs: 1 });
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
    vi.useRealTimers();
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

  it('hides marked players unless the viewer has hidden-player permission', async () => {
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        summary: {
          hiddenPlayers: ['windyyyzz'],
          totals: { keptQuantity: 0, lootedQuantity: 2, players: 1 },
        },
      }),
    });

    const firstRender = render(<LootMonitor bundleId="bundle-18" />);
    await waitFor(() => expect(fetchLootLogBundle).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Windyyyzz/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unhide' })).not.toBeInTheDocument();
    firstRender.unmount();

    render(<LootMonitor bundleId="bundle-18" canViewHiddenPlayers uploadUsername="Onslawht" />);
    expect(await screen.findByRole('button', { name: 'Unhide' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unhide' }));

    await waitFor(() => expect(setLootLogPlayerHidden).toHaveBeenCalledWith({
      actorName: 'Onslawht',
      bundleId: 'bundle-18',
      hidden: false,
      lootLogName: '18UTC-JUN-18',
      player: 'Windyyyzz',
    }));
    expect(await screen.findByRole('button', { name: 'Hide' })).toBeInTheDocument();
  });

  it('opens dropped loot logs locally without calling the database APIs', async () => {
    render(<LootMonitor localOnly />);

    expect(screen.getByRole('heading', { name: 'Loot Log Viewer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Raw' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check Deaths' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy Screenshot' })).not.toBeInTheDocument();

    const dropzone = screen.getByText('Drag loot and chest logs here').closest('.loot-upload-dropzone');
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [new File([lootText], 'local-loot.txt', { type: 'text/plain' })],
      },
    });

    const summary = await screen.findByRole('region', { name: 'Local loot log summary' });
    expect(within(summary).getByText('local-loot.txt')).toBeInTheDocument();
    expect(screen.getByText('Windyyyzz')).toBeInTheDocument();
    expect(screen.getByLabelText(/Windyyyzz Kept 2 Adept's Lymhurst Cape/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Loot monitor controls')).toHaveTextContent('Status');
    expect(screen.queryByText('Files are read in this browser tab only and are never uploaded.')).not.toBeInTheDocument();
    expect(fetchLootLogBundle).not.toHaveBeenCalled();
    expect(submitLootLog).not.toHaveBeenCalled();
    expect(submitChestLog).not.toHaveBeenCalled();
  });

  it('compares local loot and chest logs and identifies kept items', async () => {
    render(<LootMonitor localOnly />);

    const dropzone = screen.getByText('Drag loot and chest logs here').closest('.loot-upload-dropzone');
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [
          new File([lootText], 'local-loot.csv', { type: 'text/csv' }),
          new File([chestText], 'local-chest.txt', { type: 'text/plain' }),
        ],
      },
    });

    const summary = await screen.findByRole('region', { name: 'Local loot log summary' });
    expect(within(summary).getByText('1 chest log loaded')).toBeInTheDocument();
    expect(screen.getByLabelText(/Windyyyzz Kept 1 Adept's Lymhurst Cape/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Windyyyzz Resolved 1 Adept's Lymhurst Cape/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Loot monitor controls')).toHaveTextContent('Status');
    expect(fetchLootLogBundle).not.toHaveBeenCalled();
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

  it('states when the selected loot log has no chest log', async () => {
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({ chestFileName: '', chestLogText: '', hasChestLog: false }),
    });

    render(<LootMonitor bundleId="bundle-18" />);

    const summary = await screen.findByRole('region', { name: 'Selected CTA log' });
    expect(within(summary).getByText('Chest Log')).toBeInTheDocument();
    expect(within(summary).getByText('No chest log')).toBeInTheDocument();
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

    expect((await screen.findAllByText('18UTC-JUN-18')).length).toBeGreaterThan(0);
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

  it('shows custody chain in kept item tooltips', async () => {
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        chestLogText: '',
        chestSubmissions: [],
        chestSubmitters: [],
        events: [
          storedEvents[0],
          {
            ...storedEvents[0],
            item: "Journeyman's Bag",
            itemId: 'T3_BAG',
            player: 'Bagholder',
            timestamp: '2026-06-18T18:34:30.420Z',
          },
        ],
        hasChestLog: false,
      }),
    });

    const { container } = render(<LootMonitor bundleId="bundle-18" />);

    expect(await screen.findByText('Windyyyzz')).toBeInTheDocument();
    const tiles = [...container.querySelectorAll('.loot-item-tile.kept-tile')];
    const renderedTile = tiles.find((tile) => tile.getAttribute('aria-label').includes("Adept's Lymhurst Cape"));
    const secondTile = tiles.find((tile) => tile.getAttribute('aria-label').includes("Journeyman's Bag"));
    expect(renderedTile).not.toHaveAttribute('title');

    fireEvent.mouseEnter(renderedTile);
    expect(screen.getByRole('tooltip')).toHaveTextContent("Adept's Lymhurst Cape");
    expect(screen.getByRole('tooltip')).toHaveTextContent('Looted by Windyyyzz');
    fireEvent.mouseLeave(renderedTile);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.click(renderedTile);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    fireEvent.click(renderedTile);
    expect(screen.getByRole('tooltip')).toHaveTextContent("Adept's Lymhurst Cape");
    fireEvent.click(renderedTile);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.click(renderedTile);
    expect(screen.getByRole('tooltip')).toHaveTextContent("Adept's Lymhurst Cape");
    fireEvent.click(document.body);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.click(renderedTile);
    expect(screen.getByRole('tooltip')).toHaveTextContent("Adept's Lymhurst Cape");
    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.click(renderedTile);
    expect(screen.getByRole('tooltip')).toHaveTextContent("Adept's Lymhurst Cape");
    fireEvent.click(secondTile);
    expect(screen.getByRole('tooltip')).toHaveTextContent("Journeyman's Bag");
    expect(screen.getByRole('tooltip')).not.toHaveTextContent("Adept's Lymhurst Cape");
  });

  it('opens a recent-deaths option when a player name is clicked', async () => {
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        chestLogText: '',
        chestSubmissions: [],
        chestSubmitters: [],
        events: [storedEvents[0]],
        hasChestLog: false,
      }),
    });
    const openWindow = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<LootMonitor bundleId="bundle-18" />);

    const playerName = await screen.findByRole('button', { name: /Windyyyzz/ });
    fireEvent.click(playerName);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Check Recent Deaths' }));

    expect(openWindow).toHaveBeenCalledWith(
      'https://murderledger.albiononline2d.com/players/Windyyyzz/ledger?show_kills=0&show_assists=0',
      '_blank',
      'noopener,noreferrer',
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the recent-deaths option from a mobile tap', async () => {
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        chestLogText: '',
        chestSubmissions: [],
        chestSubmitters: [],
        events: [storedEvents[0]],
        hasChestLog: false,
      }),
    });
    render(<LootMonitor bundleId="bundle-18" />);
    fireEvent.click(await screen.findByRole('button', { name: /Windyyyzz/ }));

    expect(screen.getByRole('menuitem', { name: 'Check Recent Deaths' })).toBeInTheDocument();
  });

  it('allows recent death viewing without granting death ID changes', async () => {
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        chestLogText: '',
        chestSubmissions: [],
        chestSubmitters: [],
        events: [storedEvents[0]],
        hasChestLog: false,
      }),
    });

    render(<LootMonitor bundleId="bundle-18" />);

    fireEvent.click(await screen.findByRole('button', { name: /Windyyyzz/ }));
    expect(screen.getByRole('menuitem', { name: 'Check Recent Deaths' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Death ID' })).not.toBeInTheDocument();
  });

  it('adds a death ID and displays its accounted item and killboard link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        chestLogText: '',
        chestSubmissions: [],
        chestSubmitters: [],
        deathChecks: [],
        events: [storedEvents[0]],
        hasChestLog: false,
      }),
    });
    addLootLogDeathId.mockResolvedValue({
      deathCheck: {
        deathAt: '2026-06-18T18:45:00.000Z',
        deathUrl: 'https://albiononline.com/killboard/kill/12345?server=live_us',
        eventId: '12345',
        matchedItems: [{ itemId: 'T4_CAPEITEM_FW_LYMHURST@3', quantity: 1 }],
        playerName: 'Windyyyzz',
        status: 'found',
      },
    });

    const { container } = render(
      <LootMonitor bundleId="bundle-18" canAddDeathId uploadUsername="Onslawht" />,
    );
    await screen.findByText('Windyyyzz');
    fireEvent.click(screen.getByRole('button', { name: 'Add Death ID' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Death ID for Windyyyzz' }), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add ID' }));

    await waitFor(() => expect(addLootLogDeathId).toHaveBeenCalledWith(expect.objectContaining({
      actorName: 'Onslawht',
      bundleId: 'bundle-18',
      deathId: '12345',
      player: 'Windyyyzz',
    })));
    const accountedTile = container.querySelector('.loot-item-tile.accounted-tile');
    expect(accountedTile).toBeInTheDocument();
    fireEvent.click(accountedTile);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      'https://albiononline.com/killboard/kill/12345?server=live_us',
    ));
    expect(screen.getByText('Death link copied')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Death' })).not.toBeInTheDocument();
    fireEvent.mouseEnter(accountedTile);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Death ID: 12345');
  });

  it('does not render standalone death text before or after a death ID is added', async () => {
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        chestLogText: '',
        chestSubmissions: [],
        deathChecks: [],
        events: [storedEvents[0]],
        hasChestLog: false,
      }),
    });
    addLootLogDeathId.mockResolvedValue({
      deathCheck: {
        deathUrl: 'https://albiononline.com/killboard/kill/12345?server=live_us',
        eventId: '12345',
        matchedItems: [{ itemId: 'T4_CAPEITEM_FW_LYMHURST@3', quantity: 1 }],
        playerName: 'Windyyyzz',
        status: 'found',
      },
    });

    render(<LootMonitor bundleId="bundle-18" canAddDeathId uploadUsername="Onslawht" />);
    await screen.findByText('Windyyyzz');
    expect(screen.queryByText('No Death Found')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Death ID' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Death ID for Windyyyzz' }), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add ID' }));

    expect(screen.queryByRole('link', { name: 'Death' })).not.toBeInTheDocument();
  });

  it('closes the death ID entry and clears its message when submitted empty', async () => {
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        chestLogText: '',
        chestSubmissions: [],
        deathChecks: [],
        events: [storedEvents[0]],
        hasChestLog: false,
      }),
    });

    render(<LootMonitor bundleId="bundle-18" canAddDeathId />);
    await screen.findByText('Windyyyzz');
    fireEvent.click(screen.getByRole('button', { name: 'Add Death ID' }));
    const input = screen.getByRole('textbox', { name: 'Death ID for Windyyyzz' });
    fireEvent.change(input, { target: { value: 'not-an-id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add ID' }));
    expect(await screen.findByText('Enter a valid death ID.')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add ID' }));

    expect(screen.queryByRole('textbox', { name: 'Death ID for Windyyyzz' })).not.toBeInTheDocument();
    expect(screen.queryByText('Enter a valid death ID.')).not.toBeInTheDocument();
    expect(addLootLogDeathId).not.toHaveBeenCalled();
  });

  it('keeps custody tooltips inside the viewport', async () => {
    fetchLootLogBundle.mockResolvedValue({
      bundle: createBundle({
        chestLogText: '',
        chestSubmissions: [],
        chestSubmitters: [],
        events: [storedEvents[0]],
        hasChestLog: false,
      }),
    });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    const boundsSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function getBounds() {
      if (this.classList?.contains('loot-item-custody-tooltip')) {
        return {
          bottom: 0,
          height: 120,
          left: 0,
          right: 360,
          top: 0,
          width: 360,
          x: 0,
          y: 0,
          toJSON: () => {},
        };
      }

      if (this.classList?.contains('loot-item-tile')) {
        return {
          bottom: 558,
          height: 58,
          left: 760,
          right: 818,
          top: 500,
          width: 58,
          x: 760,
          y: 500,
          toJSON: () => {},
        };
      }

      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => {},
      };
    });

    const { container } = render(<LootMonitor bundleId="bundle-18" />);

    expect(await screen.findByText('Windyyyzz')).toBeInTheDocument();
    fireEvent.mouseEnter(container.querySelector('.loot-item-tile.kept-tile'));

    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveStyle({
        left: '428px',
        top: '372px',
      });
    });

    boundsSpy.mockRestore();
  });

  it('copies a share link for the selected bundle', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      alliances: ['CHAIR'],
      guilds: ['Militant'],
      sortDirection: 'asc',
      status: ['kept'],
      tierFilters: ['tier4'],
      typeFilters: ['cape'],
    }));

    render(<LootMonitor bundleId="bundle-18" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Share' }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const sharedUrl = new URL(writeText.mock.calls[0][0]);
    const sharedParams = sharedUrl.searchParams;
    expect(sharedParams.has('filters')).toBe(false);
    expect(sharedUrl.hostname).toBe('militant-discord-interactions.ejjernigan.workers.dev');
    expect(sharedParams.get('bundle')).toBe('bundle-18');
    expect(sharedParams.getAll('a')).toEqual(['CHAIR']);
    expect(sharedParams.getAll('g')).toEqual(['Militant']);
    expect(sharedParams.getAll('s')).toEqual(['kept']);
    expect(sharedParams.getAll('t')).toEqual(['tier4']);
    expect(sharedParams.getAll('y')).toEqual(['cape']);
    expect(sharedParams.get('o')).toBe('asc');
    expect(sharedUrl.hash).toBe('');
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('loads filters from a shared loot log link', async () => {
    const previousHash = window.location.hash;
    window.location.hash = '#shared-log/bundle-18?a=CHAIR&g=Militant&s=kept&t=tier4&y=cape&o=asc';

    render(<LootMonitor bundleId="bundle-18" showShare={false} />);

    expect((await screen.findAllByText('18UTC-JUN-18')).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('Least to most')).toBeInTheDocument();
    const statusControl = screen.getByText('Status').closest('.filter-dropdown-control');
    expect(statusControl.querySelector('summary')).toHaveTextContent('Kept');
    const tierControl = screen.getByText('Tier').closest('.filter-dropdown-control');
    expect(tierControl.querySelector('summary')).toHaveTextContent('T4');
    const typeControl = screen.getByText('Item Type').closest('.filter-dropdown-control');
    expect(typeControl.querySelector('summary')).toHaveTextContent('Cape');

    window.location.hash = previousHash;
  });

  it('opens raw logs in a new tab', async () => {
    const rawWindow = {
      document: {
        close: vi.fn(),
        open: vi.fn(),
        write: vi.fn(),
      },
      focus: vi.fn(),
    };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(rawWindow);

    render(<LootMonitor bundleId="bundle-18" />);

    fireEvent.click(await screen.findByRole('button', { name: 'View Raw' }));
    const lootSearch = screen.getByRole('searchbox', { name: 'Search loot log' });
    const chestSearch = screen.getByRole('searchbox', { name: 'Search chest log' });
    fireEvent.change(lootSearch, { target: { value: 'Enemy' } });
    fireEvent.change(chestSearch, { target: { value: '06/18' } });
    expect(within(lootSearch.closest('section')).getByText('2 matches')).toBeInTheDocument();
    expect(within(chestSearch.closest('section')).getByText('1 match')).toBeInTheDocument();
    expect(lootSearch.closest('section').querySelectorAll('mark')).toHaveLength(2);
    expect(chestSearch.closest('section').querySelectorAll('mark')).toHaveLength(1);
    expect(lootSearch.closest('section').querySelectorAll('mark.active-match')).toHaveLength(1);

    const previousLootMatch = screen.getByRole('button', { name: 'Previous loot log match' });
    const nextLootMatch = screen.getByRole('button', { name: 'Next loot log match' });
    expect(previousLootMatch).toBeEnabled();
    expect(nextLootMatch).toBeEnabled();
    fireEvent.click(nextLootMatch);
    const lootMatches = lootSearch.closest('section').querySelectorAll('mark');
    expect(lootMatches[0]).not.toHaveClass('active-match');
    expect(lootMatches[1]).toHaveClass('active-match');

    fireEvent.click(screen.getByRole('button', { name: 'Open New Tab' }));

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(rawWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('raw-log-body'));
    expect(rawWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('Search loot log'));
    expect(rawWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('Search chest log'));
    expect(rawWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('Previous loot log match'));
    expect(rawWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('Next chest log match'));
    expect(rawWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('Loot Log'));
    expect(rawWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('Chest Log'));
    expect(rawWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('Windyyyzz'));
    expect(rawWindow.document.close).toHaveBeenCalled();
  });

  it('keeps the Kept status filter accessible when no chest log is loaded', async () => {
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
    expect(screen.getByRole('button', { name: 'Kept' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Lost' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deselect All' })).toHaveClass('disable-all');
    const lostOption = screen.getByRole('button', { name: 'Lost' });
    fireEvent.click(lostOption);
    expect(lostOption).toHaveClass('unselected-option');
    expect(statusLabel.nextElementSibling.querySelector('summary')).toHaveTextContent('4 selected');
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
            item: 'Direwolf Skin',
            itemId: 'T8_MOUNT_DIREWOLF_SKIN',
            player: 'TokenHolder',
            quantity: 1,
          },
          {
            ...storedEvents[0],
            enchantment: 0,
            item: "Master's Siege Hammer",
            itemId: 'T6_2H_TOOL_SIEGEHAMMER',
            player: 'TokenHolder',
            quantity: 1,
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
    expect(screen.getByLabelText('TokenHolder Kept 1 Direwolf Skin')).toBeInTheDocument();
    expect(screen.getByLabelText("TokenHolder Kept 1 Master's Siege Hammer")).toBeInTheDocument();
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
    expect(screen.getByText('Jun 20, 2026 11:45:00 EDT')).toBeInTheDocument();
    expect(screen.queryByText(/18:33 UTC/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Loot Monitor' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh logs' })).toHaveAttribute('title', 'Refresh logs');
    expect(screen.getByRole('button', { name: 'Open upload instructions' })).toHaveAttribute('title', 'Upload instructions');
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
    expect(screen.getByRole('button', { name: /(?:add|upload) chest log/i })).toBeInTheDocument();
    expect([...container.querySelector('.saved-log-actions').querySelectorAll('button')]
      .map((button) => button.textContent)).toEqual(['Edit', 'Download', 'Delete', 'View']);

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(onView).toHaveBeenCalledWith('bundle-18');

    fireEvent.click(screen.getByRole('button', { name: 'Open upload instructions' }));
    const instructionsDialog = screen.getByRole('dialog', { name: 'Upload Instructions' });
    const uploadGuide = within(instructionsDialog).getByRole('heading', { name: 'Upload Loot Logs' }).closest('details');
    expect(uploadGuide).toHaveTextContent('Use Upload to add one or more .csv/.txt loot log files.');
    expect(uploadGuide).toHaveTextContent('Run /upload in the thread containing the loot log files.');
    expect(within(instructionsDialog).queryByRole('heading', { name: 'Upload From The Webapp' })).not.toBeInTheDocument();
    expect(within(instructionsDialog).queryByRole('heading', { name: 'Upload From Discord' })).not.toBeInTheDocument();
    expect(within(instructionsDialog).queryByRole('heading', { name: 'Add Loot Files Later' })).not.toBeInTheDocument();
    expect(within(instructionsDialog).getByRole('heading', { name: 'Upload Chest Logs' })).toBeInTheDocument();
    expect(within(instructionsDialog).getByRole('heading', { name: 'Merge Loot Logs' })).toBeInTheDocument();
    expect(within(instructionsDialog).getByRole('heading', { name: 'Check And Add Deaths' })).toBeInTheDocument();
    const deathGuide = within(instructionsDialog).getByRole('heading', { name: 'Check And Add Deaths' }).closest('details');
    expect(deathGuide).not.toHaveAttribute('open');
    fireEvent.click(deathGuide.querySelector('summary'));
    expect(deathGuide).toHaveAttribute('open');
    expect(within(instructionsDialog).getByText('.csv or .txt')).toBeInTheDocument();
    expect(within(instructionsDialog).getByText('/upload')).toBeInTheDocument();
    expect(deathGuide).toHaveTextContent("Select a player's name and use Check Recent Deaths to view their Murderledger deaths.");
    expect(deathGuide).toHaveTextContent('For example, in the URL "/kill/123456789" has death ID 123456789.');
    expect(deathGuide).toHaveTextContent('Matching Kept inventory becomes Accounted.');
    expect(within(instructionsDialog).queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(within(instructionsDialog).getByRole('button', { name: 'Close upload instructions' }));
    expect(screen.queryByRole('dialog', { name: 'Upload Instructions' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /upload log/i }));
    let uploadDialog = screen.getByRole('dialog', { name: 'Upload Loot Logs' });
    expect(within(uploadDialog).queryByText('Ignore time restraints')).not.toBeInTheDocument();
    let modalLootInput = uploadDialog.querySelector('input[accept^=".csv"]');
    fireEvent.change(modalLootInput, {
      target: { files: [new File([lootText], 'loot-events.txt', { type: 'text/plain' })] },
    });
    fireEvent.click(within(uploadDialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(submitLootLog).toHaveBeenCalledWith({
      actorName: 'manual-web-upload',
      bundleId: null,
      lootLogText: lootText,
      originalFileName: 'loot-events.txt',
      username: 'manual-web-upload',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload Loot Logs' })).not.toBeInTheDocument());

    submitLootLog.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Add Loot Log' }));
    uploadDialog = screen.getByRole('dialog', { name: 'Upload Loot Logs' });
    const addLootInput = uploadDialog.querySelector('input[accept^=".csv"]');
    fireEvent.change(addLootInput, {
      target: { files: [new File([lootText], 'additional-loot-events.txt', { type: 'text/plain' })] },
    });
    fireEvent.click(within(uploadDialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(submitLootLog).toHaveBeenCalledWith({
      actorName: 'manual-web-upload',
      bundleId: 'bundle-18',
      lootLogText: lootText,
      originalFileName: 'additional-loot-events.txt',
      username: 'manual-web-upload',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload Loot Logs' })).not.toBeInTheDocument());

    submitLootLog.mockClear();
    const secondLootText = lootText.replace('Windyyyzz', 'SecondLogger');
    fireEvent.click(screen.getByRole('button', { name: /upload log/i }));
    uploadDialog = screen.getByRole('dialog', { name: 'Upload Loot Logs' });
    modalLootInput = uploadDialog.querySelector('input[accept^=".csv"]');
    fireEvent.change(modalLootInput, {
      target: {
        files: [
          new File([lootText], 'first-loot-events.txt', { type: 'text/plain' }),
          new File([secondLootText], 'second-loot-events.txt', { type: 'text/plain' }),
        ],
      },
    });
    fireEvent.click(within(uploadDialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(submitLootLog).toHaveBeenCalledTimes(2));
    expect(submitLootLog).toHaveBeenNthCalledWith(1, {
      actorName: 'manual-web-upload',
      bundleId: null,
      lootLogText: lootText,
      originalFileName: 'first-loot-events.txt',
      username: 'manual-web-upload',
    });
    expect(submitLootLog).toHaveBeenNthCalledWith(2, {
      actorName: 'manual-web-upload',
      bundleId: null,
      lootLogText: secondLootText,
      originalFileName: 'second-loot-events.txt',
      username: 'manual-web-upload',
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload Loot Logs' })).not.toBeInTheDocument());

    submitLootLog.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /upload log/i }));
    uploadDialog = screen.getByRole('dialog', { name: 'Upload Loot Logs' });
    const dropzone = uploadDialog.querySelector('.loot-upload-dropzone');
    const droppedLootFile = new File([lootText], 'dropped-loot-events.txt', { type: 'text/plain' });
    fireEvent.dragEnter(dropzone, { dataTransfer: { files: [droppedLootFile] } });
    expect(dropzone).toHaveClass('drag-over');
    expect(dropzone).toHaveTextContent('Drop loot logs');
    fireEvent.drop(dropzone, { dataTransfer: { files: [droppedLootFile] } });
    fireEvent.click(within(uploadDialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(submitLootLog).toHaveBeenCalledWith({
      actorName: 'manual-web-upload',
      bundleId: null,
      lootLogText: lootText,
      originalFileName: 'dropped-loot-events.txt',
      username: 'manual-web-upload',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload Loot Logs' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /(?:add|upload) chest log/i }));
    let chestDialog = screen.getByRole('dialog', { name: 'Upload Chest Log' });
    fireEvent.change(within(chestDialog).getByLabelText('Paste chest log'), { target: { value: chestText } });
    fireEvent.click(within(chestDialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(submitChestLog).toHaveBeenCalledWith({
      actorName: 'manual-web-upload',
      bundleId: 'bundle-18',
      chestLogText: chestText,
      lootLogName: 'loot-events-original',
      username: 'manual-web-upload',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload Chest Log' })).not.toBeInTheDocument());

    submitChestLog.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /(?:add|upload) chest log/i }));
    chestDialog = screen.getByRole('dialog', { name: 'Upload Chest Log' });
    const chestInput = chestDialog.querySelector('input[accept^=".txt"]');
    fireEvent.change(chestInput, {
      target: { files: [new File([chestText], 'chest.txt', { type: 'text/plain' })] },
    });
    fireEvent.click(within(chestDialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(submitChestLog).toHaveBeenCalledWith({
      actorName: 'manual-web-upload',
      bundleId: 'bundle-18',
      chestLogText: chestText,
      lootLogName: 'loot-events-original',
      username: 'manual-web-upload',
    }));

    submitChestLog.mockClear();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload Chest Log' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /(?:add|upload) chest log/i }));
    chestDialog = screen.getByRole('dialog', { name: 'Upload Chest Log' });
    const multiChestInput = chestDialog.querySelector('input[accept^=".txt"]');
    fireEvent.change(multiChestInput, {
      target: {
        files: [
          new File([chestText], 'first-chest.txt', { type: 'text/plain' }),
          new File([chestText], 'second-chest.txt', { type: 'text/plain' }),
        ],
      },
    });
    fireEvent.click(within(chestDialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(submitChestLog).toHaveBeenCalledTimes(2));
    expect(submitChestLog).toHaveBeenNthCalledWith(1, {
      actorName: 'manual-web-upload',
      bundleId: 'bundle-18',
      chestLogText: chestText,
      lootLogName: 'loot-events-original',
      username: 'manual-web-upload',
    });
    expect(submitChestLog).toHaveBeenNthCalledWith(2, {
      actorName: 'manual-web-upload',
      bundleId: 'bundle-18',
      chestLogText: chestText,
      lootLogName: 'loot-events-original',
      username: 'manual-web-upload',
    });
  });

  it('lets permitted users select and merge existing loot log bundles', async () => {
    fetchLootLogBundles.mockResolvedValue({
      bundles: [
        createBundle({ id: 'bundle-18', lootFileName: 'First CTA' }),
        createBundle({ id: 'bundle-20', lootFileName: 'Second CTA' }),
      ],
    });

    render(<LootLogArchive canMergeLogs uploadUsername="Frontline Soldier" />);

    const mergeButton = await screen.findByRole('button', { name: 'Merge' });
    expect(mergeButton).toBeDisabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText('First CTA').closest('article'));
    expect(mergeButton).toBeDisabled();
    fireEvent.contextMenu(screen.getByText('Second CTA').closest('article'));
    expect(mergeButton).toBeEnabled();
    expect(screen.getAllByText('Selected')).toHaveLength(2);
    fireEvent.click(mergeButton);

    await waitFor(() => expect(mergeLootLogBundles).toHaveBeenCalledWith({
      actorName: 'Frontline Soldier',
      bundleIds: ['bundle-18', 'bundle-20'],
      username: 'Frontline Soldier',
    }));
    expect(await screen.findByText('Merged - 18UTC-JUN-18 created.')).toBeInTheDocument();
  });

  it('lets permitted users override existing loot and chest logs', async () => {
    render(<LootLogArchive canOverrideChestLog canOverrideLootLog />);

    await screen.findByRole('button', { name: 'Add Loot Log' });
    fireEvent.click(screen.getByRole('button', { name: 'Add Loot Log' }));
    let dialog = screen.getByRole('dialog', { name: 'Upload Loot Logs' });
    const lootOverride = within(dialog).getByRole('checkbox', { name: 'Override Current Loot Log' });
    fireEvent.click(lootOverride);
    fireEvent.change(dialog.querySelector('input[accept^=".csv"]'), {
      target: { files: [new File([lootText], 'replacement-loot.txt', { type: 'text/plain' })] },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(submitLootLog).toHaveBeenCalledWith({
      actorName: 'manual-web-upload',
      bundleId: 'bundle-18',
      lootLogText: lootText,
      originalFileName: 'replacement-loot.txt',
      overrideCurrent: true,
      username: 'manual-web-upload',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload Loot Logs' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Add Chest Log' }));
    dialog = screen.getByRole('dialog', { name: 'Upload Chest Log' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Override Current Chest Log' }));
    fireEvent.change(within(dialog).getByLabelText('Paste chest log'), { target: { value: chestText } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(submitChestLog).toHaveBeenCalledWith({
      actorName: 'manual-web-upload',
      bundleId: 'bundle-18',
      chestLogText: chestText,
      lootLogName: '18UTC-JUN-18',
      overrideCurrent: true,
      username: 'manual-web-upload',
    }));
  });

  it('marks merged loot log entries', async () => {
    fetchLootLogBundles.mockResolvedValue({
      bundles: [createBundle({ summary: { isMerged: true, totals: { lootedQuantity: 2, players: 1 } } })],
    });

    render(<LootLogArchive />);

    expect(await screen.findByText('Merged')).toBeInTheDocument();
  });

  it('selects a loot log after a mobile tap and hold', async () => {
    render(<LootLogArchive canMergeLogs />);

    const titles = await screen.findAllByText('18UTC-JUN-18');
    const row = titles[0].closest('article');
    fireEvent.pointerDown(row, { clientX: 20, clientY: 20, pointerType: 'touch' });

    expect(await screen.findByText('Selected', {}, { timeout: 1000 })).toBeInTheDocument();
    fireEvent.pointerUp(row, { clientX: 20, clientY: 20, pointerType: 'touch' });
  });

  it('deletes a saved bundle only after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<LootLogArchive />);

    const deleteButton = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(deleteButton);
    expect(deleteLootLogBundle).not.toHaveBeenCalled();

    fireEvent.click(deleteButton);
    await waitFor(() => expect(deleteLootLogBundle).toHaveBeenCalledWith(
      'bundle-18',
      expect.objectContaining({
        actorName: 'manual-web-upload',
        bundle: expect.objectContaining({ id: 'bundle-18', lootFileName: '18UTC-JUN-18' }),
      }),
    ));
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it('deletes only linked chest logs after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<LootLogArchive />);

    const deleteChestButton = await screen.findByRole('button', { name: 'Delete Chest Log' });
    fireEvent.click(deleteChestButton);
    expect(deleteChestLogs).not.toHaveBeenCalled();

    fireEvent.click(deleteChestButton);
    await waitFor(() => expect(deleteChestLogs).toHaveBeenCalledWith(
      'bundle-18',
      expect.objectContaining({
        actorName: 'manual-web-upload',
        bundle: expect.objectContaining({ id: 'bundle-18', lootFileName: '18UTC-JUN-18' }),
      }),
    ));
    expect(deleteLootLogBundle).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it('hides both delete actions without delete permission', async () => {
    render(<LootLogArchive canDeleteLogs={false} />);

    await screen.findByRole('button', { name: 'View' });
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Chest Log' })).not.toBeInTheDocument();
  });

  it('orders saved bundles by uploaded date newest first', async () => {
    fetchLootLogBundles.mockResolvedValue({
      bundles: [
        createBundle({
          createdAt: '2026-07-09T01:50:00.000Z',
          id: 'older-bundle',
          lootFileName: 'Older CTA',
        }),
        createBundle({
          createdAt: '2026-07-10T04:08:00.000Z',
          id: 'newer-bundle',
          lootFileName: 'Newer CTA',
        }),
      ],
    });

    const { container } = render(<LootLogArchive />);

    expect(await screen.findByText('Newer CTA')).toBeInTheDocument();
    const rows = [...container.querySelectorAll('.saved-log-row')];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Newer CTA');
    expect(rows[0]).toHaveTextContent('Jul 10, 2026 00:08:00 EDT');
    expect(rows[1]).toHaveTextContent('Older CTA');
  });

  it('allows adding chest logs after one is already linked', async () => {
    render(<LootLogArchive />);

    expect(await screen.findByText('Chest linked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add chest log/i })).toBeInTheDocument();
  });

  it('stores the logged-in username as the loot and chest uploader', async () => {
    render(<LootLogArchive uploadUsername="Onslawht" />);

    fireEvent.click(await screen.findByRole('button', { name: /upload log/i }));
    const uploadDialog = screen.getByRole('dialog', { name: 'Upload Loot Logs' });
    fireEvent.change(uploadDialog.querySelector('input[accept^=".csv"]'), {
      target: { files: [new File([lootText], 'loot-events.txt', { type: 'text/plain' })] },
    });
    fireEvent.click(within(uploadDialog).getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(submitLootLog).toHaveBeenCalledWith({
      actorName: 'Onslawht',
      bundleId: null,
      lootLogText: lootText,
      originalFileName: 'loot-events.txt',
      username: 'Onslawht',
    }));

    fireEvent.click(screen.getByRole('button', { name: /add chest log/i }));
    const chestDialog = screen.getByRole('dialog', { name: 'Upload Chest Log' });
    const chestInput = chestDialog.querySelector('input[accept^=".txt"]');
    fireEvent.change(chestInput, {
      target: { files: [new File([chestText], 'chest.txt', { type: 'text/plain' })] },
    });
    fireEvent.click(within(chestDialog).getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(submitChestLog).toHaveBeenCalledWith({
      actorName: 'Onslawht',
      bundleId: 'bundle-18',
      chestLogText: chestText,
      lootLogName: '18UTC-JUN-18',
      username: 'Onslawht',
    }));
  });

  it('allows title-only editors to open edit mode without changing uploader names', async () => {
    render(<LootLogArchive canChangeLootLogTitle canEditLogs={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Loot Log Name')).toBeEnabled();
    expect(screen.getByLabelText('Loot Log Uploaded By')).toBeDisabled();
    expect(screen.getByLabelText('Chest Log Uploaded By')).toBeDisabled();
  });

  it('previews, customizes, cancels, and saves log metadata edits', async () => {
    const { container } = render(<LootLogArchive />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Loot Log Name')).toHaveValue('18UTC-JUN-18');
    expect(screen.getByLabelText('Loot Log Uploaded By')).toHaveValue('Manual');
    expect(screen.getByLabelText('Chest Log Uploaded By')).toHaveValue('Manual');
    expect(screen.queryByLabelText('UTC Date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('CTA Time')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Chest Log Name' })).not.toBeInTheDocument();
    expect(container.querySelector('.saved-log-name-suffix')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(updateLootLogBundle).not.toHaveBeenCalled();
    expect(screen.getAllByText('18UTC-JUN-18')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Loot Log Name'), { target: { value: 'Custom' } });
    fireEvent.change(screen.getByLabelText('Loot Log Uploaded By'), { target: { value: 'Onslawt' } });
    fireEvent.change(screen.getByLabelText('Chest Log Uploaded By'), { target: { value: 'Banker' } });
    fireEvent.keyDown(screen.getByLabelText('Chest Log Uploaded By'), { key: 'Enter' });

    await waitFor(() => expect(updateLootLogBundle).toHaveBeenCalledWith({
      actorName: 'manual-web-upload',
      bundleId: 'bundle-18',
      ctaHour: 18,
      dateUtc: '2026-06-18',
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

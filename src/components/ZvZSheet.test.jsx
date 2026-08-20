import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ZvZSheet from './ZvZSheet';
import { fetchZvZBuildLayouts, updateZvZBuildLayout } from '../services/zvzBuildsApi';

vi.mock('../services/zvzBuildsApi', () => ({
  createZvZBuildLayout: vi.fn(),
  fetchZvZBuildLayouts: vi.fn(),
  updateZvZBuildLayout: vi.fn(),
}));

const savedLayout = {
  builds: [{
    id: 'build-1',
    notes: '',
    number: 1,
    role: 'Tank',
    slots: {
      armor: [],
      boots: [],
      cape: [],
      foodPots: [],
      helm: [],
      mainHand: [{ itemId: 'T8_MAIN_SWORD', name: 'Broadsword', resolved: true }],
      offHand: [],
    },
  }],
  createdAt: '2026-08-08T12:00:00.000Z',
  id: 'layout-1',
  sourceFileName: 'builds.xlsx',
  title: 'Castle Defense',
  updatedAt: '2026-08-08T12:00:00.000Z',
  uploadedBy: 'Dyathix',
};

describe('ZvZSheet saved layouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchZvZBuildLayouts.mockResolvedValue({ layouts: [savedLayout] });
    updateZvZBuildLayout.mockResolvedValue({ layout: savedLayout });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('lets viewers open saved builds without exposing editing controls', async () => {
    render(<ZvZSheet />);

    expect(await screen.findByText('Tank')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ZVZ Sheet' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /search builds/i })).toBeInTheDocument();
    expect(screen.queryByText('Uploaded By')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy screenshot/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /extract/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^update$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('keeps upload and save inside edit mode', async () => {
    render(<ZvZSheet canEdit uploadedBy="Officer" />);

    const search = await screen.findByRole('searchbox', { name: /search builds/i });
    const edit = screen.getByRole('button', { name: /^edit$/i });
    expect(search.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText(/build title/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^update$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^upload$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^t8$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/main hand header/i)).not.toBeInTheDocument();
    fireEvent.click(edit);
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^upload$/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^t8$/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^update$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^view$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/main hand header/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add row/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^upload$/i })).not.toBeInTheDocument();
  });

  it('lets editors drag rows into a new saved order while keeping row numbers positional', async () => {
    fetchZvZBuildLayouts.mockResolvedValue({ layouts: [{
      ...savedLayout,
      builds: [
        {
          ...savedLayout.builds[0],
          number: 1,
          role: 'Alpha',
        },
        {
          ...savedLayout.builds[0],
          id: 'build-2',
          number: 2,
          role: 'Bravo',
        },
      ],
    }] });
    updateZvZBuildLayout.mockResolvedValue({ layout: savedLayout });
    const { container } = render(<ZvZSheet canEdit uploadedBy="Officer" />);

    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

    const tableBody = container.querySelector('.zvz-sheet-table tbody');
    const [firstRow, secondRow] = tableBody.querySelectorAll('tr');
    const dataTransfer = {
      data: {},
      effectAllowed: '',
      getData(type) {
        return this.data[type] || '';
      },
      setData(type, value) {
        this.data[type] = value;
      },
    };
    fireEvent.dragStart(firstRow, { dataTransfer });
    fireEvent.dragOver(secondRow, { dataTransfer });
    fireEvent.drop(secondRow, { dataTransfer });

    const [newFirstRow] = tableBody.querySelectorAll('tr');
    expect(within(newFirstRow).getByText('1')).toBeInTheDocument();
    expect(within(newFirstRow).getByDisplayValue('Bravo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(updateZvZBuildLayout).toHaveBeenCalled());
    const savedBuilds = updateZvZBuildLayout.mock.calls[0][0].builds;
    expect(savedBuilds[0]).toEqual(expect.objectContaining({ number: '1', role: 'Bravo' }));
    expect(savedBuilds[1]).toEqual(expect.objectContaining({ number: '2', role: 'Alpha' }));
  });

  it('opens the build-sheet uploader in a modal for a new layout', async () => {
    render(<ZvZSheet canEdit uploadedBy="Officer" />);

    await screen.findByRole('searchbox', { name: /search builds/i });
    expect(screen.queryByRole('button', { name: /choose file/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^upload$/i }));

    expect(screen.getByRole('dialog', { name: /upload zvz sheet/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose file/i })).toBeInTheDocument();
  });

  it('shows the screenshot control only with its permission', async () => {
    render(<ZvZSheet canCopyScreenshot />);

    await screen.findByText('Tank');
    expect(screen.getByRole('button', { name: /copy screenshot/i })).toBeInTheDocument();
  });

  it('shows the extract control only with its permission', async () => {
    render(<ZvZSheet canExtract />);

    await screen.findByText('Tank');
    expect(screen.getByRole('button', { name: /extract/i })).toBeInTheDocument();
  });

  it('resolves a saved chariot image from its item name', async () => {
    fetchZvZBuildLayouts.mockResolvedValue({ layouts: [{
      ...savedLayout,
      builds: [{
        ...savedLayout.builds[0],
        role: 'Battle Mount',
        slots: {
          ...savedLayout.builds[0].slots,
          mainHand: [{ imageUrl: '', itemId: '', name: 'Chariot', resolved: false }],
        },
      }],
    }] });

    const { container } = render(<ZvZSheet />);

    await screen.findByText('Chariot');
    const image = container.querySelector('.zvz-sheet-view-item img');
    expect(image).toHaveAttribute('src', expect.stringContaining('UNIQUE_MOUNT_TOWER_CHARIOT_CRYSTAL'));
  });

  it('marks unresolved sheet items as text-only until they are selected', async () => {
    fetchZvZBuildLayouts.mockResolvedValue({ layouts: [{
      ...savedLayout,
      builds: [{
        ...savedLayout.builds[0],
        role: 'DPS',
        sheetHeaders: ['#', 'Role', 'Main Hand', 'Off Hand', 'Helm', 'Armor', 'Boots', 'Cape', 'Food/Pots'],
        sheetRow: [
          { text: '1' },
          { text: 'DPS' },
          { items: [{ itemId: '', itemName: 'Realm', unresolved: true }], notes: 'Q2/W2/P3' },
          {},
          {},
          {},
          {},
          {},
          {},
        ],
        slots: {
          ...savedLayout.builds[0].slots,
          mainHand: [{ itemId: '', name: 'Realm', resolved: false, unresolved: true }],
        },
      }],
    }] });

    const { container } = render(<ZvZSheet />);

    await screen.findByText('Realm');
    const unresolvedCell = screen.getByText('Realm').closest('td');
    expect(unresolvedCell).toHaveClass('zvz-sheet-unresolved-cell');
    expect(unresolvedCell.querySelector('img')).toBeNull();
    expect(screen.getByText('Q2/W2/P3')).toBeInTheDocument();
    expect(container.querySelector('.zvz-sheet-view-item .zvz-sheet-item-fallback')).toBeNull();
  });

  it('does not show an image placeholder for unresolved item ids', async () => {
    fetchZvZBuildLayouts.mockResolvedValue({ layouts: [{
      ...savedLayout,
      builds: [{
        ...savedLayout.builds[0],
        role: 'Healer',
        sheetHeaders: ['#', 'Role', 'Main Hand', 'Off Hand', 'Helm', 'Armor', 'Boots', 'Cape', 'Food/Pots'],
        sheetRow: [
          { text: '1' },
          { text: 'Healer' },
          { items: [{ itemId: '1H', itemName: '1h Nature' }], notes: 'Q1/W5/P1' },
          {},
          {},
          {},
          {},
          {},
          {},
        ],
      }],
    }] });

    const { container } = render(<ZvZSheet />);

    await screen.findByText('1h Nature');
    const unresolvedCell = screen.getByText('1h Nature').closest('td');
    expect(unresolvedCell).toHaveClass('zvz-sheet-unresolved-cell');
    expect(unresolvedCell.querySelector('img')).toBeNull();
    expect(container.querySelector('.zvz-sheet-view-item .zvz-sheet-item-fallback')).toBeNull();
  });
});


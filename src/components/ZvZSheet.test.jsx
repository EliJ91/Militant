import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ZvZSheet from './ZvZSheet';
import { fetchZvZBuildLayouts } from '../services/zvzBuildsApi';

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
    expect(screen.queryByRole('button', { name: /^update$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('places search directly before the editor update control', async () => {
    render(<ZvZSheet canEdit uploadedBy="Officer" />);

    const search = await screen.findByRole('searchbox', { name: /search builds/i });
    const update = screen.getByRole('button', { name: /^update$/i });
    expect(search.compareDocumentPosition(update) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText(/build title/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  it('opens the build-sheet uploader in a modal for a new layout', async () => {
    render(<ZvZSheet canEdit uploadedBy="Officer" />);

    await screen.findByRole('searchbox', { name: /search builds/i });
    expect(screen.queryByRole('button', { name: /choose file/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^update$/i }));

    expect(screen.getByRole('dialog', { name: /update zvz sheet/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose file/i })).toBeInTheDocument();
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
    const image = container.querySelector('.zvz-sheet-item-preview img');
    expect(image).toHaveAttribute('src', expect.stringContaining('UNIQUE_MOUNT_TOWER_CHARIOT_CRYSTAL'));
  });
});


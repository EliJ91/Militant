import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ZvZInfographic from './ZvZInfographic';
import {
  deleteZvZBuildLayout,
  fetchZvZBuildLayouts,
  updateZvZBuildLayout,
} from '../services/zvzBuildsApi';

vi.mock('../services/zvzBuildsApi', () => ({
  createZvZBuildLayout: vi.fn(),
  deleteZvZBuildLayout: vi.fn(),
  fetchZvZBuildLayouts: vi.fn(),
  updateZvZBuildLayout: vi.fn(),
}));

const savedLayout = {
  builds: [{
    id: 'build-1',
    notes: '',
    number: 1,
    role: 'Tank',
    slots: { armor: [], boots: [], cape: [], foodPots: [], helm: [], mainHand: [], offHand: [] },
  }],
  createdAt: '2026-08-08T12:00:00.000Z',
  id: 'layout-1',
  sourceFileName: 'builds.xlsx',
  title: 'Castle Defense',
  updatedAt: '2026-08-08T12:00:00.000Z',
  uploadedBy: 'Dyathix',
};

describe('ZvZInfographic saved layouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchZvZBuildLayouts.mockResolvedValue({ layouts: [savedLayout] });
    updateZvZBuildLayout.mockResolvedValue({ layout: savedLayout });
    deleteZvZBuildLayout.mockResolvedValue({ deleted: true, id: savedLayout.id });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('lets viewers open saved builds without exposing editing controls', async () => {
    render(<ZvZInfographic />);

    expect((await screen.findAllByText('Castle Defense')).length).toBeGreaterThan(0);
    expect(screen.getByText('Uploaded by Dyathix')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new layout/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /overwrite layout/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('lets editors overwrite and delete saved builds', async () => {
    render(<ZvZInfographic canEdit uploadedBy="Officer" />);

    await screen.findByDisplayValue('Castle Defense');
    fireEvent.click(screen.getByRole('button', { name: /overwrite layout/i }));
    await waitFor(() => expect(updateZvZBuildLayout).toHaveBeenCalledWith(expect.objectContaining({
      id: 'layout-1',
      title: 'Castle Defense',
      uploadedBy: 'Officer',
    })));

    await waitFor(() => expect(screen.getByRole('button', { name: /^delete$/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(deleteZvZBuildLayout).toHaveBeenCalledWith({
      id: 'layout-1',
      title: 'Castle Defense',
    }));
  });

  it('opens the build-sheet uploader in a modal for a new layout', async () => {
    render(<ZvZInfographic canEdit uploadedBy="Officer" />);

    await screen.findByDisplayValue('Castle Defense');
    expect(screen.queryByRole('button', { name: /choose file/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /new layout/i }));

    expect(screen.getByRole('dialog', { name: /new layout/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose file/i })).toBeInTheDocument();
  });
});

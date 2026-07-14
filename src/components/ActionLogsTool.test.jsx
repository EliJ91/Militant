import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ActionLogsTool from './ActionLogsTool';
import { deleteActionLog, fetchActionLogs } from '../services/actionLogsApi';
import { fetchLootLogBundles } from '../services/lootLogApi';

vi.mock('../services/actionLogsApi', () => ({
  deleteActionLog: vi.fn(),
  fetchActionLogs: vi.fn(),
}));
vi.mock('../services/lootLogApi', () => ({ fetchLootLogBundles: vi.fn() }));

describe('ActionLogsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteActionLog.mockResolvedValue({ deleted: true });
    fetchLootLogBundles.mockResolvedValue({
      bundles: [{ id: 'bundle-1', logNumber: 22, lootFileName: '02 CTA 7-13' }],
    });
    fetchActionLogs.mockResolvedValue({
      actionLogs: [
        {
          action: 'Loot log uploaded from Discord',
          actorName: 'Onslawht',
          createdAt: '2026-07-14T16:40:37.000Z',
          details: { uploadedBy: 'Chapper' },
          id: 'action-1',
          targetId: 'bundle-1',
        },
        {
          action: 'Death check completed',
          actorName: 'Onslawht',
          createdAt: '2026-07-14T16:41:37.000Z',
          details: { players: ['MarkMPM'] },
          id: 'action-2',
          targetId: 'bundle-1',
        },
        {
          action: 'Loot log deleted',
          actorName: 'Onslawht',
          createdAt: '2026-07-14T16:42:37.000Z',
          details: {
            lootLogDate: '2026-07-13T02:00:00.000Z',
            lootLogName: '02 CTA 7-13',
            lootLogNumber: 22,
          },
          id: 'action-3',
          targetId: 'bundle-1',
        },
      ],
      hasMore: false,
      total: 3,
    });
  });

  afterEach(() => cleanup());

  it('shows the command user, file poster, player, title, and loot log number', async () => {
    render(<ActionLogsTool />);

    await waitFor(() => expect(screen.getAllByText('Onslawht')).toHaveLength(3));
    expect(screen.getByText('Uploaded Chapper log from Discord to Loot Log #22: 02 CTA 7-13')).toBeInTheDocument();
    expect(screen.getByText('Checked MarkMPM death for Loot Log #22: 02 CTA 7-13')).toBeInTheDocument();
    expect(screen.getByText('Deleted Loot Log #22: 02 CTA 7-13 (Jul 13, 2026)')).toBeInTheDocument();
  });

  it('lets the SuperUser delete an entry from its right-click menu', async () => {
    render(<ActionLogsTool canDelete />);
    const actionText = await screen.findByText('Uploaded Chapper log from Discord to Loot Log #22: 02 CTA 7-13');

    fireEvent.contextMenu(actionText, { clientX: 200, clientY: 180 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => expect(deleteActionLog).toHaveBeenCalledWith('action-1'));
    await waitFor(() => expect(actionText).not.toBeInTheDocument());
  });

  it('does not open a delete menu for other users', async () => {
    render(<ActionLogsTool />);
    const actionText = await screen.findByText('Uploaded Chapper log from Discord to Loot Log #22: 02 CTA 7-13');

    fireEvent.contextMenu(actionText, { clientX: 200, clientY: 180 });

    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

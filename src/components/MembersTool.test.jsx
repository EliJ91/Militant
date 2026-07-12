import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSiphonedEnergyMembers } from '../services/siphonedEnergyApi';
import MembersTool from './MembersTool';

vi.mock('../services/siphonedEnergyApi', () => ({
  fetchSiphonedEnergyMembers: vi.fn(),
}));

const members = [
  {
    dateAdded: '2026-07-10T12:00:00.000Z',
    deathFame: 500,
    playerId: 'player-one',
    playerKey: 'onslawht',
    playerName: 'Onslawht',
    pveKillFame: 2000,
    pvpDeathFameRatio: 2,
    pvpKillFame: 1000,
    refreshedAt: '2026-07-10T03:23:41.000Z',
  },
  {
    dateAdded: '2026-07-01T12:00:00.000Z',
    deathFame: 0,
    playerId: 'player-two',
    playerKey: 'dyathix',
    playerName: 'Dyathix',
    pveKillFame: 3000,
    pvpDeathFameRatio: null,
    pvpKillFame: 250,
    refreshedAt: '2026-07-10T03:23:41.000Z',
  },
];

describe('MembersTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    fetchSiphonedEnergyMembers.mockResolvedValue({ members });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('lists current guild members and fame data', async () => {
    render(<MembersTool />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    expect(await screen.findByText('Onslawht')).toBeInTheDocument();
    expect(screen.getByText('Dyathix')).toBeInTheDocument();
    expect(screen.queryByText('player-one')).not.toBeInTheDocument();
    expect(screen.queryByText('player-two')).not.toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByText('Date Added')).toBeInTheDocument();
    expect(within(table).getByText('PvP Kill Fame')).toBeInTheDocument();
    expect(within(table).getByText('PvE Kill Fame')).toBeInTheDocument();
    expect(within(table).getByText('Death Fame')).toBeInTheDocument();
    expect(within(table).getByText('PvP/Death')).toBeInTheDocument();
    expect(within(table).getByText('07/10/2026')).toBeInTheDocument();
    expect(within(table).getByText('1,000')).toBeInTheDocument();
    expect(within(table).getByText('2,000')).toBeInTheDocument();
    expect(within(table).getByText('500')).toBeInTheDocument();
    expect(within(table).getByText('2.00')).toBeInTheDocument();
    expect(within(table).getByText('-')).toBeInTheDocument();
    expect(screen.getByText('2 listed')).toBeInTheDocument();
  });

  it('copies the player id when a username is clicked', async () => {
    render(<MembersTool />);

    fireEvent.click(await screen.findByRole('button', { name: 'Onslawht' }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('player-one');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Onslawht ID copied'));
  });

  it('disables member updates for three days after the last update', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-12T12:00:00.000Z').getTime());

    render(<MembersTool canUpdate />);

    const updateButton = await screen.findByRole('button', { name: 'Update' });
    expect(updateButton).toBeDisabled();
    expect(updateButton).toHaveAttribute('title', 'Member list was updated within the last 3 days');
  });

  it('allows member updates after the three day cooldown', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-14T12:00:01.000Z').getTime());

    render(<MembersTool canUpdate />);

    const updateButton = await screen.findByRole('button', { name: 'Update' });
    expect(updateButton).not.toBeDisabled();
    expect(updateButton).toHaveAttribute('title', 'Update members');
  });

  it('searches usernames and sorts by table headers', async () => {
    render(<MembersTool />);

    expect(await screen.findByText('Onslawht')).toBeInTheDocument();
    let dataRows = screen.getAllByRole('row').slice(1);
    expect(within(dataRows[0]).getByText('Onslawht')).toBeInTheDocument();
    expect(dataRows[0]).toHaveClass('members-new-row');
    expect(screen.getByRole('columnheader', { name: /date added/i })).toHaveTextContent('v');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Username' }));
    dataRows = screen.getAllByRole('row').slice(1);
    expect(within(dataRows[0]).getByText('Dyathix')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /username/i })).toHaveTextContent('^');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Username' }));
    dataRows = screen.getAllByRole('row').slice(1);
    expect(within(dataRows[0]).getByText('Onslawht')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /username/i })).toHaveTextContent('v');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by PvP Kill Fame' }));
    dataRows = screen.getAllByRole('row').slice(1);
    expect(within(dataRows[0]).getByText('Dyathix')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sort by PvP Kill Fame' }));
    dataRows = screen.getAllByRole('row').slice(1);
    expect(within(dataRows[0]).getByText('Onslawht')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search member usernames' }), {
      target: { value: 'dya' },
    });
    expect(screen.getByText('Dyathix')).toBeInTheDocument();
    expect(screen.queryByText('Onslawht')).not.toBeInTheDocument();
    expect(screen.getByText('1 listed')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search member usernames' }), {
      target: { value: 'missing' },
    });
    expect(screen.getByText('No members match that username.')).toBeInTheDocument();
    expect(screen.getByText('0 listed')).toBeInTheDocument();
  });

  it('shows an error when members cannot be loaded', async () => {
    fetchSiphonedEnergyMembers.mockRejectedValue(new Error('member lookup failed'));

    render(<MembersTool />);

    await waitFor(() => expect(screen.getByText('member lookup failed')).toBeInTheDocument());
  });
});

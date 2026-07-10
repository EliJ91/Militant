import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSiphonedEnergyMembers } from '../services/siphonedEnergyApi';
import MembersTool from './MembersTool';

vi.mock('../services/siphonedEnergyApi', () => ({
  fetchSiphonedEnergyMembers: vi.fn(),
}));

const members = [
  {
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
    fetchSiphonedEnergyMembers.mockResolvedValue({ members });
  });

  afterEach(cleanup);

  it('lists current guild members and fame data', async () => {
    render(<MembersTool />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    expect(await screen.findByText('Onslawht')).toBeInTheDocument();
    expect(screen.getByText('Dyathix')).toBeInTheDocument();
    expect(screen.getByText('player-one')).toBeInTheDocument();
    expect(screen.getByText('player-two')).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByText('PvP Kill Fame')).toBeInTheDocument();
    expect(within(table).getByText('PvE Kill Fame')).toBeInTheDocument();
    expect(within(table).getByText('Death Fame')).toBeInTheDocument();
    expect(within(table).getByText('PvP/Death')).toBeInTheDocument();
    expect(within(table).getByText('1,000')).toBeInTheDocument();
    expect(within(table).getByText('2,000')).toBeInTheDocument();
    expect(within(table).getByText('500')).toBeInTheDocument();
    expect(within(table).getByText('2.00')).toBeInTheDocument();
    expect(within(table).getByText('-')).toBeInTheDocument();
    expect(screen.getByText('2 listed')).toBeInTheDocument();
  });

  it('shows an error when members cannot be loaded', async () => {
    fetchSiphonedEnergyMembers.mockRejectedValue(new Error('member lookup failed'));

    render(<MembersTool />);

    await waitFor(() => expect(screen.getByText('member lookup failed')).toBeInTheDocument());
  });
});

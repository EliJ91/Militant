import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSiphonedEnergyTransactions,
  updateSiphonedEnergyPlayerStar,
  updateSiphonedEnergyTransactions,
} from '../services/siphonedEnergyApi';
import SiphonedEnergyTracker from './SiphonedEnergyTracker';

vi.mock('../services/siphonedEnergyApi', () => ({
  fetchSiphonedEnergyTransactions: vi.fn(),
  updateSiphonedEnergyPlayerStar: vi.fn(),
  updateSiphonedEnergyTransactions: vi.fn(),
}));

const transactions = [
  {
    amount: -110,
    id: 'one',
    occurredAt: '2026-06-20T17:27:12',
    player: 'Bhrennoh',
    reason: 'Withdrawal',
  },
  {
    amount: -200,
    id: 'out',
    occurredAt: '2026-06-20T18:27:12',
    player: 'xSarge',
    reason: 'Withdrawal',
  },
  {
    amount: 6,
    id: 'two',
    occurredAt: '2026-06-20T20:40:07',
    player: 'Dyathix',
    reason: 'Deposit',
  },
];

describe('SiphonedEnergyTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSiphonedEnergyTransactions.mockResolvedValue({
      guildMemberPlayers: ['Bhrennoh', 'Dyathix'],
      starredPlayers: [],
      transactions,
    });
    updateSiphonedEnergyPlayerStar.mockImplementation(({ starred }) => Promise.resolve({
      guildMemberPlayers: ['Bhrennoh', 'Dyathix'],
      starredPlayers: starred ? ['Bhrennoh'] : [],
    }));
    updateSiphonedEnergyTransactions.mockResolvedValue({
      duplicateRows: 1,
      guildMemberPlayers: ['Bhrennoh', 'Dyathix'],
      insertedRows: 2,
      skippedRows: [],
      starredPlayers: [],
      transactions,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows flagged balances and the complete transaction log', async () => {
    render(<SiphonedEnergyTracker />);

    expect(await screen.findAllByText('Bhrennoh')).toHaveLength(2);
    expect(screen.getAllByText('-110')).toHaveLength(3);
    expect(screen.getByText('Dyathix')).toBeInTheDocument();
    expect(screen.getByText('+6')).toBeInTheDocument();
    expect(document.querySelector('.energy-negative-total')).toHaveTextContent('-110');
    expect(screen.getByRole('button', { name: 'Guild' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Non-Guild' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Starred' })).toBeInTheDocument();
    expect(document.querySelectorAll('.energy-debt-column')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Update Energy Log' })).not.toBeInTheDocument();
  });

  it('toggles and persists stars for negative tracker players', async () => {
    render(<SiphonedEnergyTracker />);

    const [negativePlayerName] = await screen.findAllByText('Bhrennoh');
    expect(screen.queryByLabelText('Bhrennoh starred')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /star bhrennoh/i })).not.toBeInTheDocument();

    const starredPlayerName = screen.getByRole('region', { name: /outstanding energy/i })
      .querySelector('.energy-debt-player > span');
    fireEvent.click(starredPlayerName);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Star' }));

    await waitFor(() => expect(updateSiphonedEnergyPlayerStar).toHaveBeenCalledWith({
      player: 'Bhrennoh',
      starred: true,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Starred' }));
    expect(await screen.findByLabelText('Bhrennoh starred')).toBeInTheDocument();

    const starredPlayerInFilteredList = screen.getByRole('region', { name: /outstanding energy/i })
      .querySelector('.energy-debt-player > span');
    fireEvent.click(starredPlayerInFilteredList);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove Star' }));
    await waitFor(() => expect(updateSiphonedEnergyPlayerStar).toHaveBeenLastCalledWith({
      player: 'Bhrennoh',
      starred: false,
    }));
  });

  it('hides update controls when updates are disabled', async () => {
    render(<SiphonedEnergyTracker canUpdate={false} />);

    expect(await screen.findByRole('heading', { name: 'Siphoned Energy Tracker' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update Log' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Update Energy Log' })).not.toBeInTheDocument();
  });

  it('filters the negative tracker by starred and out of guild players', async () => {
    fetchSiphonedEnergyTransactions.mockResolvedValue({
      guildMemberPlayers: ['Bhrennoh', 'Dyathix'],
      starredPlayers: ['Bhrennoh'],
      transactions,
    });

    render(<SiphonedEnergyTracker />);

    const debtSection = await screen.findByRole('region', { name: /outstanding energy/i });
    expect(debtSection).not.toHaveTextContent('Bhrennoh');
    expect(debtSection).not.toHaveTextContent('xSarge');

    fireEvent.click(screen.getByRole('button', { name: 'Starred' }));
    expect(screen.getByRole('button', { name: 'Guild' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Non-Guild' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Starred' })).toBeInTheDocument();
    expect(debtSection).toHaveTextContent('Bhrennoh');
    expect(document.querySelector('.energy-negative-total')).toHaveTextContent('-110');

    fireEvent.click(screen.getByRole('button', { name: 'Non-Guild' }));
    expect(debtSection).toHaveTextContent('xSarge');
    expect(debtSection).not.toHaveTextContent('Bhrennoh');
    expect(document.querySelector('.energy-negative-total')).toHaveTextContent('-200');

    fireEvent.click(screen.getByRole('button', { name: 'Guild' }));
    expect(debtSection).not.toHaveTextContent('Bhrennoh');
    expect(debtSection).not.toHaveTextContent('xSarge');
  });

  it('shows the last updated transaction date and omits zero time parts', async () => {
    const lastUpdate = new Date(Date.now() - (11 * 24 * 60 * 60 * 1000));
    const lastUpdateIso = lastUpdate.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const lastUpdateLabel = `${String(lastUpdate.getUTCMonth() + 1).padStart(2, '0')}/${String(lastUpdate.getUTCDate()).padStart(2, '0')}/${lastUpdate.getUTCFullYear()} ${String(lastUpdate.getUTCHours()).padStart(2, '0')}:${String(lastUpdate.getUTCMinutes()).padStart(2, '0')}:${String(lastUpdate.getUTCSeconds()).padStart(2, '0')}`;
    fetchSiphonedEnergyTransactions.mockResolvedValue({
      guildMemberPlayers: ['Bhrennoh', 'Dyathix'],
      transactions: [
        { ...transactions[0], occurredAt: '2026-01-01T00:00:00' },
        { ...transactions[1], occurredAt: lastUpdateIso },
      ],
    });

    render(<SiphonedEnergyTracker />);

    expect(await screen.findAllByText(lastUpdateLabel)).toHaveLength(2);
    const lastUpdated = document.querySelector('.energy-last-updated');
    expect(lastUpdated).toHaveTextContent('Last Updated');
    expect(lastUpdated).toHaveTextContent(lastUpdateLabel);
    expect(lastUpdated).toHaveTextContent('1 week 4 days ago');
    expect(lastUpdated).not.toHaveTextContent('0 months');
  });

  it('submits pasted text and refreshes the tracker', async () => {
    render(<SiphonedEnergyTracker />);
    await screen.findAllByText('Bhrennoh');

    fireEvent.click(screen.getByRole('button', { name: 'Update Log' }));
    expect(screen.getByRole('dialog', { name: 'Update Energy Log' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Paste the copied log here')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Date\\s+Player\\s+Reason\\s+Amount/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Siphoned Energy log'), {
      target: { value: 'copied game log' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(updateSiphonedEnergyTransactions).toHaveBeenCalledWith('copied game log'));
    expect(await screen.findByText('2 new transactions added, 1 already stored.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Update Energy Log' })).not.toBeInTheDocument();
  });

  it('closes the update dialog without submitting', async () => {
    render(<SiphonedEnergyTracker />);
    await screen.findAllByText('Bhrennoh');

    fireEvent.click(screen.getByRole('button', { name: 'Update Log' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close update log' }));

    expect(screen.queryByRole('dialog', { name: 'Update Energy Log' })).not.toBeInTheDocument();
    expect(updateSiphonedEnergyTransactions).not.toHaveBeenCalled();
  });
});

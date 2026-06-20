import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSiphonedEnergyTransactions,
  updateSiphonedEnergyTransactions,
} from '../services/siphonedEnergyApi';
import SiphonedEnergyTracker from './SiphonedEnergyTracker';

vi.mock('../services/siphonedEnergyApi', () => ({
  fetchSiphonedEnergyTransactions: vi.fn(),
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
    fetchSiphonedEnergyTransactions.mockResolvedValue({ transactions });
    updateSiphonedEnergyTransactions.mockResolvedValue({
      duplicateRows: 1,
      insertedRows: 2,
      skippedRows: [],
      transactions,
    });
  });

  afterEach(cleanup);

  it('shows flagged balances and the complete transaction log', async () => {
    render(<SiphonedEnergyTracker />);

    expect(await screen.findAllByText('Bhrennoh')).toHaveLength(2);
    expect(screen.getAllByText('-110')).toHaveLength(2);
    expect(screen.getByText('Dyathix')).toBeInTheDocument();
    expect(screen.getByText('+6')).toBeInTheDocument();
    expect(screen.getByText('1 flagged')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Update Energy Log' })).not.toBeInTheDocument();
  });

  it('submits pasted text and refreshes the tracker', async () => {
    render(<SiphonedEnergyTracker />);
    await screen.findAllByText('Bhrennoh');

    fireEvent.click(screen.getByRole('button', { name: 'Update Log' }));
    expect(screen.getByRole('dialog', { name: 'Update Energy Log' })).toBeInTheDocument();
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

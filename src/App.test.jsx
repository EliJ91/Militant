import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { fetchLootLogBundle } from './services/lootLogApi';

vi.mock('./services/lootLogApi', () => ({
  deleteLootLogBundle: vi.fn(),
  fetchLootLogBundle: vi.fn(),
  fetchLootLogBundles: vi.fn().mockResolvedValue({ bundles: [] }),
  submitChestLog: vi.fn(),
  submitLootLog: vi.fn(),
  updateLootLogBundle: vi.fn(),
}));

vi.mock('./services/siphonedEnergyApi', () => ({
  fetchSiphonedEnergyTransactions: vi.fn().mockResolvedValue({ transactions: [] }),
  updateSiphonedEnergyTransactions: vi.fn(),
}));

describe('App', () => {
  beforeEach(() => {
    window.location.hash = '';
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(cleanup);

  it('opens the dashboard from the landing button', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('militant#1');
    const { container } = render(<App />);

    expect(screen.queryByText('Member Access')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /enter|login/i }));

    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect(window.location.hash).toBe('#dashboard');
    expect(window.localStorage.getItem('militant.authenticated')).toBe('true');
    expect(screen.getByText('Browse uploaded CTA loot and chest logs.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open tool/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Siphoned Energy Tracker' })).toBeInTheDocument();
    expect(screen.getByText('Track deposits, withdrawals, and outstanding member balances.')).toBeInTheDocument();
    expect(container.querySelectorAll('.topbar .navigation-button')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /view loot logs/i }));

    expect(screen.getByRole('heading', { level: 1, name: 'Loot Logs' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#loot-logs');
    expect(container.querySelectorAll('.topbar .navigation-button')).toHaveLength(2);
    expect(withinTopbar(container, 'Dashboard')).toBeInTheDocument();
    expect(withinTopbar(container, 'Sign Out')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload log/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh logs' })).toBeInTheDocument();
  });

  it('opens the Siphoned Energy Tracker from the dashboard', () => {
    window.localStorage.setItem('militant.authenticated', 'true');
    window.location.hash = '#dashboard';
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /siphoned energy tracker/i }));

    expect(window.location.hash).toBe('#siphoned-energy');
    expect(screen.getByRole('heading', { level: 1, name: 'Siphoned Energy Tracker' })).toBeInTheDocument();
    expect(withinTopbar(container, 'Dashboard')).toBeInTheDocument();
    expect(withinTopbar(container, 'Sign Out')).toBeInTheDocument();
  });

  it('does not restore a previously selected loot log after a refresh', () => {
    window.localStorage.setItem('militant.authenticated', 'true');
    window.sessionStorage.setItem('militant.selectedLootLogBundle', 'stale-bundle');
    window.localStorage.setItem('militant.lootMonitor.filters.v3', JSON.stringify({
      sortDirection: 'asc',
      status: 'all',
      tierFilters: ['tier4'],
    }));
    window.location.hash = '#loot-monitor';

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Select a Stored Log' })).toBeInTheDocument();
    expect(window.localStorage.getItem('militant.lootMonitor.filters.v3')).toContain('tier4');
  });

  it('keeps protected routes behind the password prompt', () => {
    window.location.hash = '#dashboard';
    vi.spyOn(window, 'prompt').mockReturnValue('wrong');

    render(<App />);

    expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /enter|login/i }));
    expect(screen.getByText('Incorrect password.')).toBeInTheDocument();
    expect(window.localStorage.getItem('militant.authenticated')).toBeNull();
  });

  it('opens shared loot logs without login or topbar navigation', async () => {
    fetchLootLogBundle.mockResolvedValue({
      bundle: {
        chestLogText: '',
        ctaTimer: '02 UTC',
        events: [],
        hasChestLog: false,
        id: 'bundle-18',
        lootFileName: 'Shared CTA',
        startAt: '2026-06-29T02:00:00.000Z',
        submissions: [{ id: 'submission-1', submittedBy: 'Manual' }],
      },
    });
    window.location.hash = '#shared-log/bundle-18';

    const { container } = render(<App />);

    expect(await screen.findByRole('heading', { name: 'View Loot Log' })).toBeInTheDocument();
    expect(container.querySelector('.topbar')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('militant.authenticated')).toBeNull();
  });
});

function withinTopbar(container, name) {
  return [...container.querySelectorAll('.topbar .navigation-button')]
    .find((button) => button.textContent === name);
}

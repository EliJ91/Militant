import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./services/lootLogApi', () => ({
  deleteLootLogBundle: vi.fn(),
  fetchLootLogBundle: vi.fn(),
  fetchLootLogBundles: vi.fn().mockResolvedValue({ bundles: [] }),
  submitChestLog: vi.fn(),
  submitLootLog: vi.fn(),
  updateLootLogBundle: vi.fn(),
}));

describe('App', () => {
  beforeEach(() => {
    window.location.hash = '';
    window.sessionStorage.clear();
  });

  it('opens the dashboard from the landing button', () => {
    const { container } = render(<App />);

    expect(screen.queryByText('Member Access')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /enter|login/i }));

    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect(window.location.hash).toBe('#dashboard');
    expect(screen.getByText('Review kept, lost, resolved, and donated loot from CTA logs.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open tool/i })).not.toBeInTheDocument();
    expect(screen.getByText('Under Construction')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pending' })).toBeInTheDocument();
    expect(screen.getByText('Make a suggestion!')).toBeInTheDocument();
    expect(container.querySelectorAll('.topbar .navigation-button')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /loot monitor/i }));

    expect(screen.getByRole('heading', { name: /loot monitor/i })).toBeInTheDocument();
    expect(window.location.hash).toBe('#loot-monitor');
    expect(container.querySelectorAll('.topbar .navigation-button')).toHaveLength(2);
    expect(withinTopbar(container, 'Dashboard')).toBeInTheDocument();
    expect(withinTopbar(container, 'Sign Out')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View Logs' }));

    expect(screen.getByRole('heading', { level: 1, name: 'View Logs' })).toBeInTheDocument();
    expect(container.querySelectorAll('.topbar .navigation-button')).toHaveLength(2);
    expect(withinTopbar(container, 'Dashboard')).toBeInTheDocument();
    expect(withinTopbar(container, 'Sign Out')).toBeInTheDocument();
    expect(container.querySelector('.topbar')).not.toHaveTextContent('Loot Monitor');
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh logs' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Loot Monitor' }));
    expect(window.location.hash).toBe('#loot-monitor');
    expect(screen.getByRole('heading', { name: /loot monitor/i })).toBeInTheDocument();
  });
});

function withinTopbar(container, name) {
  return [...container.querySelectorAll('.topbar .navigation-button')]
    .find((button) => button.textContent === name);
}

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import {
  getCurrentAuthSession,
  onAuthStateChange,
  signInWithDiscord,
} from './services/authService';
import { fetchLootLogBundle } from './services/lootLogApi';
import { fetchDiscordMemberRoles, fetchPermissionSettings } from './services/permissionsApi';

let authStateCallback = null;

vi.mock('./services/authService', () => ({
  clearPendingAuthRoute: vi.fn(),
  getCurrentAuthSession: vi.fn(),
  getPendingAuthRoute: vi.fn(() => ''),
  isDiscordAuthConfigured: vi.fn(() => true),
  onAuthStateChange: vi.fn((callback) => {
    authStateCallback = callback;
    return vi.fn();
  }),
  signInWithDiscord: vi.fn().mockResolvedValue(undefined),
  signOutOfDiscord: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./services/lootLogApi', () => ({
  checkLootLogDeath: vi.fn(),
  checkLootLogDeaths: vi.fn(),
  deleteLootLogBundle: vi.fn(),
  fetchLootLogBundle: vi.fn(),
  fetchLootLogBundles: vi.fn().mockResolvedValue({ bundles: [] }),
  mergeLootLogBundles: vi.fn(),
  submitChestLog: vi.fn(),
  submitLootLog: vi.fn(),
  updateLootLogBundle: vi.fn(),
}));

vi.mock('./services/siphonedEnergyApi', () => ({
  fetchSiphonedEnergyMembers: vi.fn().mockResolvedValue({ members: [] }),
  fetchSiphonedEnergyTransactions: vi.fn().mockResolvedValue({ transactions: [] }),
  purgeSiphonedEnergyTransactions: vi.fn(),
  updateSiphonedEnergyPlayerStar: vi.fn(),
  updateSiphonedEnergyTransactions: vi.fn(),
}));

vi.mock('./services/permissionsApi', () => ({
  fetchDiscordMemberRoles: vi.fn().mockResolvedValue({ roleIds: [] }),
  fetchPermissionSettings: vi.fn().mockResolvedValue({ settings: { roles: [] }, updatedAt: null }),
  updatePermissionSettings: vi.fn().mockResolvedValue({ settings: { roles: [] }, updatedAt: null }),
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authStateCallback = null;
    getCurrentAuthSession.mockResolvedValue(null);
    signInWithDiscord.mockResolvedValue(undefined);
    window.location.hash = '';
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(cleanup);

  it('starts Discord login before opening the dashboard', async () => {
    const { container } = render(<App />);

    expect(screen.queryByText('Member Access')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /login with discord/i }));
    await waitFor(() => expect(signInWithDiscord).toHaveBeenCalledWith('#dashboard'));
    await waitFor(() => expect(onAuthStateChange).toHaveBeenCalled());
    await act(async () => {
      authStateCallback({
        user: {
          avatar: 'avatar-hash',
          id: '264193431830528006',
          username: 'Onslawht',
        },
      });
    });

    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect(window.location.hash).toBe('#dashboard');
    expect(screen.getByText('Browse uploaded CTA loot and chest logs.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open tool/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Siphoned Energy Tracker' })).toBeInTheDocument();
    expect(screen.getByText('Track deposits, withdrawals, and outstanding member balances.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByText('View current Militant guild members and fame totals.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Permissions' })).toBeInTheDocument();
    expect(screen.getByText('Map Discord roles to webapp access controls.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.getByTitle('Siphoned Energy Tracker').querySelector('img')).toHaveAttribute(
      'src',
      '/assets/siphoned-energy.png',
    );
    expect(screen.getByLabelText('Application version')).toHaveTextContent('v1.8.69');
    expect(screen.getByLabelText('Logged in as Onslawht')).toBeInTheDocument();
    expect(container.querySelector('.topbar-profile-avatar')).toHaveAttribute(
      'src',
      'https://cdn.discordapp.com/avatars/264193431830528006/avatar-hash.png?size=80',
    );
    expect(container.querySelectorAll('.topbar .navigation-button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Toggle navigation menu' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /view loot logs/i }));

    expect(screen.getByRole('heading', { level: 1, name: 'Loot Logs' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#loot-logs');
    expect(container.querySelectorAll('.topbar .navigation-button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Toggle navigation menu' })).toBeInTheDocument();
    expect(withinTopbar(container, 'Dashboard')).toBeInTheDocument();
    expect(withinTopbar(container, 'Sign Out')).toBeUndefined();
    fireEvent.click(container.querySelector('.topbar-profile-button'));
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
    expect(screen.queryByText('View As Roles')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload log/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh logs' })).toBeInTheDocument();
  });

  it('opens the Siphoned Energy Tracker from the dashboard', async () => {
    getCurrentAuthSession.mockResolvedValue({ user: { id: '264193431830528006' } });
    window.location.hash = '#dashboard';
    const { container } = render(<App />);

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /siphoned energy tracker/i }));

    expect(window.location.hash).toBe('#siphoned-energy');
    expect(screen.getByRole('heading', { level: 1, name: 'Siphoned Energy Tracker' })).toBeInTheDocument();
    expect(withinTopbar(container, 'Dashboard')).toBeInTheDocument();
    expect(withinTopbar(container, 'Sign Out')).toBeUndefined();
  });

  it('opens Members from the dashboard', async () => {
    getCurrentAuthSession.mockResolvedValue({ user: { id: '264193431830528006' } });
    window.location.hash = '#dashboard';
    const { container } = render(<App />);

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /members/i }));

    expect(window.location.hash).toBe('#members');
    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    expect(withinTopbar(container, 'Dashboard')).toBeInTheDocument();
    expect(withinTopbar(container, 'Sign Out')).toBeUndefined();
  });

  it('loads Discord server roles after login and grants matching webapp permissions', async () => {
    fetchPermissionSettings.mockResolvedValue({
      settings: {
        roles: [
          { id: 'role-row', name: 'Officer', roleId: 'discord-role-1', permissions: { viewMembers: true } },
        ],
      },
      updatedAt: null,
    });
    fetchDiscordMemberRoles.mockResolvedValue({
      discordUserId: 'discord-user-1',
      roleIds: ['discord-role-1'],
    });
    getCurrentAuthSession.mockResolvedValue({
      access_token: 'supabase-jwt',
      user: {
        id: 'supabase-user-id',
        user_metadata: { provider_id: 'discord-user-1' },
      },
    });
    window.location.hash = '#dashboard';

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Permissions' })).not.toBeInTheDocument();
    expect(fetchDiscordMemberRoles).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'supabase-jwt' }));
  });

  it('loads Discord server roles for direct Discord OAuth sessions', async () => {
    fetchPermissionSettings.mockResolvedValue({
      settings: {
        roles: [
          { id: 'soldier-row', name: 'Soldier', roleId: 'discord-soldier-role', permissions: { viewLogs: true } },
        ],
      },
      updatedAt: null,
    });
    fetchDiscordMemberRoles.mockResolvedValue({
      discordUserId: 'discord-user-2',
      guildNickname: 'Frontline Soldier',
      roleIds: ['discord-soldier-role'],
    });
    getCurrentAuthSession.mockResolvedValue({
      accessToken: 'discord-oauth-token',
      provider: 'discord',
      user: {
        id: 'discord-user-2',
        username: 'Soldier',
      },
    });
    window.location.hash = '#dashboard';

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'View Loot Logs' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Logged in as Frontline Soldier')).toBeInTheDocument();
    expect(fetchDiscordMemberRoles).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'discord-oauth-token' }));
  });

  it('opens Permissions from the dashboard', async () => {
    getCurrentAuthSession.mockResolvedValue({ user: { id: '264193431830528006' } });
    window.location.hash = '#dashboard';
    const { container } = render(<App />);

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /permissions/i }));

    expect(window.location.hash).toBe('#permissions');
    expect(screen.getByRole('heading', { level: 1, name: 'Permissions' })).toBeInTheDocument();
    expect(withinTopbar(container, 'Dashboard')).toBeInTheDocument();
    expect(withinTopbar(container, 'Sign Out')).toBeUndefined();
  });

  it('lets the SuperUser preview combined permissions from multiple roles', async () => {
    fetchPermissionSettings.mockResolvedValue({
      settings: {
        roles: [
          { id: 'officer-row', name: 'Officer', roleId: 'discord-officer-role', permissions: { viewMembers: true } },
          { id: 'soldier-row', name: 'Soldier', roleId: 'discord-soldier-role', permissions: { viewLogs: true } },
        ],
      },
      updatedAt: null,
    });
    getCurrentAuthSession.mockResolvedValue({ user: { id: '264193431830528006', username: 'Onslawht' } });
    window.location.hash = '#dashboard';
    const { container } = render(<App />);

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    fireEvent.contextMenu(container.querySelector('.topbar-profile-button'));
    fireEvent.click(await screen.findByRole('button', { name: 'Officer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Soldier' }));

    expect(screen.getByRole('button', { name: 'Officer' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Soldier' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'View Loot Logs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Permissions' })).not.toBeInTheDocument();
  });

  it('opens the Siphoned Energy Tracker without login but hides protected controls', () => {
    window.location.hash = '#siphoned-energy';
    const { container } = render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Siphoned Energy Tracker' })).toBeInTheDocument();
    expect(withinTopbar(container, 'Dashboard')).toBeUndefined();
    expect(withinTopbar(container, 'Sign Out')).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Update Log' })).not.toBeInTheDocument();
  });

  it('does not restore a previously selected loot log after a refresh', async () => {
    getCurrentAuthSession.mockResolvedValue({ user: { id: '264193431830528006' } });
    window.sessionStorage.setItem('militant.selectedLootLogBundle', 'stale-bundle');
    window.localStorage.setItem('militant.lootMonitor.filters.v3', JSON.stringify({
      sortDirection: 'asc',
      status: 'all',
      tierFilters: ['tier4'],
    }));
    window.location.hash = '#loot-monitor';

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Select a Stored Log' })).toBeInTheDocument();
    expect(window.localStorage.getItem('militant.lootMonitor.filters.v3')).toContain('tier4');
  });

  it('keeps protected routes behind Discord login', async () => {
    window.location.hash = '#dashboard';

    render(<App />);

    expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /login with discord/i }));
    await waitFor(() => expect(signInWithDiscord).toHaveBeenCalledWith('#dashboard'));
    await act(async () => {
      authStateCallback({ user: { id: '264193431830528006' } });
    });
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });
});

function withinTopbar(container, name) {
  return [...container.querySelectorAll('.topbar .navigation-button')]
    .find((button) => button.textContent === name);
}

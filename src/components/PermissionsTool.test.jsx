import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PERMISSIONS_STORAGE_KEY,
  resolvePermissionsForDiscordUser,
  SUPERUSER_DISCORD_USER_IDS,
  WEBAPP_PERMISSION_DEFINITIONS,
} from '../services/permissionsService';
import PermissionsTool from './PermissionsTool';
import {
  fetchPermissionSettings,
  updatePermissionSettings,
} from '../services/permissionsApi';

vi.mock('../services/permissionsApi', () => ({
  fetchPermissionSettings: vi.fn(),
  updatePermissionSettings: vi.fn(),
}));

const superUser = { id: SUPERUSER_DISCORD_USER_IDS[0], roleIds: [] };

describe('PermissionsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    fetchPermissionSettings.mockResolvedValue({ settings: { roles: [] }, updatedAt: '2026-07-12T00:00:00.000Z' });
    updatePermissionSettings.mockImplementation((settings) => Promise.resolve({
      settings,
      updatedAt: '2026-07-12T00:01:00.000Z',
    }));
  });

  afterEach(cleanup);

  it('renders role permission infrastructure and saves changes', async () => {
    render(<PermissionsTool currentUser={superUser} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Permissions' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Discord permission setup')).not.toBeInTheDocument();
    expect(screen.queryByText('Discord Server ID')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Role ID later')).not.toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Change Permissions' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'View Logs' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Delete Chest/Loot Logs' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Update Siphoned Energy Tracker' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader', { name: /General|Action Log|Loot Logs|Loot Log Viewer|Members|Player Loot History|Siphoned Energy/ }).map((heading) => heading.textContent)).toEqual([
      'General',
      'Action Log',
      'Loot Logs',
      'Loot Log Viewer',
      'Members',
      'Player Loot History',
      'Siphoned Energy',
    ]);
    expect(screen.queryByRole('columnheader', { name: 'Area' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New role name'), {
      target: { value: 'CTA Lead' },
    });
    fireEvent.change(screen.getByLabelText('New role id'), {
      target: { value: 'role-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Role' }));

    expect(screen.getByRole('columnheader', { name: 'CTA Lead' })).toBeInTheDocument();
    expect(screen.queryByLabelText('CTA Lead role name')).not.toBeInTheDocument();
    expect(screen.queryByText('ID role-123')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    const uploadLootLogsRow = screen.getByRole('rowheader', { name: 'Upload Loot Logs' }).closest('tr');
    fireEvent.click(within(uploadLootLogsRow).getByLabelText('Upload Loot Logs for CTA Lead'));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Permissions saved'));
    expect(updatePermissionSettings).toHaveBeenCalled();
    const saved = JSON.parse(window.localStorage.getItem(PERMISSIONS_STORAGE_KEY));
    expect(saved.guildId).toBeUndefined();
    expect(saved.roles.some((role) => role.name === 'CTA Lead' && role.roleId === 'role-123')).toBe(true);
    expect(saved.roles.find((role) => role.name === 'CTA Lead').permissions.uploadLootLogs).toBe(true);
  });

  it('requires a Discord role ID before adding a role', () => {
    render(<PermissionsTool currentUser={superUser} />);

    fireEvent.change(screen.getByLabelText('New role name'), {
      target: { value: 'CTA Lead' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Role' }));

    expect(screen.getByRole('status')).toHaveTextContent('A Discord role ID is required.');
    expect(screen.queryByLabelText('CTA Lead role name')).not.toBeInTheDocument();
  });

  it('lets Change Permissions users reorder, rename, and delete roles from the role menu', async () => {
    fetchPermissionSettings.mockResolvedValue({
      settings: {
        roles: [
          { id: 'officer-id', name: 'Officer', roleId: 'role-officer', permissions: { changePermissions: true } },
          { id: 'soldier-id', name: 'Soldier', roleId: 'role-soldier', permissions: {} },
        ],
      },
      updatedAt: '2026-07-12T00:00:00.000Z',
    });

    render(<PermissionsTool currentUser={superUser} />);

    expect(await screen.findByRole('columnheader', { name: 'Officer' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Soldier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Left' }));

    await waitFor(() => expect(updatePermissionSettings).toHaveBeenCalled());
    expect(updatePermissionSettings.mock.calls.at(-1)[0].roles.map((role) => role.name)).toEqual(['Soldier', 'Officer']);

    fireEvent.click(screen.getByRole('button', { name: 'Soldier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name' }));
    fireEvent.change(screen.getByLabelText('Edit Soldier role name'), {
      target: { value: 'Vanguard' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Name' }));

    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Vanguard' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Vanguard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Role' }));

    await waitFor(() => expect(screen.queryByRole('columnheader', { name: 'Vanguard' })).not.toBeInTheDocument());
  });

  it('gives the configured Discord SuperUser full control', () => {
    const resolvedPermissions = resolvePermissionsForDiscordUser(null, {
      discordUserId: SUPERUSER_DISCORD_USER_IDS[0],
    });

    expect(resolvedPermissions).toEqual(
      Object.fromEntries(WEBAPP_PERMISSION_DEFINITIONS.map((permission) => [permission.key, true])),
    );
  });

  it('recognizes the Supabase Discord provider id as the SuperUser id', () => {
    const resolvedPermissions = resolvePermissionsForDiscordUser(null, {
      id: 'supabase-auth-user-id',
      user_metadata: { provider_id: SUPERUSER_DISCORD_USER_IDS[0] },
    });

    expect(resolvedPermissions.changePermissions).toBe(true);
  });
});

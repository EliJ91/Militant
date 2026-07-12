import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PERMISSIONS_STORAGE_KEY,
  resolvePermissionsForDiscordUser,
  WEBAPP_ADMIN_DISCORD_USER_IDS,
  WEBAPP_PERMISSION_DEFINITIONS,
} from '../services/permissionsService';
import PermissionsTool from './PermissionsTool';

describe('PermissionsTool', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(cleanup);

  it('renders role permission infrastructure and saves changes', () => {
    render(<PermissionsTool />);

    expect(screen.getByRole('heading', { level: 1, name: 'Permissions' })).toBeInTheDocument();
    expect(screen.getByLabelText('Discord permission setup')).toBeInTheDocument();
    expect(screen.queryByText('Discord Server ID')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Role ID later')).not.toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'View Logs' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Update Siphoned Energy Tracker' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New role name'), {
      target: { value: 'CTA Lead' },
    });
    fireEvent.change(screen.getByLabelText('New role id'), {
      target: { value: 'role-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Role' }));

    const uploadLootLogsRow = screen.getByRole('row', { name: /Upload Loot Logs/i });
    fireEvent.click(within(uploadLootLogsRow).getByTitle('Upload Loot Logs for CTA Lead'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('status')).toHaveTextContent('Permissions saved');
    const saved = JSON.parse(window.localStorage.getItem(PERMISSIONS_STORAGE_KEY));
    expect(saved.guildId).toBeUndefined();
    expect(saved.roles.some((role) => role.name === 'CTA Lead' && role.roleId === 'role-123')).toBe(true);
  });

  it('requires a Discord role ID before adding a role', () => {
    render(<PermissionsTool />);

    fireEvent.change(screen.getByLabelText('New role name'), {
      target: { value: 'CTA Lead' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Role' }));

    expect(screen.getByRole('status')).toHaveTextContent('A Discord role ID is required.');
    expect(screen.queryByLabelText('CTA Lead role name')).not.toBeInTheDocument();
  });

  it('gives the configured Discord admin user full control', () => {
    const resolvedPermissions = resolvePermissionsForDiscordUser(null, {
      discordUserId: WEBAPP_ADMIN_DISCORD_USER_IDS[0],
    });

    expect(resolvedPermissions).toEqual(
      Object.fromEntries(WEBAPP_PERMISSION_DEFINITIONS.map((permission) => [permission.key, true])),
    );
  });
});

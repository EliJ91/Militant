import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERMISSIONS_STORAGE_KEY } from '../services/permissionsService';
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
    expect(screen.getByRole('columnheader', { name: 'View Logs' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Update Siphoned Energy Tracker' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Add server ID later'), {
      target: { value: 'discord-server-id' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Role' }));

    const newRoleRow = screen.getByLabelText('New Role role name').closest('tr');
    fireEvent.change(within(newRoleRow).getByLabelText('New Role role name'), {
      target: { value: 'CTA Lead' },
    });
    fireEvent.change(within(newRoleRow).getByLabelText('CTA Lead role id'), {
      target: { value: 'role-123' },
    });
    fireEvent.click(within(newRoleRow).getByTitle('Upload Loot Logs for CTA Lead'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('status')).toHaveTextContent('Permissions saved');
    const saved = JSON.parse(window.localStorage.getItem(PERMISSIONS_STORAGE_KEY));
    expect(saved.guildId).toBe('discord-server-id');
    expect(saved.roles.some((role) => role.name === 'CTA Lead' && role.roleId === 'role-123')).toBe(true);
  });
});

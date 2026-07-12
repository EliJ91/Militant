import { useMemo, useState } from 'react';
import {
  createRolePermissionRow,
  loadPermissionSettings,
  savePermissionSettings,
  WEBAPP_PERMISSION_DEFINITIONS,
} from '../services/permissionsService';

function formatSavedAt(value) {
  if (!value) return 'Not saved';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not saved';
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export default function PermissionsTool() {
  const [settings, setSettings] = useState(loadPermissionSettings);
  const [saveStatus, setSaveStatus] = useState('');

  const permissionGroups = useMemo(() => WEBAPP_PERMISSION_DEFINITIONS.reduce((groups, permission) => {
    const group = groups.find((entry) => entry.area === permission.area);
    if (group) {
      group.permissions.push(permission);
    } else {
      groups.push({ area: permission.area, permissions: [permission] });
    }
    return groups;
  }, []), []);

  function updateGuildId(guildId) {
    setSettings((current) => ({ ...current, guildId }));
    setSaveStatus('');
  }

  function updateRole(roleId, updates) {
    setSettings((current) => ({
      ...current,
      roles: current.roles.map((role) => (role.id === roleId ? { ...role, ...updates } : role)),
    }));
    setSaveStatus('');
  }

  function togglePermission(roleId, permissionKey) {
    setSettings((current) => ({
      ...current,
      roles: current.roles.map((role) => (
        role.id === roleId
          ? {
            ...role,
            permissions: {
              ...role.permissions,
              [permissionKey]: !role.permissions[permissionKey],
            },
          }
          : role
      )),
    }));
    setSaveStatus('');
  }

  function addRole() {
    setSettings((current) => ({
      ...current,
      roles: [...current.roles, createRolePermissionRow()],
    }));
    setSaveStatus('');
  }

  function removeRole(roleId) {
    setSettings((current) => ({
      ...current,
      roles: current.roles.filter((role) => role.id !== roleId),
    }));
    setSaveStatus('');
  }

  function saveSettings() {
    setSettings((current) => {
      const saved = savePermissionSettings(current);
      setSaveStatus('Permissions saved');
      return saved;
    });
  }

  return (
    <main className="dashboard-shell members-shell permissions-shell">
      <section className="dashboard-heading members-heading" aria-labelledby="permissions-title">
        <div>
          <p className="eyebrow">Tool</p>
          <h1 id="permissions-title">Permissions</h1>
        </div>
        <button className="view-logs-button" type="button" onClick={saveSettings}>
          Save
        </button>
      </section>

      <section className="permissions-config-grid" aria-label="Discord permission setup">
        <label className="permissions-field">
          <span>Discord Server ID</span>
          <input
            placeholder="Add server ID later"
            type="text"
            value={settings.guildId}
            onChange={(event) => updateGuildId(event.target.value)}
          />
        </label>
        <div className="permissions-summary-card">
          <span>Configured Roles</span>
          <strong>{settings.roles.length}</strong>
        </div>
        <div className="permissions-summary-card">
          <span>Last Saved</span>
          <strong>{formatSavedAt(settings.updatedAt)}</strong>
        </div>
      </section>

      {saveStatus ? <p className="permissions-toast" role="status">{saveStatus}</p> : null}

      <section className="members-table-section permissions-table-section" aria-labelledby="permissions-table-title">
        <div className="members-table-heading">
          <div>
            <p className="eyebrow">Discord Roles</p>
            <h2 id="permissions-table-title">Role Access Matrix</h2>
          </div>
          <button className="view-logs-button permissions-add-role" type="button" onClick={addRole}>
            Add Role
          </button>
        </div>

        <div className="permissions-table-wrap">
          <table className="permissions-table">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Role ID</th>
                {permissionGroups.map((group) => (
                  <th colSpan={group.permissions.length} key={group.area} scope="colgroup">
                    {group.area}
                  </th>
                ))}
                <th scope="col">Actions</th>
              </tr>
              <tr>
                <th aria-label="Role name" />
                <th aria-label="Discord role ID" />
                {permissionGroups.flatMap((group) => group.permissions.map((permission) => (
                  <th key={permission.key} scope="col">
                    {permission.label}
                  </th>
                )))}
                <th aria-label="Role actions" />
              </tr>
            </thead>
            <tbody>
              {settings.roles.map((role) => (
                <tr key={role.id}>
                  <td>
                    <input
                      aria-label={`${role.name} role name`}
                      className="permissions-role-input"
                      type="text"
                      value={role.name}
                      onChange={(event) => updateRole(role.id, { name: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${role.name} role id`}
                      className="permissions-role-input permissions-role-id-input"
                      placeholder="Role ID later"
                      type="text"
                      value={role.roleId}
                      onChange={(event) => updateRole(role.id, { roleId: event.target.value })}
                    />
                  </td>
                  {WEBAPP_PERMISSION_DEFINITIONS.map((permission) => (
                    <td key={permission.key}>
                      <button
                        aria-pressed={role.permissions[permission.key]}
                        className={role.permissions[permission.key] ? 'permissions-toggle enabled' : 'permissions-toggle'}
                        title={`${permission.label} for ${role.name}`}
                        type="button"
                        onClick={() => togglePermission(role.id, permission.key)}
                      >
                        {role.permissions[permission.key] ? 'On' : 'Off'}
                      </button>
                    </td>
                  ))}
                  <td>
                    <button className="permissions-remove-role" type="button" onClick={() => removeRole(role.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

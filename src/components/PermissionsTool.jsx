import { useEffect, useRef, useState } from 'react';
import {
  createRolePermissionRow,
  loadPermissionSettings,
  savePermissionSettings,
  WEBAPP_PERMISSION_DEFINITIONS,
} from '../services/permissionsService';

export default function PermissionsTool() {
  const [settings, setSettings] = useState(loadPermissionSettings);
  const [saveStatus, setSaveStatus] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleId, setNewRoleId] = useState('');
  const hasMounted = useRef(false);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    if (settings.roles.some((role) => !String(role.roleId || '').trim())) return;
    savePermissionSettings(settings);
    setSaveStatus('Permissions saved');
  }, [settings]);

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
    try {
      const role = createRolePermissionRow({
        name: newRoleName.trim() || 'Discord Role',
        roleId: newRoleId,
      });
      setSettings((current) => ({
        ...current,
        roles: [...current.roles, role],
      }));
      setNewRoleName('');
      setNewRoleId('');
      setSaveStatus('');
    } catch (error) {
      setSaveStatus(error.message || 'Role ID required');
    }
  }

  return (
    <main className="dashboard-shell members-shell permissions-shell">
      <section className="dashboard-heading members-heading" aria-labelledby="permissions-title">
        <div>
          <p className="eyebrow">Tool</p>
          <h1 id="permissions-title">Permissions</h1>
        </div>
      </section>

      {saveStatus ? <p className="permissions-toast" role="status">{saveStatus}</p> : null}

      <section className="members-table-section permissions-table-section" aria-labelledby="permissions-table-title">
        <div className="members-table-heading">
          <div>
            <p className="eyebrow">Discord Roles</p>
            <h2 id="permissions-table-title">Role Access Matrix</h2>
          </div>
          <div className="permissions-add-role-form">
            <input
              aria-label="New role name"
              className="permissions-role-input"
              placeholder="Role name"
              type="text"
              value={newRoleName}
              onChange={(event) => setNewRoleName(event.target.value)}
            />
            <input
              aria-label="New role id"
              className="permissions-role-input"
              placeholder="Discord role ID"
              type="text"
              value={newRoleId}
              onChange={(event) => setNewRoleId(event.target.value)}
            />
            <button className="view-logs-button permissions-add-role" type="button" onClick={addRole}>
              Add Role
            </button>
          </div>
        </div>

        <div className="permissions-table-wrap">
          <table className="permissions-table">
            <thead>
              <tr>
                <th className="permissions-name-column" scope="col">Permission</th>
                {settings.roles.map((role) => (
                  <th className="permissions-role-column" key={role.id} scope="col">
                    <span className="permissions-role-name">{role.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEBAPP_PERMISSION_DEFINITIONS.map((permission) => (
                <tr key={permission.key}>
                  <th className="permissions-name-column" scope="row">{permission.label}</th>
                  {settings.roles.map((role) => (
                    <td key={role.id}>
                      <input
                        aria-label={`${permission.label} for ${role.name}`}
                        checked={role.permissions[permission.key]}
                        className="permissions-checkbox"
                        title={`${permission.label} for ${role.name}`}
                        type="checkbox"
                        onChange={() => togglePermission(role.id, permission.key)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

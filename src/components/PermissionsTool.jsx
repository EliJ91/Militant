import { Fragment, useEffect, useRef, useState } from 'react';
import {
  fetchPermissionSettings,
  updatePermissionSettings as updateDatabasePermissionSettings,
} from '../services/permissionsApi';
import {
  cachePermissionSettings,
  createRolePermissionRow,
  loadPermissionSettings,
  normalizePermissionSettings,
  resolvePermissionsForDiscordUser,
  WEBAPP_PERMISSION_DEFINITIONS,
} from '../services/permissionsService';

const PERMISSION_GROUPS = WEBAPP_PERMISSION_DEFINITIONS.reduce((groups, permission) => {
  const currentGroup = groups.find((group) => group.title === permission.area);
  if (currentGroup) {
    currentGroup.permissions.push(permission);
  } else {
    groups.push({ title: permission.area, permissions: [permission] });
  }
  return groups;
}, []);

export default function PermissionsTool({ currentUser = null }) {
  const [settings, setSettings] = useState(loadPermissionSettings);
  const [activeRoleMenuId, setActiveRoleMenuId] = useState('');
  const [editingRoleId, setEditingRoleId] = useState('');
  const [editingRoleName, setEditingRoleName] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleId, setNewRoleId] = useState('');
  const hasMounted = useRef(false);
  const pendingPermissionChangeRef = useRef(false);
  const saveQueueRef = useRef(Promise.resolve());
  const skipNextSaveRef = useRef(false);
  const activePermissions = resolvePermissionsForDiscordUser(settings, currentUser || {});
  const canChangePermissions = Boolean(activePermissions.changePermissions);

  useEffect(() => {
    let cancelled = false;

    fetchPermissionSettings()
      .then(async (result) => {
        if (cancelled) return;
        if (pendingPermissionChangeRef.current) return;
        const remoteSettings = normalizePermissionSettings({
          ...(result.settings || {}),
          updatedAt: result.updatedAt,
        });
        const localSettings = loadPermissionSettings();
        const canSeedRemote = remoteSettings.roles.length === 0
          && localSettings.roles.length > 0
          && resolvePermissionsForDiscordUser(localSettings, currentUser || {}).changePermissions;
        const loadedSource = canSeedRemote
          ? await updateDatabasePermissionSettings(localSettings)
          : result;
        if (cancelled || pendingPermissionChangeRef.current) return;
        const loaded = cachePermissionSettings({
          ...(loadedSource.settings || {}),
          updatedAt: loadedSource.updatedAt,
        });
        skipNextSaveRef.current = true;
        setSettings(loaded);
      })
      .catch((error) => {
        if (!cancelled) {
          setSettings(loadPermissionSettings());
          setSaveStatus(error.message ? 'Using cached permissions' : '');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    if (!activeRoleMenuId) return undefined;

    function closeRoleMenu(event) {
      if (!event.target.closest('.permissions-role-menu-wrap')) {
        setActiveRoleMenuId('');
        setEditingRoleId('');
      }
    }

    document.addEventListener('mousedown', closeRoleMenu);
    document.addEventListener('touchstart', closeRoleMenu);
    return () => {
      document.removeEventListener('mousedown', closeRoleMenu);
      document.removeEventListener('touchstart', closeRoleMenu);
    };
  }, [activeRoleMenuId]);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (!canChangePermissions && !pendingPermissionChangeRef.current) return;
    if (settings.roles.some((role) => !String(role.roleId || '').trim())) return;
    const cached = cachePermissionSettings(settings);
    setSaveStatus('Saving permissions...');
    saveQueueRef.current = saveQueueRef.current
      .catch(() => {})
      .then(() => updateDatabasePermissionSettings(cached))
      .then((result) => {
        cachePermissionSettings({
          ...(result.settings || cached),
          updatedAt: result.updatedAt,
        });
        pendingPermissionChangeRef.current = false;
        setSaveStatus('Permissions saved');
      })
      .catch((error) => {
        setSaveStatus(error.message || 'Could not save permissions to database.');
      });
  }, [canChangePermissions, settings]);

  function togglePermission(roleId, permissionKey) {
    if (!canChangePermissions) return;
    pendingPermissionChangeRef.current = true;
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
    if (!canChangePermissions) return;
    try {
      pendingPermissionChangeRef.current = true;
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

  function moveRole(roleId, direction) {
    if (!canChangePermissions) return;
    pendingPermissionChangeRef.current = true;
    setSettings((current) => {
      const roles = [...current.roles];
      const index = roles.findIndex((role) => role.id === roleId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= roles.length) return current;
      [roles[index], roles[targetIndex]] = [roles[targetIndex], roles[index]];
      return { ...current, roles };
    });
    setActiveRoleMenuId('');
    setSaveStatus('');
  }

  function beginEditRole(role) {
    if (!canChangePermissions) return;
    setEditingRoleId(role.id);
    setEditingRoleName(role.name);
  }

  function saveRoleName(roleId) {
    if (!canChangePermissions) return;
    pendingPermissionChangeRef.current = true;
    const roleName = editingRoleName.trim();
    if (!roleName) return;
    setSettings((current) => ({
      ...current,
      roles: current.roles.map((role) => (
        role.id === roleId ? { ...role, name: roleName } : role
      )),
    }));
    setEditingRoleId('');
    setActiveRoleMenuId('');
    setSaveStatus('');
  }

  function deleteRole(roleId) {
    if (!canChangePermissions) return;
    pendingPermissionChangeRef.current = true;
    setSettings((current) => ({
      ...current,
      roles: current.roles.filter((role) => role.id !== roleId),
    }));
    setActiveRoleMenuId('');
    setEditingRoleId('');
    setSaveStatus('');
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
          {canChangePermissions ? (
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
          ) : null}
        </div>

        <div className="permissions-table-wrap">
          <table className="permissions-table">
            <thead>
              <tr>
                <th className="permissions-name-column" scope="col">Permission</th>
                {settings.roles.map((role, index) => (
                  <th className="permissions-role-column" key={role.id} scope="col">
                    <div className="permissions-role-menu-wrap">
                      <button
                        aria-expanded={activeRoleMenuId === role.id}
                        className="permissions-role-name-button"
                        disabled={!canChangePermissions}
                        title={canChangePermissions ? `Edit ${role.name}` : role.name}
                        type="button"
                        onClick={() => setActiveRoleMenuId((current) => (current === role.id ? '' : role.id))}
                      >
                        {role.name}
                      </button>
                      {activeRoleMenuId === role.id && canChangePermissions ? (
                        <div className="permissions-role-menu" role="menu">
                          {editingRoleId === role.id ? (
                            <>
                              <input
                                aria-label={`Edit ${role.name} role name`}
                                className="permissions-role-input"
                                type="text"
                                value={editingRoleName}
                                onChange={(event) => setEditingRoleName(event.target.value)}
                              />
                              <button type="button" onClick={() => saveRoleName(role.id)}>Save Name</button>
                              <button type="button" onClick={() => setEditingRoleId('')}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button disabled={index === 0} type="button" onClick={() => moveRole(role.id, -1)}>Move Left</button>
                              <button disabled={index === settings.roles.length - 1} type="button" onClick={() => moveRole(role.id, 1)}>Move Right</button>
                              <button type="button" onClick={() => beginEditRole(role)}>Edit Name</button>
                              <button className="danger" type="button" onClick={() => deleteRole(role.id)}>Delete Role</button>
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((group) => (
                <Fragment key={group.title}>
                  <tr className="permissions-group-row">
                    <th colSpan={settings.roles.length + 1} scope="colgroup">{group.title}</th>
                  </tr>
                  {group.permissions.map((permission) => (
                    <tr key={permission.key}>
                      <th className="permissions-name-column" scope="row">{permission.label}</th>
                      {settings.roles.map((role) => (
                        <td key={role.id}>
                          <input
                            aria-label={`${permission.label} for ${role.name}`}
                            checked={role.permissions[permission.key]}
                            className="permissions-checkbox"
                            disabled={!canChangePermissions}
                            title={`${permission.label} for ${role.name}`}
                            type="checkbox"
                            onChange={() => togglePermission(role.id, permission.key)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

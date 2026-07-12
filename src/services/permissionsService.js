export const PERMISSIONS_STORAGE_KEY = 'militant.discord.permissions.v1';

export const WEBAPP_ADMIN_DISCORD_USER_IDS = ['264193431830528006'];

export const WEBAPP_PERMISSION_DEFINITIONS = [
  { key: 'changePermissions', label: 'Change Permissions', area: 'Admin' },
  { key: 'viewLogs', label: 'View Logs', area: 'Loot Logs' },
  { key: 'viewLootLog', label: 'View A Loot Log', area: 'Loot Logs' },
  { key: 'uploadLootLogs', label: 'Upload Loot Logs', area: 'Loot Logs' },
  { key: 'editLootLogs', label: 'Edit Loot Logs', area: 'Loot Logs' },
  { key: 'uploadChestLogs', label: 'Upload Chest Logs', area: 'Loot Logs' },
  { key: 'searchDeaths', label: 'Search For Deaths', area: 'Loot Logs' },
  { key: 'viewMembers', label: 'View Members', area: 'Members' },
  { key: 'updateMembersList', label: 'Update Members List', area: 'Members' },
  { key: 'viewSiphonedEnergy', label: 'View Siphoned Energy Tracker', area: 'Siphoned Energy' },
  { key: 'updateSiphonedEnergy', label: 'Update Siphoned Energy Tracker', area: 'Siphoned Energy' },
];

const DEFAULT_ROLE_TEMPLATES = [];

export function createDefaultPermissionSettings() {
  return {
    roles: DEFAULT_ROLE_TEMPLATES.map(normalizeRolePermissions),
    updatedAt: null,
  };
}

export function loadPermissionSettings() {
  try {
    const rawSettings = window.localStorage.getItem(PERMISSIONS_STORAGE_KEY);
    if (!rawSettings) return createDefaultPermissionSettings();
    return normalizePermissionSettings(JSON.parse(rawSettings));
  } catch {
    return createDefaultPermissionSettings();
  }
}

export function normalizePermissionSettings(settings) {
  const roles = Array.isArray(settings?.roles)
    ? settings.roles.map(normalizeRolePermissions).filter((role) => role.roleId)
    : createDefaultPermissionSettings().roles;

  return {
    roles,
    updatedAt: settings?.updatedAt || null,
  };
}

export function cachePermissionSettings(settings) {
  const normalized = {
    ...normalizePermissionSettings(settings),
    updatedAt: settings?.updatedAt || new Date().toISOString(),
  };
  window.localStorage.setItem(PERMISSIONS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export const savePermissionSettings = cachePermissionSettings;

export function createRolePermissionRow({ name = 'New Role', roleId = '' } = {}) {
  const normalizedRoleId = String(roleId || '').trim();
  if (!normalizedRoleId) throw new Error('A Discord role ID is required.');
  return normalizeRolePermissions({
    id: globalThis.crypto?.randomUUID?.() || `role-${Date.now()}`,
    name,
    roleId: normalizedRoleId,
    permissions: {},
  });
}

export function resolvePermissionsForRoleIds(settings, roleIds = []) {
  const normalized = normalizePermissionSettings(settings);
  const assignedRoleIds = new Set(roleIds.map((roleId) => String(roleId)));

  return normalized.roles.reduce((resolved, role) => {
    if (!role.roleId || !assignedRoleIds.has(role.roleId)) return resolved;
    WEBAPP_PERMISSION_DEFINITIONS.forEach((permission) => {
      resolved[permission.key] = Boolean(resolved[permission.key] || role.permissions[permission.key]);
    });
    return resolved;
  }, Object.fromEntries(WEBAPP_PERMISSION_DEFINITIONS.map((permission) => [permission.key, false])));
}

export function resolvePermissionsForDiscordUser(settings, user = {}) {
  const discordUserId = String(user.discordUserId || user.id || '');
  if (WEBAPP_ADMIN_DISCORD_USER_IDS.includes(discordUserId)) {
    return Object.fromEntries(WEBAPP_PERMISSION_DEFINITIONS.map((permission) => [permission.key, true]));
  }
  return resolvePermissionsForRoleIds(settings, user.roleIds || []);
}

function normalizeRolePermissions(role) {
  const incomingPermissions = role?.permissions || {};
  return {
    id: String(role?.id || globalThis.crypto?.randomUUID?.() || `role-${Date.now()}`),
    name: String(role?.name || 'Discord Role'),
    roleId: String(role?.roleId || ''),
    permissions: Object.fromEntries(
      WEBAPP_PERMISSION_DEFINITIONS.map((permission) => [
        permission.key,
        Boolean(incomingPermissions[permission.key]),
      ]),
    ),
  };
}

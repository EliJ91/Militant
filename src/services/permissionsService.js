export const PERMISSIONS_STORAGE_KEY = 'militant.discord.permissions.v1';

export const SUPERUSER_DISCORD_USER_IDS = ['264193431830528006'];
export const PERMISSIONS_CHANGED_EVENT = 'militant-permissions-change';

export const WEBAPP_PERMISSION_DEFINITIONS = [
  { key: 'changePermissions', label: 'Change Permissions', area: 'General' },
  { key: 'viewActionLog', label: 'View Action Log', area: 'Action Log' },
  { key: 'viewLogs', label: 'View Logs', area: 'Loot Logs' },
  { key: 'viewLootLog', label: 'View A Loot Log', area: 'Loot Logs' },
  { key: 'uploadLootLogs', label: 'Upload Loot Logs', area: 'Loot Logs' },
  { key: 'uploadLootLogsFromDiscord', label: 'Upload Loot Logs From Discord', area: 'Loot Logs' },
  { key: 'mergeLootLogs', label: 'Merge Loot Logs', area: 'Loot Logs' },
  { key: 'editLootLogs', label: 'Edit Loot Logs', area: 'Loot Logs' },
  { key: 'changeLootLogTitle', label: 'Edit Loot Log Title', area: 'Loot Logs' },
  { key: 'uploadChestLogs', label: 'Upload Chest Logs', area: 'Loot Logs' },
  { key: 'overrideLootLog', label: 'Override Loot Log', area: 'Loot Logs' },
  { key: 'overrideChestLog', label: 'Override Chest Log', area: 'Loot Logs' },
  { key: 'deleteChestLootLogs', label: 'Delete Chest/Loot Logs', area: 'Loot Logs' },
  { key: 'addDeathId', label: 'Add Death ID', area: 'Loot Logs' },
  { key: 'viewHiddenLootLogPlayers', label: 'View Hidden Players (Loot Log)', area: 'Loot Logs' },
  { key: 'viewLootLogViewer', label: 'View Loot Log Viewer', area: 'Loot Log Viewer' },
  { key: 'viewMembers', label: 'View Members', area: 'Members' },
  { key: 'updateMembersList', label: 'Update Members List', area: 'Members' },
  { key: 'viewPlayerHistory', label: 'View Player Loot History', area: 'Player Loot History' },
  { key: 'viewSiphonedEnergy', label: 'View Siphoned Energy Tracker', area: 'Siphoned Energy' },
  { key: 'updateSiphonedEnergy', label: 'Update Siphoned Energy Tracker', area: 'Siphoned Energy' },
];

function createDefaultPermissionSettings() {
  return {
    roles: [],
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
  window.dispatchEvent?.(new CustomEvent(PERMISSIONS_CHANGED_EVENT, { detail: normalized }));
  return normalized;
}

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
  const assignedRoleIds = new Set(roleIds.map((roleId) => String(roleId).trim()).filter(Boolean));

  return normalized.roles.reduce((resolved, role) => {
    if (!role.roleId || !assignedRoleIds.has(role.roleId)) return resolved;
    WEBAPP_PERMISSION_DEFINITIONS.forEach((permission) => {
      resolved[permission.key] = Boolean(resolved[permission.key] || role.permissions[permission.key]);
    });
    return resolved;
  }, Object.fromEntries(WEBAPP_PERMISSION_DEFINITIONS.map((permission) => [permission.key, false])));
}

export function resolvePermissionsForDiscordUser(settings, user = {}) {
  const discordUserId = getDiscordUserId(user);
  if (SUPERUSER_DISCORD_USER_IDS.includes(discordUserId)) {
    return Object.fromEntries(WEBAPP_PERMISSION_DEFINITIONS.map((permission) => [permission.key, true]));
  }
  return resolvePermissionsForRoleIds(settings, user.roleIds || []);
}

export function getDiscordUserId(user = {}) {
  const metadata = user.user_metadata || user.userMetadata || {};
  const identity = Array.isArray(user.identities)
    ? user.identities.find((currentIdentity) => currentIdentity.provider === 'discord') || user.identities[0]
    : null;
  const identityData = identity?.identity_data || identity?.identityData || {};

  return String(
    user.discordUserId
      || user.providerId
      || user.provider_id
      || metadata.discordUserId
      || metadata.discord_user_id
      || metadata.provider_id
      || metadata.providerId
      || metadata.sub
      || identityData.sub
      || identityData.provider_id
      || identity?.id
      || user.id
      || '',
  );
}

function normalizeRolePermissions(role) {
  const incomingPermissions = role?.permissions || {};
  return {
    id: String(role?.id || globalThis.crypto?.randomUUID?.() || `role-${Date.now()}`),
    name: String(role?.name || 'Discord Role'),
    roleId: String(role?.roleId || '').trim(),
    permissions: Object.fromEntries(
      WEBAPP_PERMISSION_DEFINITIONS.map((permission) => [
        permission.key,
        Boolean(permission.key === 'addDeathId'
          ? incomingPermissions.addDeathId ?? incomingPermissions.searchDeaths
          : incomingPermissions[permission.key]),
      ]),
    ),
  };
}

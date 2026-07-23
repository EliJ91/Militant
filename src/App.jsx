import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartBar, Eye, History, ScrollText, ShieldCheck, Users } from 'lucide-react';
import LootMonitor, { LootLogArchive } from './components/LootMonitor';
import MembersTool from './components/MembersTool';
import PlayerHistoryTool from './components/PlayerHistoryTool';
import PermissionsTool from './components/PermissionsTool';
import SiphonedEnergyTracker from './components/SiphonedEnergyTracker';
import ActionLogsTool from './components/ActionLogsTool';
import { setActionLogActorName, setActionLogAuthSession } from './services/actionLogsApi';
import {
  clearPendingAuthRoute,
  getCurrentAuthSession,
  getPendingAuthRoute,
  isDiscordAuthConfigured,
  onAuthStateChange,
  signInWithDiscord,
  signOutOfDiscord,
} from './services/authService';
import { fetchDiscordMemberRoles, fetchPermissionSettings } from './services/permissionsApi';
import {
  loadPermissionSettings,
  getDiscordUserId,
  normalizePermissionSettings,
  PERMISSIONS_CHANGED_EVENT,
  resolvePermissionsForDiscordUser,
  resolvePermissionsForRoleIds,
  SUPERUSER_DISCORD_USER_IDS,
  WEBAPP_PERMISSION_DEFINITIONS,
} from './services/permissionsService';
import packageJson from '../package.json';

const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;
const APP_VERSION = packageJson.version;

function getRoute() {
  const route = window.location.hash.replace(/^#\/?/, '').replace(/\/$/, '').toLowerCase();

  if (route === 'loot-logs') return 'loot-logs';
  if (route === 'loot-viewer') return 'loot-viewer';
  if (route === 'loot-monitor' || route.startsWith('loot-monitor/')) return 'loot-monitor';
  if (route === 'shared-log' || route.startsWith('shared-log/')) return 'shared-log';
  if (route === 'siphoned-energy') return 'siphoned-energy';
  if (route === 'members') return 'members';
  if (route === 'player-history' || route === 'player-loot-history') return 'player-loot-history';
  if (route === 'permissions') return 'permissions';
  if (route === 'action-logs') return 'action-logs';
  return route === 'dashboard' ? 'dashboard' : 'landing';
}

function getLootBundleId() {
  const match = window.location.hash.match(/^#\/?(?:loot-monitor|shared-log)\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function navigateTo(hash) {
  if (window.location.hash !== hash) {
    window.history.pushState(null, '', hash);
  }
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.dispatchEvent(new Event('militant-route-change'));
}

function BrandLockup({ compact = false }) {
  return (
    <div className={compact ? 'brand-lockup brand-lockup-compact' : 'brand-lockup'}>
      <img
        className="brand-wordmark"
        src={`${ASSET_BASE}militant-wordmark.png`}
        alt="Militant"
      />
    </div>
  );
}

function getDiscordAvatarUrl(user = {}) {
  const metadata = user.user_metadata || user.userMetadata || {};
  if (metadata.avatar_url || metadata.picture) {
    return metadata.avatar_url || metadata.picture;
  }
  if (user.avatarUrl || user.avatar_url || user.picture) {
    return user.avatarUrl || user.avatar_url || user.picture;
  }
  const discordUserId = getDiscordUserId(user);
  if (discordUserId && user.avatar) {
    const extension = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${discordUserId}/${user.avatar}.${extension}?size=80`;
  }
  return '';
}

function getDiscordDisplayName(user = {}) {
  const metadata = user.user_metadata || user.userMetadata || {};
  return user.guildNickname
    || user.serverNickname
    || user.nick
    || metadata.guildNickname
    || metadata.serverNickname
    || metadata.nick
    || user.globalName
    || user.global_name
    || metadata.global_name
    || metadata.full_name
    || metadata.name
    || metadata.user_name
    || user.full_name
    || user.name
    || user.username
    || 'Discord User';
}

function getUploadUsername(user = {}) {
  if (!user) return 'Unknown Server Member';
  const metadata = user.user_metadata || user.userMetadata || {};
  return String(
    user.guildNickname
      || user.serverNickname
      || user.nick
      || metadata.guildNickname
      || metadata.serverNickname
      || metadata.nick
      || 'Unknown Server Member',
  ).trim() || 'Unknown Server Member';
}

function emptyPermissions() {
  return Object.fromEntries(WEBAPP_PERMISSION_DEFINITIONS.map((permission) => [permission.key, false]));
}

function isSuperUser(user = null) {
  return SUPERUSER_DISCORD_USER_IDS.includes(getDiscordUserId(user || {}));
}

function UserProfileChip({
  isSuperUserProfile = false,
  onResetViewAsRole = () => {},
  onSignOut = () => {},
  onToggleViewAsRole = () => {},
  user = null,
  viewAsRoleIds = [],
  viewAsRoles = [],
}) {
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;

    function closeMenu(event) {
      if (!event.target.closest('.topbar-profile-context')) setMenu(null);
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') setMenu(null);
    }

    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('touchstart', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('touchstart', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menu]);

  if (!user) return null;

  const avatarUrl = getDiscordAvatarUrl(user);
  const displayName = getDiscordDisplayName(user);
  const fallbackInitial = displayName.trim().charAt(0).toUpperCase() || 'D';
  const selectedRoleIds = new Set(viewAsRoleIds.map((roleId) => String(roleId)));

  function openProfileMenu(event, showRoleOptions = false) {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    setMenu({
      showRoleOptions: Boolean(showRoleOptions && isSuperUserProfile),
      x: Math.max(8, Math.min(bounds.right - 220, window.innerWidth - 228)),
      y: Math.max(8, Math.min(bounds.bottom + 8, window.innerHeight - 280)),
    });
  }

  function signOut() {
    setMenu(null);
    onSignOut();
  }

  return (
    <div
      className="topbar-profile topbar-profile-context"
      ref={menuRef}
      title={isSuperUserProfile ? `${displayName} (SuperUser)` : displayName}
      aria-label={`Logged in as ${displayName}`}
      onContextMenu={(event) => openProfileMenu(event, true)}
    >
      <button
        aria-label={`Open profile menu for ${displayName}`}
        className="topbar-profile-button"
        type="button"
        onClick={(event) => (menu ? setMenu(null) : openProfileMenu(event, false))}
        onContextMenu={(event) => openProfileMenu(event, true)}
      >
        {avatarUrl ? (
          <img className="topbar-profile-avatar" src={avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="topbar-profile-fallback" aria-hidden="true">{fallbackInitial}</span>
        )}
      </button>
      {menu ? (
        <div
          className="topbar-profile-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.showRoleOptions ? (
            <>
              <span className="topbar-profile-menu-label">View As Roles</span>
              {viewAsRoles.length > 0 ? viewAsRoles.map((role) => {
                const isSelected = selectedRoleIds.has(String(role.id)) || selectedRoleIds.has(String(role.roleId));
                return (
                  <button
                    aria-pressed={isSelected}
                    className={isSelected ? 'is-selected' : ''}
                    key={role.id}
                    type="button"
                    onClick={() => onToggleViewAsRole(role)}
                  >
                    {role.name}
                  </button>
                );
              }) : <span className="topbar-profile-menu-empty">No roles configured</span>}
              {selectedRoleIds.size > 0 ? (
                <button className="topbar-profile-menu-reset" type="button" onClick={onResetViewAsRole}>
                  Reset View
                </button>
              ) : null}
            </>
          ) : null}
          <button className="topbar-profile-menu-signout" type="button" onClick={signOut}>
            Sign Out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Topbar({
  actions = [],
  currentUser = null,
  isSuperUserProfile = false,
  onResetViewAsRole = () => {},
  onSignOut = () => {},
  onToggleViewAsRole = () => {},
  viewAsRoleIds = [],
  viewAsRoles = [],
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const hasMenuContent = actions.length > 0 || Boolean(currentUser);

  useEffect(() => {
    if (!isMenuOpen) return undefined;

    function closeOnOutsideClick(event) {
      if (!event.target.closest('.topbar-menu-region')) {
        setIsMenuOpen(false);
      }
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') setIsMenuOpen(false);
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('touchstart', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('touchstart', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isMenuOpen]);

  return (
    <header className="topbar">
      <BrandLockup compact />
      {hasMenuContent ? (
        <div className="topbar-menu-region">
          {actions.length > 0 ? (
            <button
              aria-expanded={isMenuOpen}
              aria-label="Toggle navigation menu"
              className="topbar-menu-toggle"
              title="Menu"
              type="button"
              onClick={() => setIsMenuOpen((current) => !current)}
            >
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </button>
          ) : null}
          {actions.length > 0 ? (
            <div className={isMenuOpen ? 'topbar-actions is-open' : 'topbar-actions'}>
              <div className="topbar-links">
                {actions.map((action) => (
                  action.href ? (
                    <a
                      className="navigation-button"
                      href={action.href}
                      key={action.label}
                      title={action.title || action.label}
                      onClick={() => setIsMenuOpen(false)}
                    >
                      {action.label}
                    </a>
                  ) : (
                    <button
                      className="navigation-button"
                      key={action.label}
                      title={action.title || action.label}
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        action.onClick?.();
                      }}
                    >
                      {action.label}
                    </button>
                  )
                ))}
              </div>
            </div>
          ) : null}
          <UserProfileChip
            isSuperUserProfile={isSuperUserProfile}
            user={currentUser}
            onResetViewAsRole={onResetViewAsRole}
            onSignOut={onSignOut}
            onToggleViewAsRole={onToggleViewAsRole}
            viewAsRoleIds={viewAsRoleIds}
            viewAsRoles={viewAsRoles}
          />
        </div>
      ) : null}
    </header>
  );
}

function ViewAsRoleModal({ onClose = () => {}, onSelect = () => {}, roles = [] }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="view-as-role-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="view-as-role-modal" aria-labelledby="view-as-role-title" role="dialog" aria-modal="true">
        <div className="view-as-role-heading">
          <div>
            <p className="eyebrow">SuperUser</p>
            <h2 id="view-as-role-title">View As Role</h2>
          </div>
          <button aria-label="Close view as role" type="button" onClick={onClose}>Close</button>
        </div>
        {roles.length > 0 ? (
          <div className="view-as-role-list">
            {roles.map((role) => (
              <button key={role.id} type="button" onClick={() => onSelect(role)}>
                <strong>{role.name}</strong>
                <small>{role.roleId}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="view-as-role-empty">No roles configured.</p>
        )}
      </section>
    </div>
  );
}

function VersionFooter() {
  return (
    <footer className="app-version-footer" aria-label="Application version">
      v{APP_VERSION}
    </footer>
  );
}

function LandingPage({
  isAuthenticated = false,
  onDiscordLogin = () => {},
}) {
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  async function enterApp() {
    if (isAuthenticated) {
      navigateTo('#dashboard');
      return;
    }

    setLoginError('');
    setIsLoggingIn(true);
    try {
      await onDiscordLogin();
    } catch (error) {
      setLoginError(error.message || 'Could not start Discord login.');
    } finally {
      setIsLoggingIn(false);
    }
  }

  const buttonLabel = isLoggingIn
    ? 'Opening Discord...'
    : 'Login with Discord';

  return (
    <main
      className="landing-page"
      style={{ '--landing-bg': `url("${ASSET_BASE}militant-landing-bg.png")` }}
    >
      <div className="landing-strike landing-strike-one" aria-hidden="true" />
      <div className="landing-strike landing-strike-two" aria-hidden="true" />
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-mark">
          <BrandLockup />
        </div>
        <div className="landing-copy">
          <h1 className="visually-hidden" id="landing-title">Militant</h1>
          <p>Hold the line.</p>
        </div>
        <div className="landing-actions">
          <button className="primary-button" disabled={isLoggingIn} title={buttonLabel} type="button" onClick={enterApp}>
            {buttonLabel}
          </button>
          {loginError ? <p className="loot-message error">{loginError}</p> : null}
        </div>
      </section>
    </main>
  );
}

function DashboardPage({
  currentUser = null,
  isSuperUserProfile = false,
  onResetViewAsRole = () => {},
  onSignOut = () => {},
  onToggleViewAsRole = () => {},
  permissions = emptyPermissions(),
  viewAsRoleIds = [],
  viewAsRoles = [],
}) {
  const tools = [
    {
      description: 'Browse uploaded CTA loot and chest logs.',
      group: 'tools',
      icon: ScrollText,
      permission: 'viewLogs',
      title: 'View Loot Logs',
      to: '#loot-logs',
    },
    {
      description: 'Track deposits, withdrawals, and outstanding member balances.',
      group: 'tools',
      image: `${ASSET_BASE}siphoned-energy.png`,
      permission: 'viewSiphonedEnergy',
      title: 'Siphoned Energy Tracker',
      to: '#siphoned-energy',
    },
    {
      description: 'View current Militant guild members and fame totals.',
      group: 'tools',
      icon: Users,
      permission: 'viewMembers',
      title: 'Members',
      to: '#members',
    },
    {
      description: 'Search current members and review their historical CTA loot statistics.',
      group: 'tools',
      icon: ChartBar,
      permission: 'viewPlayerHistory',
      title: 'Player Loot History',
      to: '#player-loot-history',
    },
    {
      description: 'Open loot logs locally without saving or changing any data.',
      group: 'tools',
      icon: Eye,
      permission: 'viewLootLogViewer',
      title: 'Loot Log Viewer',
      to: '#loot-viewer',
    },
    {
      description: 'Map Discord roles to webapp access controls.',
      group: 'admin',
      icon: ShieldCheck,
      permission: 'changePermissions',
      title: 'Permissions',
      to: '#permissions',
    },
    {
      description: 'Review changes and additions made across the webapp.',
      group: 'admin',
      icon: History,
      permission: 'viewActionLog',
      title: 'Action Logs',
      to: '#action-logs',
    },
  ].filter((tool) => permissions[tool.permission]);
  const toolGroups = [
    { key: 'tools', label: 'Tools' },
    { key: 'admin', label: 'Administration' },
  ].map((group) => ({
    ...group,
    tools: tools.filter((tool) => tool.group === group.key),
  })).filter((group) => group.tools.length > 0);

  return (
    <>
      <Topbar
        actions={[]}
        currentUser={currentUser}
        isSuperUserProfile={isSuperUserProfile}
        onResetViewAsRole={onResetViewAsRole}
        onSignOut={onSignOut}
        onToggleViewAsRole={onToggleViewAsRole}
        viewAsRoleIds={viewAsRoleIds}
        viewAsRoles={viewAsRoles}
      />

      <main className="dashboard-shell">
        <section className="dashboard-heading" aria-labelledby="dashboard-title">
          <p className="eyebrow">Militant Command</p>
          <h1 id="dashboard-title">Dashboard</h1>
        </section>

        {toolGroups.length > 0 ? (
          <div className="dashboard-tool-groups">
            {toolGroups.map((group) => (
              <section className={`dashboard-tool-group ${group.key}`} aria-labelledby={`dashboard-${group.key}-title`} key={group.key}>
                <div className="dashboard-tool-group-heading">
                  <h2 id={`dashboard-${group.key}-title`}>{group.label}</h2>
                </div>
                <div className="tool-board">
                  {group.tools.map((tool) => {
                    const ToolIcon = tool.icon;
                    return (
                      <button className="tool-card tool-card-button" key={tool.title} title={tool.title} type="button" onClick={() => navigateTo(tool.to)}>
                        <span className={tool.image ? 'tool-card-icon image' : 'tool-card-icon'} aria-hidden="true">
                          {tool.image ? <img src={tool.image} alt="" /> : <ToolIcon size={28} strokeWidth={1.8} />}
                        </span>
                        <span className="tool-card-copy">
                          <h3>{tool.title}</h3>
                          <p>{tool.description}</p>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : <p className="dashboard-empty">No webapp permissions assigned.</p>}
      </main>
    </>
  );
}

function LootMonitorPage({
  bundleId,
  canAddDeathId = false,
  canViewHiddenPlayers = false,
  currentUser = null,
  isSuperUserProfile = false,
  onResetViewAsRole = () => {},
  onSignOut = () => {},
  onToggleViewAsRole = () => {},
  screenshotPermissions = {},
  viewAsRoleIds = [],
  viewAsRoles = [],
}) {
  return (
    <>
      <Topbar
        actions={[
          { href: '#loot-logs', label: 'Loot Logs' },
          { href: '#dashboard', label: 'Dashboard' },
        ]}
        currentUser={currentUser}
        isSuperUserProfile={isSuperUserProfile}
        onResetViewAsRole={onResetViewAsRole}
        onSignOut={onSignOut}
        onToggleViewAsRole={onToggleViewAsRole}
        viewAsRoleIds={viewAsRoleIds}
        viewAsRoles={viewAsRoles}
      />
      <LootMonitor
        bundleId={bundleId}
        canAddDeathId={canAddDeathId}
        canViewHiddenPlayers={canViewHiddenPlayers}
        onViewLogs={() => navigateTo('#loot-logs')}
        screenshotPermissions={screenshotPermissions}
        uploadUsername={getUploadUsername(currentUser)}
      />
    </>
  );
}

function SharedLootMonitorPage({
  bundleId,
  canAddDeathId = false,
  canViewHiddenPlayers = false,
  currentUser = null,
  screenshotPermissions = {},
}) {
  return (
    <LootMonitor
      bundleId={bundleId}
      canAddDeathId={canAddDeathId}
      canViewHiddenPlayers={canViewHiddenPlayers}
      screenshotPermissions={screenshotPermissions}
      showShare={false}
      uploadUsername={getUploadUsername(currentUser)}
    />
  );
}

function LocalLootViewerPage({
  currentUser = null,
  isAuthenticated = false,
  isSuperUserProfile = false,
  onResetViewAsRole = () => {},
  onSignOut = () => {},
  onToggleViewAsRole = () => {},
  viewAsRoleIds = [],
  viewAsRoles = [],
}) {
  return (
    <ToolPage
      currentUser={currentUser}
      isAuthenticated={isAuthenticated}
      isSuperUserProfile={isSuperUserProfile}
      onResetViewAsRole={onResetViewAsRole}
      onSignOut={onSignOut}
      onToggleViewAsRole={onToggleViewAsRole}
      viewAsRoleIds={viewAsRoleIds}
      viewAsRoles={viewAsRoles}
    >
      <LootMonitor localOnly showShare={false} />
    </ToolPage>
  );
}

function ToolPage({
  children,
  currentUser = null,
  isAuthenticated = true,
  isSuperUserProfile = false,
  onResetViewAsRole = () => {},
  onSignOut = () => {},
  onToggleViewAsRole = () => {},
  viewAsRoleIds = [],
  viewAsRoles = [],
}) {
  return (
    <>
      <Topbar
        actions={isAuthenticated ? [
          { href: '#dashboard', label: 'Dashboard' },
        ] : []}
        currentUser={isAuthenticated ? currentUser : null}
        isSuperUserProfile={isSuperUserProfile}
        onResetViewAsRole={onResetViewAsRole}
        onSignOut={onSignOut}
        onToggleViewAsRole={onToggleViewAsRole}
        viewAsRoleIds={viewAsRoleIds}
        viewAsRoles={viewAsRoles}
      />
      {children}
    </>
  );
}

function LootLogsPage({
  currentUser = null,
  isSuperUserProfile = false,
  onResetViewAsRole = () => {},
  onSignOut = () => {},
  onToggleViewAsRole = () => {},
  onViewBundle,
  permissions = emptyPermissions(),
  viewAsRoleIds = [],
  viewAsRoles = [],
}) {
  return (
    <ToolPage
      currentUser={currentUser}
      isSuperUserProfile={isSuperUserProfile}
      onResetViewAsRole={onResetViewAsRole}
      onSignOut={onSignOut}
      onToggleViewAsRole={onToggleViewAsRole}
      viewAsRoleIds={viewAsRoleIds}
      viewAsRoles={viewAsRoles}
    >
      <LootLogArchive
        canDeleteLogs={Boolean(permissions.deleteChestLootLogs)}
        canChangeLootLogTitle={Boolean(permissions.changeLootLogTitle)}
        canDownloadLogs={Boolean(permissions.viewLogs)}
        canEditLogs={Boolean(permissions.editLootLogs)}
        canMergeLogs={Boolean(permissions.mergeLootLogs)}
        canUploadChestLogs={Boolean(permissions.uploadChestLogs)}
        canUploadLootLogs={Boolean(permissions.uploadLootLogs)}
        onView={onViewBundle}
        uploadUsername={getUploadUsername(currentUser)}
      />
    </ToolPage>
  );
}

function SiphonedEnergyPage({
  canUpdate = false,
  currentUser = null,
  isAuthenticated = false,
  isSuperUserProfile = false,
  onResetViewAsRole = () => {},
  onSignOut = () => {},
  onToggleViewAsRole = () => {},
  viewAsRoleIds = [],
  viewAsRoles = [],
}) {
  return (
    <ToolPage
      currentUser={currentUser}
      isAuthenticated={isAuthenticated}
      isSuperUserProfile={isSuperUserProfile}
      onResetViewAsRole={onResetViewAsRole}
      onSignOut={onSignOut}
      onToggleViewAsRole={onToggleViewAsRole}
      viewAsRoleIds={viewAsRoleIds}
      viewAsRoles={viewAsRoles}
    >
      <SiphonedEnergyTracker canUpdate={canUpdate} />
    </ToolPage>
  );
}

function MembersPage({
  canUpdate = false,
  currentUser = null,
  isSuperUserProfile = false,
  onResetViewAsRole = () => {},
  onSignOut = () => {},
  onToggleViewAsRole = () => {},
  viewAsRoleIds = [],
  viewAsRoles = [],
}) {
  return (
    <ToolPage
      currentUser={currentUser}
      isSuperUserProfile={isSuperUserProfile}
      onResetViewAsRole={onResetViewAsRole}
      onSignOut={onSignOut}
      onToggleViewAsRole={onToggleViewAsRole}
      viewAsRoleIds={viewAsRoleIds}
      viewAsRoles={viewAsRoles}
    >
      <MembersTool canUpdate={canUpdate} />
    </ToolPage>
  );
}

function PlayerHistoryPage({
  currentUser = null,
  isSuperUserProfile = false,
  onResetViewAsRole = () => {},
  onSignOut = () => {},
  onToggleViewAsRole = () => {},
  viewAsRoleIds = [],
  viewAsRoles = [],
}) {
  return (
    <ToolPage
      currentUser={currentUser}
      isSuperUserProfile={isSuperUserProfile}
      onResetViewAsRole={onResetViewAsRole}
      onSignOut={onSignOut}
      onToggleViewAsRole={onToggleViewAsRole}
      viewAsRoleIds={viewAsRoleIds}
      viewAsRoles={viewAsRoles}
    >
      <PlayerHistoryTool />
    </ToolPage>
  );
}

function PermissionsPage({
  currentUser = null,
  isSuperUserProfile = false,
  onResetViewAsRole = () => {},
  onSignOut = () => {},
  onToggleViewAsRole = () => {},
  viewAsRoleIds = [],
  viewAsRoles = [],
}) {
  return (
    <ToolPage
      currentUser={currentUser}
      isSuperUserProfile={isSuperUserProfile}
      onResetViewAsRole={onResetViewAsRole}
      onSignOut={onSignOut}
      onToggleViewAsRole={onToggleViewAsRole}
      viewAsRoleIds={viewAsRoleIds}
      viewAsRoles={viewAsRoles}
    >
      <PermissionsTool currentUser={currentUser} />
    </ToolPage>
  );
}

function ActionLogsPage({
  currentUser = null,
  isSuperUserProfile = false,
  onResetViewAsRole = () => {},
  onSignOut = () => {},
  onToggleViewAsRole = () => {},
  viewAsRoleIds = [],
  viewAsRoles = [],
}) {
  return (
    <ToolPage
      currentUser={currentUser}
      isSuperUserProfile={isSuperUserProfile}
      onResetViewAsRole={onResetViewAsRole}
      onSignOut={onSignOut}
      onToggleViewAsRole={onToggleViewAsRole}
      viewAsRoleIds={viewAsRoleIds}
      viewAsRoles={viewAsRoles}
    >
      <ActionLogsTool canDelete={isSuperUserProfile} />
    </ToolPage>
  );
}

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [isDiscordAuthenticated, setIsDiscordAuthenticated] = useState(false);
  const [authSession, setAuthSession] = useState(null);
  const [permissionSettings, setPermissionSettings] = useState(loadPermissionSettings);
  const [selectedBundleId, setSelectedBundleId] = useState('');
  const [viewAsRoleIds, setViewAsRoleIds] = useState([]);
  const isAuthenticated = isDiscordAuthenticated;
  const currentUser = authSession?.user || null;
  const currentUserIsSuperUser = isSuperUser(currentUser);
  const activeViewAsRoles = useMemo(() => {
    if (!currentUserIsSuperUser || viewAsRoleIds.length === 0) return [];
    const selectedRoleIds = new Set(viewAsRoleIds.map((roleId) => String(roleId)));
    return permissionSettings.roles.filter((role) => (
      selectedRoleIds.has(String(role.id)) || selectedRoleIds.has(String(role.roleId))
    ));
  }, [currentUserIsSuperUser, permissionSettings.roles, viewAsRoleIds]);
  const effectivePermissions = useMemo(() => {
    if (!isAuthenticated && route !== 'siphoned-energy' && route !== 'shared-log') return emptyPermissions();
    if (activeViewAsRoles.length > 0) {
      return resolvePermissionsForRoleIds(permissionSettings, activeViewAsRoles.map((role) => role.roleId));
    }
    return resolvePermissionsForDiscordUser(permissionSettings, currentUser || {});
  }, [activeViewAsRoles, currentUser, isAuthenticated, permissionSettings, route]);
  const soldierPermissions = useMemo(() => {
    const soldierRole = permissionSettings.roles.find((role) => (
      String(role.name || '').trim().toLowerCase() === 'soldier'
    ));
    if (!soldierRole?.roleId) return emptyPermissions();
    return resolvePermissionsForRoleIds(permissionSettings, [soldierRole.roleId]);
  }, [permissionSettings]);
  const topbarContext = {
    isSuperUserProfile: currentUserIsSuperUser,
    onResetViewAsRole: () => setViewAsRoleIds([]),
    onToggleViewAsRole: (role) => {
      const roleId = String(role.roleId || role.id || '');
      if (!roleId) return;
      setViewAsRoleIds((currentRoleIds) => {
        const normalized = currentRoleIds.map((currentRoleId) => String(currentRoleId));
        if (normalized.includes(roleId)) {
          return normalized.filter((currentRoleId) => currentRoleId !== roleId);
        }
        return [...normalized, roleId];
      });
    },
    viewAsRoleIds,
    viewAsRoles: permissionSettings.roles,
  };

  useEffect(() => {
    setActionLogAuthSession(authSession);
    setActionLogActorName(currentUser ? getUploadUsername(currentUser) : 'System');
  }, [authSession, currentUser]);

  useEffect(() => {
    const updateRoute = () => {
      setRoute(getRoute());
      setSelectedBundleId(getLootBundleId());
    };

    window.addEventListener('hashchange', updateRoute);
    window.addEventListener('popstate', updateRoute);
    window.addEventListener('militant-route-change', updateRoute);
    return () => {
      window.removeEventListener('hashchange', updateRoute);
      window.removeEventListener('popstate', updateRoute);
      window.removeEventListener('militant-route-change', updateRoute);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    function applySession(session) {
      if (cancelled) return;
      setActionLogAuthSession(session);
      const discordAuthenticated = Boolean(session);
      setIsDiscordAuthenticated(discordAuthenticated);
      setAuthSession((currentSession) => {
        if (!session || !currentSession) return session || null;
        const currentUserId = getDiscordUserId(currentSession.user || {});
        const incomingUserId = getDiscordUserId(session.user || {});
        if (!currentUserId || currentUserId !== incomingUserId) return session;

        return {
          ...session,
          user: {
            ...(currentSession.user || {}),
            ...(session.user || {}),
            guildNickname: currentSession.user?.guildNickname || session.user?.guildNickname || '',
            roleIds: Array.isArray(currentSession.user?.roleIds)
              ? currentSession.user.roleIds
              : session.user?.roleIds || [],
          },
        };
      });
      if (!discordAuthenticated) return;

      const roleLookupToken = session?.access_token || session?.accessToken || session?.provider_token;
      if (roleLookupToken) {
        fetchDiscordMemberRoles(session)
          .then((result) => {
            if (cancelled) return;
            const fetchedGuildNickname = result.guildNickname || result.serverNickname || result.nick || '';
            if (fetchedGuildNickname) setActionLogActorName(fetchedGuildNickname);
            setAuthSession((currentSession) => {
              if (!currentSession) return currentSession;
              const currentLookupToken = currentSession.access_token
                || currentSession.provider_token
                || currentSession.accessToken;
              if (currentLookupToken !== roleLookupToken) return currentSession;
              return {
                ...currentSession,
                user: {
                  ...(currentSession.user || {}),
                  discordUserId: result.discordUserId || getDiscordUserId(currentSession.user || {}),
                  guildNickname: result.guildNickname || result.serverNickname || result.nick || '',
                  roleIds: Array.isArray(result.roleIds) ? result.roleIds : [],
                },
              };
            });
          })
          .catch(() => {});
      }

      const pendingRoute = getPendingAuthRoute();
      clearPendingAuthRoute();
      if (pendingRoute) {
        navigateTo(pendingRoute);
      } else if (getRoute() === 'landing') {
        navigateTo('#dashboard');
      }
    }

    getCurrentAuthSession()
      .then(applySession)
      .catch(() => {
        setIsDiscordAuthenticated(false);
        setAuthSession(null);
      });

    const unsubscribe = onAuthStateChange(applySession);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchPermissionSettings()
      .then((result) => {
        if (cancelled) return;
        setPermissionSettings(normalizePermissionSettings({
          ...(result.settings || {}),
          updatedAt: result.updatedAt,
        }));
      })
      .catch(() => {
        setPermissionSettings(loadPermissionSettings());
      });

    function applyPermissionChange(event) {
      setPermissionSettings(normalizePermissionSettings(event.detail || loadPermissionSettings()));
    }

    window.addEventListener(PERMISSIONS_CHANGED_EVENT, applyPermissionChange);
    return () => {
      cancelled = true;
      window.removeEventListener(PERMISSIONS_CHANGED_EVENT, applyPermissionChange);
    };
  }, []);

  useEffect(() => {
    if (!currentUserIsSuperUser) {
      setViewAsRoleIds([]);
    }
  }, [currentUserIsSuperUser]);

  useEffect(() => {
    if (viewAsRoleIds.length === 0) return;
    const configuredIds = new Set(permissionSettings.roles.flatMap((role) => [String(role.id), String(role.roleId)]));
    setViewAsRoleIds((currentRoleIds) => currentRoleIds.filter((roleId) => configuredIds.has(String(roleId))));
  }, [permissionSettings.roles, viewAsRoleIds.length]);

  useEffect(() => {
    document.title = route === 'loot-logs' ? 'Loot Logs'
      : route === 'loot-viewer' ? 'Loot Log Viewer'
      : route === 'loot-monitor' || route === 'shared-log' ? 'View Loot Log'
      : route === 'siphoned-energy' ? 'Siphoned Energy Tracker'
      : route === 'members' ? 'Members'
      : route === 'player-loot-history' ? 'Player Loot History'
      : route === 'permissions' ? 'Permissions'
      : route === 'action-logs' ? 'Action Logs'
      : route === 'dashboard' ? 'Militant Dashboard'
        : 'Militant';
  }, [route]);

  useEffect(() => {
    if (route === 'loot-monitor' || route === 'shared-log') {
      setSelectedBundleId(getLootBundleId());
    } else {
      setSelectedBundleId('');
    }
  }, [route]);

  async function handleDiscordLogin() {
    if (!isDiscordAuthConfigured()) {
      throw new Error('Discord login is not configured.');
    }
    await signInWithDiscord('#dashboard');
  }

  async function handleSignOut() {
    await signOutOfDiscord();
    setIsDiscordAuthenticated(false);
    setAuthSession(null);
    setViewAsRoleIds([]);
    navigateTo('#');
  }

  function viewLootLogBundle(bundleId) {
    setSelectedBundleId(bundleId);
    navigateTo(`#loot-monitor/${encodeURIComponent(bundleId)}`);
  }

  let page;
  if (route === 'shared-log') {
    page = (
      <SharedLootMonitorPage
        bundleId={selectedBundleId}
        canAddDeathId={Boolean(effectivePermissions.addDeathId)}
        canViewHiddenPlayers={Boolean(effectivePermissions.viewHiddenLootLogPlayers)}
        currentUser={currentUser}
        screenshotPermissions={soldierPermissions}
      />
    );
  } else if (route === 'siphoned-energy') {
    page = (
      <SiphonedEnergyPage
        canUpdate={Boolean(effectivePermissions.updateSiphonedEnergy)}
        currentUser={currentUser}
        isAuthenticated={isAuthenticated}
        onSignOut={handleSignOut}
        {...topbarContext}
      />
    );
  } else if (!isAuthenticated && route !== 'landing') {
    page = (
      <LandingPage
        isAuthenticated={isAuthenticated}
        onDiscordLogin={handleDiscordLogin}
      />
    );
  } else if (route === 'dashboard') {
    page = (
      <DashboardPage
        currentUser={currentUser}
        onSignOut={handleSignOut}
        permissions={effectivePermissions}
        {...topbarContext}
      />
    );
  } else if (route === 'members') {
    page = effectivePermissions.viewMembers ? (
      <MembersPage
        canUpdate={Boolean(effectivePermissions.updateMembersList)}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        {...topbarContext}
      />
    ) : (
      <DashboardPage currentUser={currentUser} onSignOut={handleSignOut} permissions={effectivePermissions} {...topbarContext} />
    );
  } else if (route === 'player-loot-history') {
    page = effectivePermissions.viewPlayerHistory ? (
      <PlayerHistoryPage currentUser={currentUser} onSignOut={handleSignOut} {...topbarContext} />
    ) : (
      <DashboardPage currentUser={currentUser} onSignOut={handleSignOut} permissions={effectivePermissions} {...topbarContext} />
    );
  } else if (route === 'loot-viewer') {
    page = effectivePermissions.viewLootLogViewer ? (
      <LocalLootViewerPage
        currentUser={currentUser}
        isAuthenticated={isAuthenticated}
        onSignOut={handleSignOut}
        {...topbarContext}
      />
    ) : (
      <DashboardPage currentUser={currentUser} onSignOut={handleSignOut} permissions={effectivePermissions} {...topbarContext} />
    );
  } else if (route === 'permissions') {
    page = effectivePermissions.changePermissions ? (
      <PermissionsPage currentUser={currentUser} onSignOut={handleSignOut} {...topbarContext} />
    ) : (
      <DashboardPage currentUser={currentUser} onSignOut={handleSignOut} permissions={effectivePermissions} {...topbarContext} />
    );
  } else if (route === 'action-logs') {
    page = effectivePermissions.viewActionLog ? (
      <ActionLogsPage currentUser={currentUser} onSignOut={handleSignOut} {...topbarContext} />
    ) : (
      <DashboardPage currentUser={currentUser} onSignOut={handleSignOut} permissions={effectivePermissions} {...topbarContext} />
    );
  } else if (route === 'loot-logs') {
    page = effectivePermissions.viewLogs ? (
      <LootLogsPage
        currentUser={currentUser}
        onSignOut={handleSignOut}
        onViewBundle={viewLootLogBundle}
        permissions={effectivePermissions}
        {...topbarContext}
      />
    ) : (
      <DashboardPage currentUser={currentUser} onSignOut={handleSignOut} permissions={effectivePermissions} {...topbarContext} />
    );
  } else if (route === 'loot-monitor') {
    page = effectivePermissions.viewLootLog ? (
      <LootMonitorPage
        bundleId={selectedBundleId}
        canAddDeathId={Boolean(effectivePermissions.addDeathId)}
        canViewHiddenPlayers={Boolean(effectivePermissions.viewHiddenLootLogPlayers)}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        screenshotPermissions={soldierPermissions}
        {...topbarContext}
      />
    ) : (
      <DashboardPage currentUser={currentUser} onSignOut={handleSignOut} permissions={effectivePermissions} {...topbarContext} />
    );
  } else {
    page = (
      <LandingPage
        isAuthenticated={isAuthenticated}
        onDiscordLogin={handleDiscordLogin}
      />
    );
  }

  return (
    <>
      {activeViewAsRoles.length > 0 ? (
        <button className="reset-view-button" type="button" onClick={() => setViewAsRoleIds([])}>
          Reset View
        </button>
      ) : null}
      {page}
      <VersionFooter />
    </>
  );
}

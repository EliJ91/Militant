import { useEffect, useMemo, useRef, useState } from 'react';
import LootMonitor, { LootLogArchive } from './components/LootMonitor';
import MembersTool from './components/MembersTool';
import PermissionsTool from './components/PermissionsTool';
import SiphonedEnergyTracker from './components/SiphonedEnergyTracker';
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
  if (route === 'loot-monitor' || route.startsWith('loot-monitor/')) return 'loot-monitor';
  if (route === 'shared-log' || route.startsWith('shared-log/')) return 'shared-log';
  if (route === 'siphoned-energy') return 'siphoned-energy';
  if (route === 'members') return 'members';
  if (route === 'permissions') return 'permissions';
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
  return user.globalName
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
  const metadata = user.user_metadata || user.userMetadata || {};
  return String(
    user.username
      || metadata.user_name
      || metadata.preferred_username
      || getDiscordDisplayName(user),
  ).trim() || 'manual-web-upload';
}

function emptyPermissions() {
  return Object.fromEntries(WEBAPP_PERMISSION_DEFINITIONS.map((permission) => [permission.key, false]));
}

function isSuperUser(user = null) {
  return SUPERUSER_DISCORD_USER_IDS.includes(getDiscordUserId(user || {}));
}

function UserProfileChip({ isSuperUserProfile = false, onOpenViewAsRole = () => {}, user = null }) {
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

  return (
    <div
      className="topbar-profile topbar-profile-context"
      ref={menuRef}
      title={isSuperUserProfile ? `${displayName} (SuperUser)` : displayName}
      aria-label={`Logged in as ${displayName}`}
      onContextMenu={(event) => {
        if (!isSuperUserProfile) return;
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <button
        className="topbar-profile-button"
        type="button"
        onContextMenu={(event) => {
          if (!isSuperUserProfile) return;
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
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
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              onOpenViewAsRole();
            }}
          >
            View as role
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
  onOpenViewAsRole = () => {},
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

  function runAction(action) {
    setIsMenuOpen(false);
    action.onClick();
  }

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
          <div className={isMenuOpen ? 'topbar-actions is-open' : 'topbar-actions'}>
            <div className="topbar-links">
              {actions.map((action) => (
                <button
                  className="navigation-button"
                  key={action.label}
                  title={action.title || action.label}
                  type="button"
                  onClick={() => runAction(action)}
                >
                  {action.label}
                </button>
              ))}
            </div>
            <UserProfileChip
              isSuperUserProfile={isSuperUserProfile}
              user={currentUser}
              onOpenViewAsRole={onOpenViewAsRole}
            />
          </div>
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
  onOpenViewAsRole = () => {},
  onSignOut = () => {},
  permissions = emptyPermissions(),
}) {
  const tools = [
    {
      description: 'Browse uploaded CTA loot and chest logs.',
      kicker: 'Tools',
      permission: 'viewLogs',
      title: 'View Loot Logs',
      to: '#loot-logs',
    },
    {
      description: 'Track deposits, withdrawals, and outstanding member balances.',
      kicker: 'Tools',
      permission: 'viewSiphonedEnergy',
      title: 'Siphoned Energy Tracker',
      to: '#siphoned-energy',
    },
    {
      description: 'View current Militant guild members and fame totals.',
      kicker: 'Tools',
      permission: 'viewMembers',
      title: 'Members',
      to: '#members',
    },
    {
      description: 'Map Discord roles to webapp access controls.',
      kicker: 'Admin',
      permission: 'changePermissions',
      title: 'Permissions',
      to: '#permissions',
    },
  ].filter((tool) => permissions[tool.permission]);

  return (
    <>
      <Topbar
        actions={[{ label: 'Exit', onClick: onSignOut }]}
        currentUser={currentUser}
        isSuperUserProfile={isSuperUserProfile}
        onOpenViewAsRole={onOpenViewAsRole}
      />

      <main className="dashboard-shell">
        <section className="dashboard-heading" aria-labelledby="dashboard-title">
          <p className="eyebrow">Militant Command</p>
          <h1 id="dashboard-title">Dashboard</h1>
        </section>

        <section className="tool-board" aria-label="Dashboard tools">
          {tools.map((tool) => (
            <button className="tool-card tool-card-button" key={tool.title} title={tool.title} type="button" onClick={() => navigateTo(tool.to)}>
              <span className="tool-card-kicker">{tool.kicker}</span>
              <h2>{tool.title}</h2>
              <p>{tool.description}</p>
            </button>
          ))}
          {tools.length === 0 ? <p className="dashboard-empty">No webapp permissions assigned.</p> : null}
        </section>
      </main>
    </>
  );
}

function LootMonitorPage({
  bundleId,
  canCheckDeaths = false,
  currentUser = null,
  isSuperUserProfile = false,
  onOpenViewAsRole = () => {},
  onSignOut = () => {},
}) {
  return (
    <>
      <Topbar
        actions={[
          { label: 'Loot Logs', onClick: () => navigateTo('#loot-logs') },
          { label: 'Dashboard', onClick: () => navigateTo('#dashboard') },
          { label: 'Sign Out', onClick: onSignOut },
        ]}
        currentUser={currentUser}
        isSuperUserProfile={isSuperUserProfile}
        onOpenViewAsRole={onOpenViewAsRole}
      />
      <LootMonitor
        bundleId={bundleId}
        canCheckDeaths={canCheckDeaths}
        onViewLogs={() => navigateTo('#loot-logs')}
      />
    </>
  );
}

function SharedLootMonitorPage({ bundleId, isAuthenticated = false }) {
  return <LootMonitor bundleId={bundleId} canCheckDeaths={isAuthenticated} showShare={false} />;
}

function LootLogsPage({
  currentUser = null,
  isSuperUserProfile = false,
  onOpenViewAsRole = () => {},
  onSignOut = () => {},
  onViewBundle,
  permissions = emptyPermissions(),
}) {
  return (
    <>
      <Topbar
        actions={[
          { label: 'Dashboard', onClick: () => navigateTo('#dashboard') },
          { label: 'Sign Out', onClick: onSignOut },
        ]}
        currentUser={currentUser}
        isSuperUserProfile={isSuperUserProfile}
        onOpenViewAsRole={onOpenViewAsRole}
      />
      <LootLogArchive
        canDeleteLogs={Boolean(permissions.editLootLogs)}
        canDownloadLogs={Boolean(permissions.viewLogs)}
        canEditLogs={Boolean(permissions.editLootLogs)}
        canUploadChestLogs={Boolean(permissions.uploadChestLogs)}
        canUploadLootLogs={Boolean(permissions.uploadLootLogs)}
        onView={onViewBundle}
        uploadUsername={getUploadUsername(currentUser)}
      />
    </>
  );
}

function SiphonedEnergyPage({
  canUpdate = false,
  currentUser = null,
  isAuthenticated = false,
  isSuperUserProfile = false,
  onOpenViewAsRole = () => {},
  onSignOut = () => {},
}) {
  return (
    <>
      <Topbar
        actions={isAuthenticated ? [
          { label: 'Dashboard', onClick: () => navigateTo('#dashboard') },
          { label: 'Sign Out', onClick: onSignOut },
        ] : []}
        currentUser={isAuthenticated ? currentUser : null}
        isSuperUserProfile={isSuperUserProfile}
        onOpenViewAsRole={onOpenViewAsRole}
      />
      <SiphonedEnergyTracker canUpdate={canUpdate} />
    </>
  );
}

function MembersPage({
  canUpdate = false,
  currentUser = null,
  isSuperUserProfile = false,
  onOpenViewAsRole = () => {},
  onSignOut = () => {},
}) {
  return (
    <>
      <Topbar
        actions={[
          { label: 'Dashboard', onClick: () => navigateTo('#dashboard') },
          { label: 'Sign Out', onClick: onSignOut },
        ]}
        currentUser={currentUser}
        isSuperUserProfile={isSuperUserProfile}
        onOpenViewAsRole={onOpenViewAsRole}
      />
      <MembersTool canUpdate={canUpdate} />
    </>
  );
}

function PermissionsPage({
  currentUser = null,
  isSuperUserProfile = false,
  onOpenViewAsRole = () => {},
  onSignOut = () => {},
}) {
  return (
    <>
      <Topbar
        actions={[
          { label: 'Dashboard', onClick: () => navigateTo('#dashboard') },
          { label: 'Sign Out', onClick: onSignOut },
        ]}
        currentUser={currentUser}
        isSuperUserProfile={isSuperUserProfile}
        onOpenViewAsRole={onOpenViewAsRole}
      />
      <PermissionsTool currentUser={currentUser} />
    </>
  );
}

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [isDiscordAuthenticated, setIsDiscordAuthenticated] = useState(false);
  const [authSession, setAuthSession] = useState(null);
  const [permissionSettings, setPermissionSettings] = useState(loadPermissionSettings);
  const [selectedBundleId, setSelectedBundleId] = useState('');
  const [viewAsRoleId, setViewAsRoleId] = useState('');
  const [viewAsRoleModalOpen, setViewAsRoleModalOpen] = useState(false);
  const isAuthenticated = isDiscordAuthenticated;
  const currentUser = authSession?.user || null;
  const currentUserIsSuperUser = isSuperUser(currentUser);
  const viewAsRole = useMemo(() => (
    currentUserIsSuperUser && viewAsRoleId
      ? permissionSettings.roles.find((role) => role.id === viewAsRoleId || role.roleId === viewAsRoleId) || null
      : null
  ), [currentUserIsSuperUser, permissionSettings.roles, viewAsRoleId]);
  const effectivePermissions = useMemo(() => {
    if (!isAuthenticated && route !== 'siphoned-energy' && route !== 'shared-log') return emptyPermissions();
    if (viewAsRole) return resolvePermissionsForRoleIds(permissionSettings, [viewAsRole.roleId]);
    return resolvePermissionsForDiscordUser(permissionSettings, currentUser || {});
  }, [currentUser, isAuthenticated, permissionSettings, route, viewAsRole]);
  const topbarContext = {
    isSuperUserProfile: currentUserIsSuperUser,
    onOpenViewAsRole: () => setViewAsRoleModalOpen(true),
  };

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
      const discordAuthenticated = Boolean(session);
      setIsDiscordAuthenticated(discordAuthenticated);
      setAuthSession(session || null);
      if (!discordAuthenticated) return;

      const roleLookupToken = session?.access_token || session?.provider_token || session?.accessToken;
      if (roleLookupToken) {
        fetchDiscordMemberRoles(roleLookupToken)
          .then((result) => {
            if (cancelled) return;
            setAuthSession((currentSession) => {
              const currentLookupToken = currentSession.access_token
                || currentSession.provider_token
                || currentSession.accessToken;
              if (!currentSession || currentLookupToken !== roleLookupToken) return currentSession;
              return {
                ...currentSession,
                user: {
                  ...(currentSession.user || {}),
                  discordUserId: result.discordUserId || getDiscordUserId(currentSession.user || {}),
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
      setViewAsRoleId('');
      setViewAsRoleModalOpen(false);
    }
  }, [currentUserIsSuperUser]);

  useEffect(() => {
    if (viewAsRoleId && !viewAsRole) setViewAsRoleId('');
  }, [viewAsRole, viewAsRoleId]);

  useEffect(() => {
    document.title = route === 'loot-logs' ? 'Loot Logs'
      : route === 'loot-monitor' || route === 'shared-log' ? 'View Loot Log'
      : route === 'siphoned-energy' ? 'Siphoned Energy Tracker'
      : route === 'members' ? 'Members'
      : route === 'permissions' ? 'Permissions'
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
    setViewAsRoleId('');
    navigateTo('#');
  }

  function viewLootLogBundle(bundleId) {
    setSelectedBundleId(bundleId);
    navigateTo(`#loot-monitor/${encodeURIComponent(bundleId)}`);
  }

  let page;
  if (route === 'shared-log') {
    page = <SharedLootMonitorPage bundleId={selectedBundleId} isAuthenticated={isAuthenticated} />;
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
  } else if (route === 'permissions') {
    page = effectivePermissions.changePermissions ? (
      <PermissionsPage currentUser={currentUser} onSignOut={handleSignOut} {...topbarContext} />
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
        canCheckDeaths={Boolean(effectivePermissions.searchDeaths)}
        currentUser={currentUser}
        onSignOut={handleSignOut}
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
      {viewAsRole ? (
        <button className="reset-view-button" type="button" onClick={() => setViewAsRoleId('')}>
          Reset View
        </button>
      ) : null}
      {viewAsRoleModalOpen ? (
        <ViewAsRoleModal
          roles={permissionSettings.roles}
          onClose={() => setViewAsRoleModalOpen(false)}
          onSelect={(role) => {
            setViewAsRoleId(role.id);
            setViewAsRoleModalOpen(false);
            navigateTo('#dashboard');
          }}
        />
      ) : null}
      {page}
      <VersionFooter />
    </>
  );
}

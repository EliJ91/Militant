import { useEffect, useState } from 'react';
import LootMonitor, { LootLogArchive } from './components/LootMonitor';
import MembersTool from './components/MembersTool';
import SiphonedEnergyTracker from './components/SiphonedEnergyTracker';
import packageJson from '../package.json';

const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;
const AUTH_STORAGE_KEY = 'militant.authenticated';
const APP_PASSWORD = 'militant#1';
const APP_VERSION = packageJson.version;

function getRoute() {
  const route = window.location.hash.replace(/^#\/?/, '').replace(/\/$/, '').toLowerCase();

  if (route === 'loot-logs') return 'loot-logs';
  if (route === 'loot-monitor' || route.startsWith('loot-monitor/')) return 'loot-monitor';
  if (route === 'shared-log' || route.startsWith('shared-log/')) return 'shared-log';
  if (route === 'siphoned-energy') return 'siphoned-energy';
  if (route === 'members') return 'members';
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

function VersionFooter() {
  return (
    <footer className="app-version-footer" aria-label="Application version">
      v{APP_VERSION}
    </footer>
  );
}

function LandingPage({ isAuthenticated = false, onLogin = () => {} }) {
  const [loginError, setLoginError] = useState('');

  function enterApp() {
    if (isAuthenticated) {
      navigateTo('#dashboard');
      return;
    }

    const password = window.prompt('Enter password');
    if (password === APP_PASSWORD) {
      setLoginError('');
      onLogin();
      navigateTo('#dashboard');
      return;
    }

    if (password !== null) setLoginError('Incorrect password.');
  }

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
          <button className="primary-button" title="Enter dashboard" type="button" onClick={enterApp}>
            Enter
          </button>
          {loginError ? <p className="loot-message error">{loginError}</p> : null}
        </div>
      </section>
    </main>
  );
}

function DashboardPage({ onSignOut = () => {} }) {
  return (
    <>
      <header className="topbar">
        <BrandLockup compact />
        <div className="topbar-actions">
          <button className="navigation-button" title="Exit" type="button" onClick={onSignOut}>
            Exit
          </button>
        </div>
      </header>

      <main className="dashboard-shell">
        <section className="dashboard-heading" aria-labelledby="dashboard-title">
          <p className="eyebrow">Militant Command</p>
          <h1 id="dashboard-title">Dashboard</h1>
        </section>

        <section className="tool-board" aria-label="Dashboard tools">
          <button className="tool-card tool-card-button" title="View loot logs" type="button" onClick={() => navigateTo('#loot-logs')}>
            <span className="tool-card-kicker">Tools</span>
            <h2>View Loot Logs</h2>
            <p>Browse uploaded CTA loot and chest logs.</p>
          </button>
          <button className="tool-card tool-card-button" title="Open tracker" type="button" onClick={() => navigateTo('#siphoned-energy')}>
            <span className="tool-card-kicker">Tools</span>
            <h2>Siphoned Energy Tracker</h2>
            <p>Track deposits, withdrawals, and outstanding member balances.</p>
          </button>
          <button className="tool-card tool-card-button" title="View members" type="button" onClick={() => navigateTo('#members')}>
            <span className="tool-card-kicker">Tools</span>
            <h2>Members</h2>
            <p>View current Militant guild members and fame totals.</p>
          </button>
        </section>
      </main>
    </>
  );
}

function LootMonitorPage({ bundleId, isAuthenticated = false, onSignOut = () => {} }) {
  return (
    <>
      <header className="topbar">
        <BrandLockup compact />
        <div className="topbar-actions">
          <button className="navigation-button" title="Loot logs" type="button" onClick={() => navigateTo('#loot-logs')}>
            Loot Logs
          </button>
          <button className="navigation-button" title="Dashboard" type="button" onClick={() => navigateTo('#dashboard')}>
            Dashboard
          </button>
          <button className="navigation-button" title="Sign out" type="button" onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      </header>
      <LootMonitor
        bundleId={bundleId}
        canCheckDeaths={isAuthenticated}
        onViewLogs={() => navigateTo('#loot-logs')}
      />
    </>
  );
}

function SharedLootMonitorPage({ bundleId, isAuthenticated = false }) {
  return <LootMonitor bundleId={bundleId} canCheckDeaths={isAuthenticated} showShare={false} />;
}

function LootLogsPage({ onSignOut = () => {}, onViewBundle }) {
  return (
    <>
      <header className="topbar">
        <BrandLockup compact />
        <div className="topbar-actions">
          <button className="navigation-button" title="Dashboard" type="button" onClick={() => navigateTo('#dashboard')}>
            Dashboard
          </button>
          <button className="navigation-button" title="Sign out" type="button" onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      </header>
      <LootLogArchive onView={onViewBundle} />
    </>
  );
}

function SiphonedEnergyPage({ isAuthenticated = false, onSignOut = () => {} }) {
  return (
    <>
      <header className="topbar">
        <BrandLockup compact />
        {isAuthenticated ? (
          <div className="topbar-actions">
            <button className="navigation-button" title="Dashboard" type="button" onClick={() => navigateTo('#dashboard')}>
              Dashboard
            </button>
            <button className="navigation-button" title="Sign out" type="button" onClick={onSignOut}>
              Sign Out
            </button>
          </div>
        ) : null}
      </header>
      <SiphonedEnergyTracker canUpdate={isAuthenticated} />
    </>
  );
}

function MembersPage({ onSignOut = () => {} }) {
  return (
    <>
      <header className="topbar">
        <BrandLockup compact />
        <div className="topbar-actions">
          <button className="navigation-button" title="Dashboard" type="button" onClick={() => navigateTo('#dashboard')}>
            Dashboard
          </button>
          <button className="navigation-button" title="Sign out" type="button" onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      </header>
      <MembersTool />
    </>
  );
}

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [isAuthenticated, setIsAuthenticated] = useState(() => (
    window.localStorage.getItem(AUTH_STORAGE_KEY) === 'true'
  ));
  const [selectedBundleId, setSelectedBundleId] = useState('');

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
    document.title = route === 'loot-logs' ? 'Loot Logs'
      : route === 'loot-monitor' || route === 'shared-log' ? 'View Loot Log'
      : route === 'siphoned-energy' ? 'Siphoned Energy Tracker'
      : route === 'members' ? 'Members'
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

  function handleLogin() {
    window.localStorage.setItem(AUTH_STORAGE_KEY, 'true');
    setIsAuthenticated(true);
  }

  function handleSignOut() {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    setIsAuthenticated(false);
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
    page = <SiphonedEnergyPage isAuthenticated={isAuthenticated} onSignOut={handleSignOut} />;
  } else if (!isAuthenticated && route !== 'landing') {
    page = <LandingPage isAuthenticated={isAuthenticated} onLogin={handleLogin} />;
  } else if (route === 'dashboard') {
    page = <DashboardPage onSignOut={handleSignOut} />;
  } else if (route === 'members') {
    page = <MembersPage onSignOut={handleSignOut} />;
  } else if (route === 'loot-logs') {
    page = (
      <LootLogsPage
        onSignOut={handleSignOut}
        onViewBundle={viewLootLogBundle}
      />
    );
  } else if (route === 'loot-monitor') {
    page = <LootMonitorPage bundleId={selectedBundleId} isAuthenticated={isAuthenticated} onSignOut={handleSignOut} />;
  } else {
    page = <LandingPage isAuthenticated={isAuthenticated} onLogin={handleLogin} />;
  }

  return (
    <>
      {page}
      <VersionFooter />
    </>
  );
}

import { useEffect, useState } from 'react';
import LootMonitor, { LootLogArchive } from './components/LootMonitor';
import SiphonedEnergyTracker from './components/SiphonedEnergyTracker';

const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

function getRoute() {
  const route = window.location.hash.replace(/^#\/?/, '').replace(/\/$/, '').toLowerCase();

  if (route === 'loot-logs') return 'loot-logs';
  if (route === 'loot-monitor') return 'loot-monitor';
  if (route === 'siphoned-energy') return 'siphoned-energy';
  return route === 'dashboard' ? 'dashboard' : 'landing';
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

function LandingPage() {
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
          <button className="primary-button" type="button" onClick={() => navigateTo('#dashboard')}>
            Enter
          </button>
        </div>
      </section>
    </main>
  );
}

function DashboardPage() {
  return (
    <>
      <header className="topbar">
        <BrandLockup compact />
        <div className="topbar-actions">
          <button className="navigation-button" type="button" onClick={() => navigateTo('#')}>
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
          <button className="tool-card tool-card-button" type="button" onClick={() => navigateTo('#loot-logs')}>
            <span className="tool-card-kicker">Tools</span>
            <h2>View Loot Logs</h2>
            <p>Browse uploaded CTA loot and chest logs.</p>
          </button>
          <button className="tool-card tool-card-button" type="button" onClick={() => navigateTo('#siphoned-energy')}>
            <span className="tool-card-kicker">Tools</span>
            <h2>Siphoned Energy Tracker</h2>
            <p>Track deposits, withdrawals, and outstanding member balances.</p>
          </button>
        </section>
      </main>
    </>
  );
}

function LootMonitorPage({ bundleId }) {
  return (
    <>
      <header className="topbar">
        <BrandLockup compact />
        <div className="topbar-actions">
          <button className="navigation-button" type="button" onClick={() => navigateTo('#dashboard')}>
            Dashboard
          </button>
          <button className="navigation-button" type="button" onClick={() => navigateTo('#')}>
            Sign Out
          </button>
        </div>
      </header>
      <LootMonitor bundleId={bundleId} onViewLogs={() => navigateTo('#loot-logs')} />
    </>
  );
}

function LootLogsPage({ onViewBundle }) {
  return (
    <>
      <header className="topbar">
        <BrandLockup compact />
        <div className="topbar-actions">
          <button className="navigation-button" type="button" onClick={() => navigateTo('#dashboard')}>
            Dashboard
          </button>
          <button className="navigation-button" type="button" onClick={() => navigateTo('#')}>
            Sign Out
          </button>
        </div>
      </header>
      <LootLogArchive onView={onViewBundle} />
    </>
  );
}

function SiphonedEnergyPage() {
  return (
    <>
      <header className="topbar">
        <BrandLockup compact />
        <div className="topbar-actions">
          <button className="navigation-button" type="button" onClick={() => navigateTo('#dashboard')}>
            Dashboard
          </button>
          <button className="navigation-button" type="button" onClick={() => navigateTo('#')}>
            Sign Out
          </button>
        </div>
      </header>
      <SiphonedEnergyTracker />
    </>
  );
}

export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [selectedBundleId, setSelectedBundleId] = useState('');

  useEffect(() => {
    const updateRoute = () => {
      setRoute(getRoute());
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
    document.title = route === 'loot-logs' ? 'View Loot Logs'
      : route === 'loot-monitor' ? 'Loot Log Details'
      : route === 'siphoned-energy' ? 'Siphoned Energy Tracker'
      : route === 'dashboard' ? 'Militant Dashboard'
        : 'Militant';
  }, [route]);

  useEffect(() => {
    if (route !== 'loot-monitor') setSelectedBundleId('');
  }, [route]);

  function viewLootLogBundle(bundleId) {
    setSelectedBundleId(bundleId);
    navigateTo('#loot-monitor');
  }

  if (route === 'dashboard') return <DashboardPage />;
  if (route === 'loot-logs') {
    return (
      <LootLogsPage
        onViewBundle={viewLootLogBundle}
      />
    );
  }
  if (route === 'loot-monitor') return <LootMonitorPage bundleId={selectedBundleId} />;
  if (route === 'siphoned-energy') return <SiphonedEnergyPage />;
  return <LandingPage />;
}

import { useEffect, useState } from 'react';
import LootMonitor from './components/LootMonitor';

const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

function getRoute() {
  if (window.location.hash === '#loot-monitor') return 'loot-monitor';
  return window.location.hash === '#dashboard' ? 'dashboard' : 'landing';
}

function navigateTo(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
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
          <button className="tool-card tool-card-button" type="button" onClick={() => navigateTo('#loot-monitor')}>
            <span className="tool-card-kicker">Tools</span>
            <h2>Loot Monitor</h2>
            <p>Review kept, lost, resolved, and donated loot from CTA logs.</p>
          </button>
          <button className="tool-card tool-card-button tool-card-muted" type="button">
            <span className="tool-card-kicker">Under Construction</span>
            <h2>Pending</h2>
            <p>Make a suggestion!</p>
          </button>
        </section>
      </main>
    </>
  );
}

function LootMonitorPage() {
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
      <LootMonitor />
    </>
  );
}

export default function App() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const updateRoute = () => {
      setRoute(getRoute());
    };

    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  useEffect(() => {
    document.title = route === 'loot-monitor' ? 'Loot Monitor'
      : route === 'dashboard' ? 'Militant Dashboard'
        : 'Militant';
  }, [route]);

  if (route === 'dashboard') return <DashboardPage />;
  if (route === 'loot-monitor') return <LootMonitorPage />;
  return <LandingPage />;
}

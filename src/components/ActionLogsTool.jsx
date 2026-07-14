import { useEffect, useMemo, useState } from 'react';
import { fetchActionLogs } from '../services/actionLogsApi';

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: 'short',
    second: '2-digit',
    timeZoneName: 'short',
    year: 'numeric',
  }).format(date);
}

function detailSummary(details = {}) {
  const parts = [];
  if (details.fileName) parts.push(`File: ${details.fileName}`);
  if (details.uploadedBy) parts.push(`Log by: ${details.uploadedBy}`);
  if (details.lootLogName) parts.push(`Log: ${details.lootLogName}`);
  if (Array.isArray(details.players) && details.players.length > 0) {
    parts.push(`Players: ${details.players.slice(0, 8).join(', ')}${details.players.length > 8 ? ` +${details.players.length - 8}` : ''}`);
  } else if (details.player) {
    parts.push(`Player: ${details.player}`);
  }
  if (Array.isArray(details.changes) && details.changes.length > 0) {
    parts.push(...details.changes.slice(0, 5));
    if (details.changes.length > 5) parts.push(`+${details.changes.length - 5} more changes`);
  }
  if (Number.isFinite(Number(details.count))) parts.push(`${Number(details.count).toLocaleString()} affected`);
  if (Number.isFinite(Number(details.insertedRows))) parts.push(`${Number(details.insertedRows).toLocaleString()} added`);
  if (details.status) parts.push(String(details.status).replaceAll('_', ' '));
  if (details.source) parts.push(String(details.source));
  return parts.join(' / ');
}

function actionClass(action) {
  const text = String(action || '').toLowerCase();
  if (text.includes('delete') || text.includes('removed')) return 'danger';
  if (text.includes('death')) return 'warn';
  if (text.includes('permission')) return 'info';
  return 'success';
}

function detailChips(details = {}) {
  const chips = [];
  if (details.fileName) chips.push({ label: 'File', value: details.fileName });
  if (details.uploadedBy) chips.push({ label: 'Log By', value: details.uploadedBy });
  if (details.lootLogName) chips.push({ label: 'Loot Log', value: details.lootLogName });
  if (Array.isArray(details.players) && details.players.length > 0) {
    chips.push({ label: 'Players', value: details.players.join(', ') });
  }
  if (details.status) chips.push({ label: 'Status', value: String(details.status).replaceAll('_', ' ') });
  if (details.source) chips.push({ label: 'Source', value: details.source });
  if (Number.isFinite(Number(details.insertedRows))) chips.push({ label: 'Added', value: Number(details.insertedRows).toLocaleString() });
  if (Number.isFinite(Number(details.count)) && !Array.isArray(details.changes)) {
    chips.push({ label: 'Affected', value: Number(details.count).toLocaleString() });
  }
  return chips;
}

export default function ActionLogsTool() {
  const [logs, setLogs] = useState([]);
  const [nextCursor, setNextCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState({ message: '', state: 'loading' });

  async function loadLogs({ append = false, before = '' } = {}) {
    setStatus({ message: '', state: append ? 'loading-more' : 'loading' });
    try {
      const result = await fetchActionLogs({ before, limit: 100 });
      setLogs((current) => (append ? [...current, ...(result.actionLogs || [])] : result.actionLogs || []));
      setNextCursor(result.nextCursor || '');
      setHasMore(Boolean(result.hasMore));
      setTotal(Number(result.total) || 0);
      setStatus({ message: '', state: 'ready' });
    } catch (error) {
      setStatus({ message: error.message || 'Could not load action logs.', state: 'error' });
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  const visibleCount = useMemo(() => logs.length.toLocaleString(), [logs.length]);

  return (
    <main className="dashboard-shell action-logs-shell">
      <section className="dashboard-heading action-logs-heading" aria-labelledby="action-logs-title">
        <div>
          <p className="eyebrow">Tool</p>
          <h1 id="action-logs-title">Action Logs</h1>
        </div>
        <div className="action-logs-count" aria-label={`${total} actions recorded`}>
          <span>Actions</span>
          <strong>{total.toLocaleString()}</strong>
        </div>
      </section>

      <section className="action-logs-board" aria-labelledby="action-history-title">
        <div className="action-logs-board-heading">
          <div>
            <p className="eyebrow">History</p>
            <h2 id="action-history-title">Changes and Additions</h2>
          </div>
          <strong>{visibleCount} shown</strong>
        </div>

        {status.state === 'loading' ? <p className="action-logs-empty">Loading actions...</p> : null}
        {status.state === 'error' ? <p className="loot-message error">{status.message}</p> : null}
        {status.state === 'ready' && logs.length === 0 ? <p className="action-logs-empty">No actions recorded yet.</p> : null}

        {logs.length > 0 ? (
          <div className="action-log-list">
            {logs.map((log) => (
              <article className="action-log-card" key={log.id}>
                <div className="action-log-meta">
                  <time dateTime={log.createdAt}>{formatDateTime(log.createdAt)}</time>
                  <strong>{log.actorName || 'System'}</strong>
                </div>
                <div className="action-log-main">
                  <div className="action-log-title-row">
                    <span className={`action-log-pill ${actionClass(log.action)}`}>{log.action}</span>
                    <strong>{log.targetName || log.targetType || 'Webapp'}</strong>
                  </div>
                  <p>{detailSummary(log.details) || 'No extra details recorded.'}</p>
                  {Array.isArray(log.details?.changes) && log.details.changes.length > 0 ? (
                    <ul className="action-log-change-list">
                      {log.details.changes.slice(0, 10).map((change, index) => <li key={`${change}-${index}`}>{change}</li>)}
                      {log.details.changes.length > 10 ? <li>{log.details.changes.length - 10} more changes</li> : null}
                    </ul>
                  ) : null}
                  {detailChips(log.details).length > 0 ? (
                    <div className="action-log-chips">
                      {detailChips(log.details).map((chip) => (
                        <span key={`${chip.label}-${chip.value}`}>
                          <small>{chip.label}</small>
                          {chip.value}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {hasMore ? (
          <button
            className="view-logs-button action-logs-more"
            disabled={status.state === 'loading-more'}
            type="button"
            onClick={() => loadLogs({ append: true, before: nextCursor })}
          >
            {status.state === 'loading-more' ? 'Loading' : 'Load More'}
          </button>
        ) : null}
      </section>
    </main>
  );
}

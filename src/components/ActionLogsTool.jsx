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
  if (details.fileName) parts.push(details.fileName);
  if (Number.isFinite(Number(details.count))) parts.push(`${Number(details.count).toLocaleString()} affected`);
  if (Number.isFinite(Number(details.insertedRows))) parts.push(`${Number(details.insertedRows).toLocaleString()} added`);
  if (details.player) parts.push(details.player);
  if (details.status) parts.push(String(details.status).replaceAll('_', ' '));
  if (details.source) parts.push(String(details.source));
  return parts.join(' / ');
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
          <div className="action-logs-table-wrap">
            <table className="action-logs-table">
              <thead>
                <tr>
                  <th scope="col">Date and Time</th>
                  <th scope="col">User</th>
                  <th scope="col">Action</th>
                  <th scope="col">File or Item</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td><time dateTime={log.createdAt}>{formatDateTime(log.createdAt)}</time></td>
                    <td className="action-logs-actor">{log.actorName || 'System'}</td>
                    <td><span className="action-logs-action">{log.action}</span></td>
                    <td>{log.targetName || '-'}</td>
                    <td>{detailSummary(log.details) || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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


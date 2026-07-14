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

function cleanText(value, fallback = '') {
  return String(value || '').trim() || fallback;
}

function permissionChangeText(change) {
  const text = cleanText(change);
  let match = text.match(/^Enabled (.+) for (.+)$/i);
  if (match) return `Added ${match[1]} permission to ${match[2]} Role`;

  match = text.match(/^Disabled (.+) for (.+)$/i);
  if (match) return `Removed ${match[1]} permission from ${match[2]} Role`;

  match = text.match(/^Added role (.+)$/i);
  if (match) return `Added ${match[1]} Role`;

  match = text.match(/^Deleted role (.+)$/i);
  if (match) return `Deleted ${match[1]} Role`;

  match = text.match(/^Renamed (.+) to (.+)$/i);
  if (match) return `Renamed ${match[1]} Role to ${match[2]}`;

  match = text.match(/^Moved (.+) to column (.+)$/i);
  if (match) return `Moved ${match[1]} Role to column ${match[2]}`;

  return text;
}

function deathCheckRows(log) {
  const details = log.details || {};
  const players = Array.isArray(details.players) && details.players.length > 0
    ? details.players
    : [details.player].filter(Boolean);
  const lootLogName = cleanText(details.lootLogName || log.targetName || log.targetId, 'selected loot log');

  if (players.length === 0) {
    return [{
      ...log,
      actionText: `Checked death for loot log: ${lootLogName}`,
      rowId: `${log.id || log.createdAt}-death`,
    }];
  }

  return players.map((player, index) => ({
    ...log,
    actionText: `Checked ${player} death for loot log: ${lootLogName}`,
    rowId: `${log.id || log.createdAt}-death-${index}`,
  }));
}

function formatAction(log) {
  const action = cleanText(log.action);
  const details = log.details || {};

  if (action === 'Loot log uploaded from Discord') {
    const uploadedBy = cleanText(details.uploadedBy);
    return uploadedBy ? `Uploaded ${uploadedBy} log from Discord` : 'Uploaded loot log from Discord';
  }

  if (action === 'Loot log uploaded') {
    return `Uploaded loot log ${cleanText(log.targetName || details.fileName, 'Untitled')}`;
  }

  if (action === 'Chest log uploaded') {
    return `Uploaded chest log for loot log ${cleanText(details.lootLogName || log.targetName, 'Untitled')}`;
  }

  if (action === 'Loot logs merged') {
    return `Merged loot logs into ${cleanText(log.targetName, 'new loot log')}`;
  }

  if (action === 'Loot log updated') {
    return `Updated loot log ${cleanText(log.targetName, 'Untitled')}`;
  }

  if (action === 'Loot log deleted') {
    return `Deleted loot log ${cleanText(log.targetName, 'Untitled')}`;
  }

  if (action === 'Siphoned Energy updated') {
    return `Updated Siphoned Energy log`;
  }

  if (action === 'Members updated') {
    return `Updated members list`;
  }

  return cleanText(log.action, 'Updated webapp');
}

function flattenLogs(logs) {
  return logs.flatMap((log) => {
    const details = log.details || {};
    if (log.action === 'Permissions updated' && Array.isArray(details.changes) && details.changes.length > 0) {
      return details.changes.map((change, index) => ({
        ...log,
        actionText: permissionChangeText(change),
        rowId: `${log.id || log.createdAt}-permission-${index}`,
      }));
    }

    if (log.action === 'Death check completed' || log.action === 'Death checks completed') {
      return deathCheckRows(log);
    }

    return [{
      ...log,
      actionText: formatAction(log),
      rowId: log.id || `${log.createdAt}-${log.action}`,
    }];
  });
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

  const rows = useMemo(() => flattenLogs(logs), [logs]);
  const visibleCount = useMemo(() => rows.length.toLocaleString(), [rows.length]);

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

        {rows.length > 0 ? (
          <div className="action-logs-table-wrap">
            <table className="action-logs-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Action</th>
                  <th>Date and Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => (
                  <tr key={log.rowId}>
                    <td className="action-logs-actor">{cleanText(log.actorName, 'System')}</td>
                    <td className="action-logs-action-text">{log.actionText || formatAction(log)}</td>
                    <td><time dateTime={log.createdAt}>{formatDateTime(log.createdAt)}</time></td>
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

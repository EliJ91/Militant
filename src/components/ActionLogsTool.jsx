import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteActionLog, fetchActionLogs } from '../services/actionLogsApi';
import { fetchLootLogBundles } from '../services/lootLogApi';

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

function formatLogDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);
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

function getLootLogReference(log, bundleById) {
  const details = log.details || {};
  const bundle = bundleById.get(String(log.targetId || '')) || {};
  const number = Number(details.lootLogNumber || bundle.logNumber) || null;
  const rawName = cleanText(details.lootLogName || bundle.lootFileName || log.targetName);
  const name = /^\d+ players?$/i.test(rawName) ? '' : rawName;
  const prefix = number ? `Loot Log #${number}` : 'Loot Log';
  return name ? `${prefix}: ${name}` : prefix;
}

function deathCheckRows(log, bundleById) {
  const details = log.details || {};
  const players = Array.isArray(details.players) && details.players.length > 0
    ? details.players
    : [details.player].filter(Boolean);
  const lootLogReference = getLootLogReference(log, bundleById);

  if (players.length === 0) {
    return [{
      ...log,
      actionText: `Checked death for ${lootLogReference}`,
      rowId: `${log.id || log.createdAt}-death`,
    }];
  }

  return players.map((player, index) => ({
    ...log,
    actionText: `Checked ${player} death for ${lootLogReference}`,
    rowId: `${log.id || log.createdAt}-death-${index}`,
  }));
}

function formatAction(log, bundleById) {
  const action = cleanText(log.action);
  const details = log.details || {};
  const lootLogReference = getLootLogReference(log, bundleById);

  if (action === 'Loot log uploaded from Discord') {
    const uploadedBy = cleanText(details.uploadedBy);
    return uploadedBy
      ? `Uploaded ${uploadedBy} log from Discord to ${lootLogReference}`
      : `Uploaded loot log from Discord to ${lootLogReference}`;
  }

  if (action === 'Loot log uploaded') {
    return `Uploaded ${lootLogReference}`;
  }

  if (action === 'Chest log uploaded') {
    return `Uploaded chest log for ${lootLogReference}`;
  }

  if (action === 'Loot logs merged') {
    return `Merged loot logs into ${cleanText(log.targetName, 'new loot log')}`;
  }

  if (action === 'Loot log updated') {
    return `Updated loot log ${cleanText(log.targetName, 'Untitled')}`;
  }

  if (action === 'Loot log deleted') {
    const number = Number(details.lootLogNumber) || null;
    const name = cleanText(details.lootLogName || log.targetName, 'Untitled');
    const date = formatLogDate(details.lootLogDate);
    const reference = `${number ? `Loot Log #${number}: ` : ''}${name}`;
    return date ? `Deleted ${reference} (${date})` : `Deleted ${reference}`;
  }

  if (action === 'Siphoned Energy updated') {
    return `Updated Siphoned Energy log`;
  }

  if (action === 'Members updated') {
    return `Updated members list`;
  }

  return cleanText(log.action, 'Updated webapp');
}

function flattenLogs(logs, bundleById) {
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
      return deathCheckRows(log, bundleById);
    }

    return [{
      ...log,
      actionText: formatAction(log, bundleById),
      rowId: log.id || `${log.createdAt}-${log.action}`,
    }];
  });
}

export default function ActionLogsTool({ canDelete = false }) {
  const [logs, setLogs] = useState([]);
  const [nextCursor, setNextCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [bundleById, setBundleById] = useState(new Map());
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState({ message: '', state: 'loading' });
  const [contextMenu, setContextMenu] = useState(null);
  const [deleteStatus, setDeleteStatus] = useState('');
  const contextMenuRef = useRef(null);

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
    fetchLootLogBundles()
      .then((result) => {
        const bundles = result.bundles || [];
        setBundleById(new Map(bundles.map((bundle, index) => [String(bundle.id), {
          ...bundle,
          logNumber: bundle.logNumber || bundles.length - index,
        }])));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!contextMenu) return undefined;
    function closeContextMenu(event) {
      if (!contextMenuRef.current?.contains(event.target)) setContextMenu(null);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setContextMenu(null);
    }
    document.addEventListener('mousedown', closeContextMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeContextMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenu]);

  async function handleDeleteActionLog() {
    const actionLogId = contextMenu?.id;
    if (!actionLogId) return;
    setContextMenu(null);
    setDeleteStatus('Deleting entry...');
    try {
      await deleteActionLog(actionLogId);
      setLogs((current) => current.filter((log) => String(log.id) !== String(actionLogId)));
      setTotal((current) => Math.max(0, current - 1));
      setDeleteStatus('Action log entry deleted');
    } catch (error) {
      setDeleteStatus(error.message || 'Could not delete action log entry.');
    }
  }

  const rows = useMemo(() => flattenLogs(logs, bundleById), [bundleById, logs]);
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
                  <tr
                    className={canDelete ? 'action-log-deletable' : ''}
                    key={log.rowId}
                    onContextMenu={canDelete ? (event) => {
                      event.preventDefault();
                      setContextMenu({
                        id: log.id,
                        left: Math.min(event.clientX, window.innerWidth - 180),
                        top: Math.min(event.clientY, window.innerHeight - 64),
                      });
                    } : undefined}
                  >
                    <td className="action-logs-actor">{cleanText(log.actorName, 'System')}</td>
                    <td className="action-logs-action-text">{log.actionText || formatAction(log, bundleById)}</td>
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

      {contextMenu ? (
        <div
          className="action-log-context-menu"
          ref={contextMenuRef}
          role="menu"
          style={{ left: contextMenu.left, top: contextMenu.top }}
        >
          <button role="menuitem" type="button" onClick={handleDeleteActionLog}>
            <Trash2 aria-hidden="true" size={16} />
            Delete
          </button>
        </div>
      ) : null}
      {deleteStatus ? <div className="action-logs-toast" role="status">{deleteStatus}</div> : null}
    </main>
  );
}

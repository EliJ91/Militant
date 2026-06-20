import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSiphonedEnergyTransactions,
  updateSiphonedEnergyTransactions,
} from '../services/siphonedEnergyApi';
import { calculateSiphonedEnergyBalances } from '../utils/siphonedEnergy';

const NEGATIVE_THRESHOLD = -100;

function formatAmount(value, includeSign = true) {
  const amount = Number(value || 0);
  const prefix = includeSign && amount > 0 ? '+' : '';
  return `${prefix}${new Intl.NumberFormat('en-US').format(amount)}`;
}

function formatLogDate(value) {
  const match = String(value || '').match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/,
  );
  if (!match) return String(value || 'Unknown');
  const [, year, month, day, hour, minute, second] = match;
  return `${month}/${day}/${year} ${hour}:${minute}:${second}`;
}

export default function SiphonedEnergyTracker() {
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [logText, setLogText] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [loadStatus, setLoadStatus] = useState({ message: '', state: 'loading' });
  const [updateStatus, setUpdateStatus] = useState({ message: '', state: 'idle' });
  const logInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    fetchSiphonedEnergyTransactions()
      .then((result) => {
        if (!active) return;
        setTransactions(result.transactions || []);
        setLoadStatus({ message: '', state: 'ready' });
      })
      .catch((error) => {
        if (!active) return;
        setLoadStatus({ message: error.message, state: 'error' });
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isUpdateOpen) return undefined;

    logInputRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && updateStatus.state !== 'updating') setIsUpdateOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isUpdateOpen, updateStatus.state]);

  const negativePlayers = useMemo(() => (
    calculateSiphonedEnergyBalances(transactions)
      .filter((player) => player.amount <= NEGATIVE_THRESHOLD)
  ), [transactions]);

  async function pasteClipboard() {
    if (!navigator.clipboard?.readText) {
      setUpdateStatus({ message: 'Paste the copied log into the box below.', state: 'error' });
      return;
    }

    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) throw new Error('The clipboard is empty.');
      setLogText(clipboardText);
      setUpdateStatus({ message: 'Clipboard log ready to update.', state: 'ready' });
    } catch (error) {
      setUpdateStatus({
        message: error.message === 'The clipboard is empty.'
          ? error.message
          : 'Clipboard access was blocked. Paste the copied log into the box below.',
        state: 'error',
      });
    }
  }

  async function updateLog() {
    if (!logText.trim() || updateStatus.state === 'updating') return;
    setUpdateStatus({ message: 'Updating...', state: 'updating' });

    try {
      const result = await updateSiphonedEnergyTransactions(logText);
      setTransactions(result.transactions || []);
      setLogText('');
      const parts = [`${result.insertedRows || 0} new transactions added`];
      if (result.duplicateRows) parts.push(`${result.duplicateRows} already stored`);
      if (result.skippedRows?.length) parts.push(`${result.skippedRows.length} invalid rows skipped`);
      setUpdateStatus({ message: `${parts.join(', ')}.`, state: 'success' });
      setIsUpdateOpen(false);
    } catch (error) {
      setUpdateStatus({ message: error.message, state: 'error' });
    }
  }

  return (
    <main className="dashboard-shell siphoned-energy-shell">
      <section className="dashboard-heading siphoned-energy-heading" aria-labelledby="siphoned-energy-title">
        <div>
          <p className="eyebrow">Tool</p>
          <h1 id="siphoned-energy-title">Siphoned Energy Tracker</h1>
        </div>
        <div className="energy-heading-actions">
          <div className="energy-total">
            <small>Transactions</small>
            <strong>{new Intl.NumberFormat('en-US').format(transactions.length)}</strong>
          </div>
          <button
            className="view-logs-button energy-open-update"
            type="button"
            onClick={() => {
              setUpdateStatus({ message: '', state: 'idle' });
              setIsUpdateOpen(true);
            }}
          >
            Update Log
          </button>
        </div>
      </section>

      {updateStatus.message && !isUpdateOpen ? (
        <p className={`energy-update-result ${updateStatus.state}`}>{updateStatus.message}</p>
      ) : null}

      <section className="energy-debt-section" aria-labelledby="energy-debt-title">
        <div className="energy-section-heading">
          <div>
            <p className="eyebrow">Negative Tracker</p>
            <h2 id="energy-debt-title">Outstanding Energy</h2>
          </div>
          <strong>{negativePlayers.length} flagged</strong>
        </div>
        {negativePlayers.length > 0 ? (
          <div className="energy-debt-grid">
            {negativePlayers.map((player) => (
              <div className="energy-debt-card" key={player.player.toLowerCase()}>
                <span>{player.player}</span>
                <strong>{formatAmount(player.amount, false)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="energy-empty-inline">No player is negative 100 Energy or more.</p>
        )}
      </section>

      <section className="energy-log-section" aria-labelledby="energy-log-title">
        <div className="energy-section-heading">
          <div>
            <p className="eyebrow">Ledger</p>
            <h2 id="energy-log-title">Transaction Log</h2>
          </div>
        </div>

        {loadStatus.state === 'loading' ? <p className="energy-empty-inline">Loading transactions...</p> : null}
        {loadStatus.state === 'error' ? <p className="energy-message error">{loadStatus.message}</p> : null}
        {loadStatus.state === 'ready' && transactions.length === 0 ? (
          <p className="energy-empty-inline">No Siphoned Energy transactions have been uploaded.</p>
        ) : null}
        {transactions.length > 0 ? (
          <div className="energy-table-wrap">
            <table className="energy-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Player</th>
                  <th>Reason</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id || `${transaction.occurredAt}-${transaction.player}-${transaction.amount}`}>
                    <td>{formatLogDate(transaction.occurredAt)}</td>
                    <td><strong>{transaction.player}</strong></td>
                    <td>
                      <span className={`energy-reason ${transaction.reason.toLowerCase()}`}>
                        {transaction.reason}
                      </span>
                    </td>
                    <td className={transaction.amount < 0 ? 'energy-negative' : 'energy-positive'}>
                      {formatAmount(transaction.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {isUpdateOpen ? (
        <div
          className="energy-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && updateStatus.state !== 'updating') {
              setIsUpdateOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="energy-import-title"
            aria-modal="true"
            className="energy-import-modal"
            role="dialog"
          >
            <div className="energy-modal-heading">
              <div>
                <p className="eyebrow">Clipboard Update</p>
                <h2 id="energy-import-title">Update Energy Log</h2>
              </div>
              <button
                aria-label="Close update log"
                className="energy-modal-close"
                disabled={updateStatus.state === 'updating'}
                title="Close"
                type="button"
                onClick={() => setIsUpdateOpen(false)}
              >
                &times;
              </button>
            </div>
            <textarea
              ref={logInputRef}
              aria-label="Siphoned Energy log"
              placeholder={'Paste the copied log here\n\nDate    Player    Reason    Amount'}
              spellCheck="false"
              value={logText}
              onChange={(event) => setLogText(event.target.value)}
            />
            {updateStatus.message ? (
              <p className={`energy-message ${updateStatus.state}`}>{updateStatus.message}</p>
            ) : null}
            <div className="energy-import-actions">
              <button className="secondary-button" type="button" onClick={pasteClipboard}>
                Paste Clipboard
              </button>
              <button
                className="primary-button energy-update-button"
                disabled={!logText.trim() || updateStatus.state === 'updating'}
                type="button"
                onClick={updateLog}
              >
                {updateStatus.state === 'updating' ? 'Updating...' : 'Update'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

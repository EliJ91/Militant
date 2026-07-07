import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSiphonedEnergyTransactions,
  purgeSiphonedEnergyTransactions,
  updateSiphonedEnergyPlayerStar,
  updateSiphonedEnergyTransactions,
} from '../services/siphonedEnergyApi';
import { calculateSiphonedEnergyBalances } from '../utils/siphonedEnergy';

const NEGATIVE_THRESHOLD = -100;
const TRACKER_FILTERS = {
  IN_GUILD: 'inGuild',
  OUT_OF_GUILD: 'outOfGuild',
  STARRED: 'starred',
};

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

function pluralize(value, unit) {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

function elapsedSince(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  let remainingDays = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
  if (remainingDays === 0) return 'today';

  const months = Math.floor(remainingDays / 30);
  remainingDays %= 30;
  const weeks = Math.floor(remainingDays / 7);
  const days = remainingDays % 7;
  const parts = [];

  if (months > 0) parts.push(pluralize(months, 'month'));
  if (weeks > 0) parts.push(pluralize(weeks, 'week'));
  if (days > 0) parts.push(pluralize(days, 'day'));

  return `${parts.join(' ')} ago`;
}

function getLastTransactionDate(transactions) {
  return transactions.reduce((latest, transaction) => {
    const time = new Date(transaction.occurredAt).getTime();
    return Number.isFinite(time) && time > latest ? time : latest;
  }, 0);
}

function playerKey(player) {
  return String(player || '').trim().toLowerCase();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function daysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function datePartsFromTransaction(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return { day: match[3], month: match[2], year: match[1] };

  const date = new Date();
  return {
    day: pad2(date.getDate()),
    month: pad2(date.getMonth() + 1),
    year: String(date.getFullYear()),
  };
}

function formatPurgeDisplayDate({ day, month, year }) {
  return `${month}/${day}/${year}`;
}

function purgeDateValue({ day, month, year }) {
  return `${year}-${month}-${day}`;
}

export default function SiphonedEnergyTracker({ canUpdate = true }) {
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [isPurgeOpen, setIsPurgeOpen] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [logText, setLogText] = useState('');
  const [purgeConfirming, setPurgeConfirming] = useState(false);
  const [purgeConfirmSeconds, setPurgeConfirmSeconds] = useState(3);
  const [purgeDate, setPurgeDate] = useState(() => datePartsFromTransaction());
  const [purgeStatus, setPurgeStatus] = useState({ message: '', state: 'idle' });
  const [starMenu, setStarMenu] = useState(null);
  const [trackerFilter, setTrackerFilter] = useState(TRACKER_FILTERS.IN_GUILD);
  const [guildMemberPlayers, setGuildMemberPlayers] = useState([]);
  const [starredPlayers, setStarredPlayers] = useState([]);
  const [starUpdatingPlayer, setStarUpdatingPlayer] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [loadStatus, setLoadStatus] = useState({ message: '', state: 'loading' });
  const [updateStatus, setUpdateStatus] = useState({ message: '', state: 'idle' });
  const logInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    fetchSiphonedEnergyTransactions()
      .then((result) => {
        if (!active) return;
        setGuildMemberPlayers(result.guildMemberPlayers || []);
        setStarredPlayers(result.starredPlayers || []);
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

  useEffect(() => {
    if (!isPurgeOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && purgeStatus.state !== 'purging') setIsPurgeOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isPurgeOpen, purgeStatus.state]);

  useEffect(() => {
    if (!isPurgeOpen || !purgeConfirming || purgeConfirmSeconds <= 0) return undefined;

    const timer = window.setTimeout(() => {
      setPurgeConfirmSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [isPurgeOpen, purgeConfirming, purgeConfirmSeconds]);

  useEffect(() => {
    if (!starMenu) return undefined;

    const closeMenu = () => setStarMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [starMenu]);

  const allNegativePlayers = useMemo(() => (
    calculateSiphonedEnergyBalances(transactions)
      .filter((player) => player.amount <= NEGATIVE_THRESHOLD)
  ), [transactions]);
  const guildMemberKeys = useMemo(() => (
    new Set(guildMemberPlayers.map(playerKey))
  ), [guildMemberPlayers]);
  const starredPlayerKeys = useMemo(() => (
    new Set(starredPlayers.map(playerKey))
  ), [starredPlayers]);
  const negativePlayers = useMemo(() => allNegativePlayers.filter((player) => {
    const key = playerKey(player.player);
    if (trackerFilter === TRACKER_FILTERS.STARRED) return starredPlayerKeys.has(key);
    if (trackerFilter === TRACKER_FILTERS.OUT_OF_GUILD) return !guildMemberKeys.has(key);
    return guildMemberKeys.has(key) && !starredPlayerKeys.has(key);
  }), [allNegativePlayers, guildMemberKeys, starredPlayerKeys, trackerFilter]);
  const totalNegativeEnergy = useMemo(() => (
    negativePlayers.reduce((total, player) => total + player.amount, 0)
  ), [negativePlayers]);
  const negativePlayerColumns = useMemo(() => {
    if (negativePlayers.length === 0) return [];
    const columnCount = Math.min(5, Math.ceil(negativePlayers.length / 4));
    const rowsPerColumn = Math.ceil(negativePlayers.length / columnCount);
    return Array.from({ length: columnCount }, (_, index) => (
      negativePlayers.slice(index * rowsPerColumn, (index + 1) * rowsPerColumn)
    )).filter((column) => column.length > 0);
  }, [negativePlayers]);
  const lastTransactionTime = useMemo(() => getLastTransactionDate(transactions), [transactions]);
  const filteredTransactions = useMemo(() => {
    const search = ledgerSearch.trim().toLowerCase();
    if (!search) return transactions;
    return transactions.filter((transaction) => (
      String(transaction.player || '').toLowerCase().includes(search)
    ));
  }, [ledgerSearch, transactions]);
  const purgeYearOptions = useMemo(() => {
    const years = new Set(transactions.map((transaction) => (
      String(transaction.occurredAt || '').slice(0, 4)
    )).filter((year) => /^\d{4}$/.test(year)));
    years.add(String(new Date().getFullYear()));
    return [...years].sort((left, right) => Number(right) - Number(left));
  }, [transactions]);
  const purgeDayOptions = useMemo(() => (
    Array.from({ length: daysInMonth(purgeDate.year, purgeDate.month) }, (_, index) => pad2(index + 1))
  ), [purgeDate.month, purgeDate.year]);
  const lastUpdated = lastTransactionTime ? {
    elapsed: elapsedSince(lastTransactionTime),
    label: formatLogDate(new Date(lastTransactionTime).toISOString()),
  } : null;

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
      setGuildMemberPlayers(result.guildMemberPlayers || []);
      setStarredPlayers(result.starredPlayers || []);
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

  async function togglePlayerStar(player, forcedStarred = null) {
    const key = playerKey(player);
    if (!key || starUpdatingPlayer) return;

    const nextStarred = forcedStarred ?? !starredPlayerKeys.has(key);
    setStarUpdatingPlayer(key);
    setStarMenu(null);
    setStarredPlayers((current) => (
      nextStarred
        ? [...current, player]
        : current.filter((starredPlayer) => playerKey(starredPlayer) !== key)
    ));

    try {
      const result = await updateSiphonedEnergyPlayerStar({ player, starred: nextStarred });
      setStarredPlayers(result.starredPlayers || []);
    } catch (error) {
      setStarredPlayers((current) => (
        nextStarred
          ? current.filter((starredPlayer) => playerKey(starredPlayer) !== key)
          : [...current, player]
      ));
      setUpdateStatus({ message: error.message, state: 'error' });
    } finally {
      setStarUpdatingPlayer('');
    }
  }

  function openPurgeDialog() {
    setPurgeDate(datePartsFromTransaction(transactions[0]?.occurredAt));
    setPurgeConfirming(false);
    setPurgeConfirmSeconds(3);
    setPurgeStatus({ message: '', state: 'idle' });
    setIsPurgeOpen(true);
  }

  function updatePurgeDate(part, value) {
    setPurgeConfirming(false);
    setPurgeConfirmSeconds(3);
    setPurgeDate((current) => {
      const next = { ...current, [part]: value };
      const maxDay = daysInMonth(next.year, next.month);
      if (Number(next.day) > maxDay) next.day = pad2(maxDay);
      return next;
    });
  }

  function startPurgeConfirmation() {
    if (purgeStatus.state === 'purging') return;
    setPurgeConfirming(true);
    setPurgeConfirmSeconds(3);
    setPurgeStatus({ message: '', state: 'idle' });
  }

  async function purgeTransactions() {
    if (purgeStatus.state === 'purging' || !purgeConfirming || purgeConfirmSeconds > 0) return;
    setPurgeStatus({ message: 'Purging...', state: 'purging' });

    try {
      const result = await purgeSiphonedEnergyTransactions({ date: purgeDateValue(purgeDate) });
      setGuildMemberPlayers(result.guildMemberPlayers || []);
      setStarredPlayers(result.starredPlayers || []);
      setTransactions(result.transactions || []);
      setPurgeStatus({ message: '', state: 'idle' });
      setUpdateStatus({
        message: `Purged ${result.deletedRows || 0} transactions through ${formatPurgeDisplayDate(purgeDate)}.`,
        state: 'success',
      });
      setIsPurgeOpen(false);
    } catch (error) {
      setPurgeStatus({
        message: error.message || 'Could not purge Siphoned Energy transactions.',
        state: 'error',
      });
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
          <div className="energy-total energy-last-updated">
            <small>Last Updated</small>
            <strong>{lastUpdated?.label || 'None'}</strong>
            {lastUpdated?.elapsed ? <span>{lastUpdated.elapsed}</span> : null}
          </div>
          {canUpdate ? (
            <>
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
              <button
                aria-label="Purge data"
                className="energy-purge-button"
                title="Purge data"
                type="button"
                onClick={openPurgeDialog}
              >
                <span aria-hidden="true">&#128465;</span>
              </button>
            </>
          ) : null}
        </div>
      </section>

      {updateStatus.message && !isUpdateOpen ? (
        <p className={`energy-update-result ${updateStatus.state}`}>{updateStatus.message}</p>
      ) : null}

      <section className="energy-debt-section" aria-labelledby="energy-debt-title">
        <div className="energy-section-heading">
          <div>
            <p className="eyebrow">Negative Tracker</p>
            <div className="energy-debt-title-row">
              <h2 id="energy-debt-title">Outstanding Energy</h2>
              <strong className="energy-negative-total">{formatAmount(totalNegativeEnergy, false)}</strong>
            </div>
          </div>
          <strong className="energy-flag-count">
            <button
              className={trackerFilter === TRACKER_FILTERS.IN_GUILD ? 'energy-filter-button active' : 'energy-filter-button'}
              type="button"
              onClick={() => setTrackerFilter(TRACKER_FILTERS.IN_GUILD)}
            >
              Guild
            </button>
            <button
              className={trackerFilter === TRACKER_FILTERS.OUT_OF_GUILD ? 'energy-filter-button active' : 'energy-filter-button'}
              type="button"
              onClick={() => setTrackerFilter(TRACKER_FILTERS.OUT_OF_GUILD)}
            >
              Non-Guild
            </button>
            <button
              aria-label="Starred"
              className={trackerFilter === TRACKER_FILTERS.STARRED ? 'energy-filter-button energy-filter-star active' : 'energy-filter-button energy-filter-star'}
              type="button"
              onClick={() => setTrackerFilter(TRACKER_FILTERS.STARRED)}
            >
              <span aria-hidden="true">&#9733;</span>
            </button>
          </strong>
        </div>
        {negativePlayers.length > 0 ? (
          <div
            className="energy-debt-grid"
            style={{ '--energy-debt-columns': negativePlayerColumns.length }}
          >
            {negativePlayerColumns.map((column) => (
              <div className="energy-debt-column" key={column[0].player.toLowerCase()}>
                {column.map((player) => (
                  <div className="energy-debt-card" key={player.player.toLowerCase()}>
                    <span
                      className="energy-debt-player"
                      onClick={(event) => {
                        event.stopPropagation();
                        setStarMenu({
                          player: player.player,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                    >
                      <span>{player.player}</span>
                      {starredPlayerKeys.has(playerKey(player.player)) ? (
                        <span aria-label={`${player.player} starred`} className="energy-star-icon" role="img">
                          ★
                        </span>
                      ) : null}
                    </span>
                    <strong>{formatAmount(player.amount, false)}</strong>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="energy-empty-inline">No player is negative 100 Energy or more.</p>
        )}
      </section>

      {starMenu ? (
        <div
          className="energy-star-menu"
          role="menu"
          style={{ left: starMenu.x, top: starMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            disabled={starUpdatingPlayer === playerKey(starMenu.player)}
            role="menuitem"
            type="button"
            onClick={() => togglePlayerStar(
              starMenu.player,
              !starredPlayerKeys.has(playerKey(starMenu.player)),
            )}
          >
            {starredPlayerKeys.has(playerKey(starMenu.player)) ? 'Remove Star' : 'Star'}
          </button>
        </div>
      ) : null}

      <section className="energy-log-section" aria-labelledby="energy-log-title">
        <div className="energy-section-heading">
          <div>
            <p className="eyebrow">Ledger</p>
            <h2 id="energy-log-title">Transaction Log</h2>
          </div>
          <label className="energy-log-search">
            <span>Search Username</span>
            <input
              aria-label="Search transaction usernames"
              placeholder="Search username"
              type="search"
              value={ledgerSearch}
              onChange={(event) => setLedgerSearch(event.target.value)}
            />
          </label>
        </div>

        {loadStatus.state === 'loading' ? <p className="energy-empty-inline">Loading transactions...</p> : null}
        {loadStatus.state === 'error' ? <p className="energy-message error">{loadStatus.message}</p> : null}
        {loadStatus.state === 'ready' && transactions.length === 0 ? (
          <p className="energy-empty-inline">No Siphoned Energy transactions have been uploaded.</p>
        ) : null}
        {loadStatus.state === 'ready' && transactions.length > 0 && filteredTransactions.length === 0 ? (
          <p className="energy-empty-inline">No transactions match that username.</p>
        ) : null}
        {filteredTransactions.length > 0 ? (
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
                {filteredTransactions.map((transaction) => (
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
              placeholder="Paste the copied log here"
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

      {isPurgeOpen ? (
        <div
          className="energy-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && purgeStatus.state !== 'purging') {
              setIsPurgeOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="energy-purge-title"
            aria-modal="true"
            className="energy-import-modal energy-purge-modal"
            role="dialog"
          >
            <div className="energy-modal-heading">
              <div>
                <p className="eyebrow">Purge Data</p>
                <h2 id="energy-purge-title">Purge Siphoned Energy</h2>
              </div>
              <button
                aria-label="Close purge dialog"
                className="energy-modal-close"
                disabled={purgeStatus.state === 'purging'}
                type="button"
                onClick={() => setIsPurgeOpen(false)}
              >
                &times;
              </button>
            </div>
            <p className="energy-purge-warning">
              This is irreversible. All Siphoned Energy transactions from the selected date and before will be permanently deleted.
            </p>
            <div className="energy-purge-date-row">
              <label>
                <span>Month</span>
                <select
                  value={purgeDate.month}
                  onChange={(event) => updatePurgeDate('month', event.target.value)}
                >
                  {Array.from({ length: 12 }, (_, index) => pad2(index + 1)).map((month) => (
                    <option key={month} value={month}>{month}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Day</span>
                <select
                  value={purgeDate.day}
                  onChange={(event) => updatePurgeDate('day', event.target.value)}
                >
                  {purgeDayOptions.map((day) => (
                    <option key={day} value={day}>{day}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Year</span>
                <select
                  value={purgeDate.year}
                  onChange={(event) => updatePurgeDate('year', event.target.value)}
                >
                  {purgeYearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>
            </div>
            {purgeStatus.message ? (
              <p className={`energy-message ${purgeStatus.state}`}>{purgeStatus.message}</p>
            ) : null}
            {purgeConfirming ? (
              <p className="energy-purge-final-warning">
                Confirm permanent deletion through {formatPurgeDisplayDate(purgeDate)}.
              </p>
            ) : null}
            <div className="energy-import-actions">
              <button
                className="primary-button energy-purge-confirm"
                disabled={purgeStatus.state === 'purging' || (purgeConfirming && purgeConfirmSeconds > 0)}
                type="button"
                onClick={purgeConfirming ? purgeTransactions : startPurgeConfirmation}
              >
                {purgeStatus.state === 'purging'
                  ? 'Purging...'
                  : purgeConfirming
                    ? purgeConfirmSeconds > 0 ? `Confirm (${purgeConfirmSeconds})` : 'Confirm'
                    : 'Purge'}
              </button>
              <button
                className="secondary-button"
                disabled={purgeStatus.state === 'purging'}
                type="button"
                onClick={() => {
                  if (purgeConfirming) {
                    setPurgeConfirming(false);
                    setPurgeConfirmSeconds(3);
                    return;
                  }
                  setIsPurgeOpen(false);
                }}
              >
                {purgeConfirming ? 'Back' : 'Cancel'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

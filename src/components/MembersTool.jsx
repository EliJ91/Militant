import { useEffect, useMemo, useState } from 'react';
import { fetchSiphonedEnergyMembers } from '../services/siphonedEnergyApi';
import { recordActionLog } from '../services/actionLogsApi';

const SORT_COLUMNS = [
  { align: 'left', key: 'playerName', label: 'Username', type: 'text' },
  { key: 'dateAdded', label: 'Date Added', type: 'date' },
  { key: 'pvpKillFame', label: 'PvP Kill Fame', type: 'number' },
  { key: 'pveKillFame', label: 'PvE Kill Fame', type: 'number' },
  { key: 'deathFame', label: 'Death Fame', type: 'number' },
  { key: 'pvpDeathFameRatio', label: 'PvP/Death', type: 'number' },
];
const NUMBER_FILTER_COLUMNS = SORT_COLUMNS.filter((column) => column.type === 'number');
const MEMBER_UPDATE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

function emptyNumberFilters() {
  return Object.fromEntries(NUMBER_FILTER_COLUMNS.map((column) => [column.key, {
    operator: '',
    value: '',
  }]));
}

function parseFilterNumber(value) {
  const match = String(value || '').trim().toLowerCase().replace(/[$,\s]/g, '').match(/^(-?\d*\.?\d+)([kmb])?$/);
  if (!match) return null;
  const multiplier = match[2] === 'k' ? 1_000 : match[2] === 'm' ? 1_000_000 : match[2] === 'b' ? 1_000_000_000 : 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) ? parsed : null;
}

function formatFilterInput(value) {
  const compact = String(value || '').replace(/[$,\s]/g, '');
  if (!compact) return '';
  const match = compact.match(/^(-?)(\d*)(\.\d*)?([kmb])?$/i);
  if (!match) return String(value || '');
  const groupedInteger = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${match[1]}${groupedInteger}${match[3] || ''}${(match[4] || '').toLowerCase()}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

function formatRatio(value) {
  return value === null || value === undefined || Number.isNaN(Number(value))
    ? '-'
    : Number(value).toFixed(2);
}

function formatRefreshTime(value) {
  if (!value) return 'Not cached';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not cached';
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatDateAdded(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function dateValue(value) {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) ? time : 0;
}

function mostRecentRefreshTime(members) {
  return members.reduce((latest, member) => Math.max(latest, dateValue(member.refreshedAt)), 0);
}

export default function MembersTool({ canUpdate = false }) {
  const [copyStatus, setCopyStatus] = useState('');
  const [members, setMembers] = useState([]);
  const [loadStatus, setLoadStatus] = useState({ message: '', state: 'loading' });
  const [numberFilters, setNumberFilters] = useState(emptyNumberFilters);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortState, setSortState] = useState({ direction: 'desc', key: 'dateAdded' });

  async function loadMembers({ recordUpdate = false } = {}) {
    setLoadStatus({ message: '', state: 'loading' });

    try {
      const result = await fetchSiphonedEnergyMembers();
      setMembers(result.members || []);
      setLoadStatus({ message: '', state: 'loaded' });
      if (recordUpdate) {
        void recordActionLog({
          action: 'Members list updated',
          details: { count: result.members?.length || 0 },
          targetName: 'Militant Members',
          targetType: 'members',
        });
      }
    } catch (error) {
      setLoadStatus({
        message: error.message || 'Could not load Militant members.',
        state: 'error',
      });
    }
  }

  useEffect(() => {
    loadMembers();
  }, []);

  const totals = useMemo(() => members.reduce((summary, member) => ({
    deathFame: summary.deathFame + (Number(member.deathFame) || 0),
    pveKillFame: summary.pveKillFame + (Number(member.pveKillFame) || 0),
    pvpKillFame: summary.pvpKillFame + (Number(member.pvpKillFame) || 0),
  }), { deathFame: 0, pveKillFame: 0, pvpKillFame: 0 }), [members]);
  const visibleMembers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const column = SORT_COLUMNS.find((option) => option.key === sortState.key) || SORT_COLUMNS[0];
    const direction = sortState.direction === 'desc' ? -1 : 1;

    return members
      .filter((member) => !query || String(member.playerName || '').toLowerCase().includes(query))
      .filter((member) => NUMBER_FILTER_COLUMNS.every(({ key }) => {
        const filter = numberFilters[key];
        const target = parseFilterNumber(filter?.value);
        if (!filter?.operator || target === null) return true;
        const memberValue = Number(member[key]) || 0;
        return filter.operator === 'greater' ? memberValue > target : memberValue < target;
      }))
      .sort((left, right) => {
        if (column.type === 'date') {
          const difference = dateValue(left[column.key]) - dateValue(right[column.key]);
          if (difference !== 0) return difference * direction;
          return String(left.playerName || '').localeCompare(String(right.playerName || ''));
        }

        if (column.type === 'number') {
          const leftValue = Number(left[column.key]) || 0;
          const rightValue = Number(right[column.key]) || 0;
          return (leftValue - rightValue) * direction;
        }

        return String(left[column.key] || '').localeCompare(String(right[column.key] || '')) * direction;
      });
  }, [members, numberFilters, searchQuery, sortState]);
  const refreshedAt = members.find((member) => member.refreshedAt)?.refreshedAt;
  const refreshedAtTime = useMemo(() => mostRecentRefreshTime(members), [members]);
  const updateCoolingDown = refreshedAtTime > 0
    && Date.now() - refreshedAtTime >= 0
    && Date.now() - refreshedAtTime < MEMBER_UPDATE_COOLDOWN_MS;
  const updateInProgress = loadStatus.state === 'loading';
  const updateDisabled = !canUpdate || updateInProgress || updateCoolingDown;
  const updateDisabledReason = updateCoolingDown
    ? 'Updated within the last 3 days'
    : updateInProgress
      ? 'Member list update is in progress'
      : !canUpdate
        ? 'You do not have permission to update members'
        : '';
  const newestDateAdded = useMemo(() => Math.max(...members.map((member) => dateValue(member.dateAdded)), 0), [members]);
  const oldestDateAdded = useMemo(() => Math.min(
    ...members.map((member) => dateValue(member.dateAdded)).filter((value) => value > 0),
    newestDateAdded,
  ), [members, newestDateAdded]);

  function updateSort(key) {
    setSortState((current) => ({
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
      key,
    }));
  }

  function updateNumberFilter(key, field, value) {
    setNumberFilters((current) => ({
      ...current,
      [key]: { ...current[key], [field]: field === 'value' ? formatFilterInput(value) : value },
    }));
  }

  async function copyPlayerId(member) {
    const playerId = String(member.playerId || '').trim();
    if (!playerId) return;

    try {
      await navigator.clipboard.writeText(playerId);
    } catch {
      const input = document.createElement('textarea');
      input.value = playerId;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }

    setCopyStatus(`${member.playerName || 'Player'} ID copied`);
    window.setTimeout(() => setCopyStatus(''), 1600);
  }

  return (
    <main className="dashboard-shell members-shell">
      <section className="dashboard-heading members-heading" aria-labelledby="members-title">
        <div>
          <p className="eyebrow">Tool</p>
          <h1 id="members-title">Members</h1>
        </div>
        <span
          className={`members-update-control${updateDisabled ? ' is-disabled' : ''}`}
          data-tooltip={updateDisabledReason || undefined}
        >
          <button
            className="view-logs-button"
            disabled={updateDisabled}
            title={updateDisabled ? undefined : 'Update members'}
            type="button"
            onClick={() => loadMembers({ recordUpdate: true })}
          >
            {updateInProgress ? 'Updating' : 'Update'}
          </button>
        </span>
      </section>

      {loadStatus.state === 'error' ? <p className="loot-message error">{loadStatus.message}</p> : null}
      {copyStatus ? <p className="members-copy-toast" role="status">{copyStatus}</p> : null}

      <section className="members-summary-grid" aria-label="Member summary">
        <div className="members-summary-card">
          <span>Members</span>
          <strong>{formatNumber(members.length)}</strong>
        </div>
        <div className="members-summary-card">
          <span>PvP Kill Fame</span>
          <strong>{formatNumber(totals.pvpKillFame)}</strong>
        </div>
        <div className="members-summary-card">
          <span>PvE Kill Fame</span>
          <strong>{formatNumber(totals.pveKillFame)}</strong>
        </div>
        <div className="members-summary-card">
          <span>Last Member Lookup</span>
          <strong>{formatRefreshTime(refreshedAt)}</strong>
        </div>
      </section>

      <section className="members-table-section" aria-labelledby="members-table-title">
        <div className="members-table-heading">
          <div>
            <p className="eyebrow">Guild</p>
            <h2 id="members-table-title">Current Members</h2>
          </div>
          <div className="members-table-tools">
            <label className="members-search">
              <span>Search username</span>
              <input
                aria-label="Search member usernames"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
            <strong>{formatNumber(visibleMembers.length)} listed</strong>
          </div>
        </div>

        {loadStatus.state === 'loading' ? <p className="members-empty">Loading members...</p> : null}
        {loadStatus.state === 'loaded' && members.length === 0 ? <p className="members-empty">No members found.</p> : null}
        {members.length > 0 && visibleMembers.length === 0 ? <p className="members-empty">No members match the current filters.</p> : null}
        {visibleMembers.length > 0 ? (
          <div className="members-table-wrap">
            <table className="members-table">
              <thead>
                <tr>
                  {SORT_COLUMNS.map((column) => (
                    <th
                      aria-sort={sortState.key === column.key ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={column.align === 'left' ? 'members-text-column' : ''}
                      key={column.key}
                    >
                      {column.type === 'number' ? (
                        <div className="members-column-filter">
                          <select
                            aria-label={`${column.label} filter operator`}
                            value={numberFilters[column.key].operator}
                            onChange={(event) => updateNumberFilter(column.key, 'operator', event.target.value)}
                          >
                            <option value="">Any</option>
                            <option value="greater">Greater than</option>
                            <option value="less">Less than</option>
                          </select>
                          <input
                            aria-label={`${column.label} filter value`}
                            inputMode="decimal"
                            placeholder="Value"
                            type="text"
                            value={numberFilters[column.key].value}
                            onChange={(event) => updateNumberFilter(column.key, 'value', event.target.value)}
                          />
                        </div>
                      ) : null}
                      <button
                        aria-label={`Sort by ${column.label}`}
                        className={sortState.key === column.key ? 'members-sort-button active' : 'members-sort-button'}
                        type="button"
                        onClick={() => updateSort(column.key)}
                      >
                        <span>{column.label}</span>
                        <span aria-hidden="true">{sortState.key === column.key ? (sortState.direction === 'asc' ? '^' : 'v') : '<>'}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleMembers.map((member) => (
                  <tr
                    className={dateValue(member.dateAdded) === newestDateAdded && newestDateAdded > oldestDateAdded ? 'members-new-row' : ''}
                    key={member.playerId || member.playerKey || member.playerName}
                  >
                    <td>
                      <span
                        className="members-name-button"
                        role="button"
                        tabIndex={0}
                        title={member.playerId ? `Copy ${member.playerName} player ID` : member.playerName}
                        onClick={() => {
                          if (!window.getSelection?.()?.toString()) copyPlayerId(member);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            copyPlayerId(member);
                          }
                        }}
                      >
                        {member.playerName}
                      </span>
                    </td>
                    <td>{formatDateAdded(member.dateAdded)}</td>
                    <td>{formatNumber(member.pvpKillFame)}</td>
                    <td>{formatNumber(member.pveKillFame)}</td>
                    <td>{formatNumber(member.deathFame)}</td>
                    <td>{formatRatio(member.pvpDeathFameRatio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}

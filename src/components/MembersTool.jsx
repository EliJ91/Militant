import { useEffect, useMemo, useState } from 'react';
import { fetchSiphonedEnergyMembers } from '../services/siphonedEnergyApi';

const SORT_COLUMNS = [
  { align: 'left', key: 'playerName', label: 'Username', type: 'text' },
  { align: 'left', key: 'playerId', label: 'Player ID', type: 'text' },
  { key: 'pvpKillFame', label: 'PvP Kill Fame', type: 'number' },
  { key: 'pveKillFame', label: 'PvE Kill Fame', type: 'number' },
  { key: 'deathFame', label: 'Death Fame', type: 'number' },
  { key: 'pvpDeathFameRatio', label: 'PvP/Death', type: 'number' },
];

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

export default function MembersTool() {
  const [members, setMembers] = useState([]);
  const [loadStatus, setLoadStatus] = useState({ message: '', state: 'loading' });
  const [searchQuery, setSearchQuery] = useState('');
  const [sortState, setSortState] = useState({ direction: 'asc', key: 'playerName' });

  async function loadMembers() {
    setLoadStatus({ message: '', state: 'loading' });

    try {
      const result = await fetchSiphonedEnergyMembers();
      setMembers(result.members || []);
      setLoadStatus({ message: '', state: 'loaded' });
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
      .sort((left, right) => {
        if (column.type === 'number') {
          const leftValue = Number(left[column.key]) || 0;
          const rightValue = Number(right[column.key]) || 0;
          return (leftValue - rightValue) * direction;
        }

        return String(left[column.key] || '').localeCompare(String(right[column.key] || '')) * direction;
      });
  }, [members, searchQuery, sortState]);
  const refreshedAt = members.find((member) => member.refreshedAt)?.refreshedAt;

  function updateSort(key) {
    setSortState((current) => ({
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
      key,
    }));
  }

  return (
    <main className="dashboard-shell members-shell">
      <section className="dashboard-heading members-heading" aria-labelledby="members-title">
        <div>
          <p className="eyebrow">Tool</p>
          <h1 id="members-title">Members</h1>
        </div>
        <button
          className="view-logs-button"
          disabled={loadStatus.state === 'loading'}
          title="Refresh members"
          type="button"
          onClick={loadMembers}
        >
          {loadStatus.state === 'loading' ? 'Loading' : 'Refresh'}
        </button>
      </section>

      {loadStatus.state === 'error' ? <p className="loot-message error">{loadStatus.message}</p> : null}

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
        {members.length > 0 && visibleMembers.length === 0 ? <p className="members-empty">No members match that username.</p> : null}
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
                  <tr key={member.playerId || member.playerKey || member.playerName}>
                    <td>{member.playerName}</td>
                    <td className="members-player-id">{member.playerId || '-'}</td>
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

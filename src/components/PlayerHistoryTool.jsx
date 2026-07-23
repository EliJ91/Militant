import { useEffect, useMemo, useState } from 'react';
import { fetchPlayerHistory } from '../services/playerHistoryService';

const SORT_COLUMNS = [
  { key: 'playerName', label: 'Player', text: true },
  { key: 'ctaCount', label: 'CTAs' },
  { key: 'itemsLooted', label: 'Items Looted' },
  { key: 'itemsKept', label: 'Items Kept' },
  { key: 'itemsLost', label: 'Items Lost' },
  { key: 'averageItemsLootedPerCta', label: 'Avg. Looted / CTA' },
  { key: 'averageItemsKeptPerCta', label: 'Avg. Kept / CTA' },
  { key: 'uniqueItemsLooted', label: 'Unique Items' },
  { key: 'lastCtaAt', label: 'Last CTA' },
];

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return 'No CTA history';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No CTA history';
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);
}

function numericSortValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export default function PlayerHistoryTool() {
  const [players, setPlayers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortState, setSortState] = useState({ direction: 'desc', key: 'ctaCount' });
  const [loadStatus, setLoadStatus] = useState({ message: '', state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchPlayerHistory()
      .then((result) => {
        if (cancelled) return;
        setPlayers(result.players || []);
        setLoadStatus({ message: '', state: 'loaded' });
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadStatus({ message: error.message || 'Could not load player loot history.', state: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visiblePlayers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filteredPlayers = query
      ? players.filter((player) => player.playerName.toLowerCase().includes(query))
      : players;
    return [...filteredPlayers].sort((left, right) => {
      const leftValue = left[sortState.key];
      const rightValue = right[sortState.key];
      const comparison = sortState.key === 'playerName'
        ? String(leftValue).localeCompare(String(rightValue))
        : sortState.key === 'lastCtaAt'
          ? (new Date(leftValue || 0).getTime() - new Date(rightValue || 0).getTime())
          : numericSortValue(leftValue) - numericSortValue(rightValue);
      return (sortState.direction === 'asc' ? comparison : -comparison)
        || left.playerName.localeCompare(right.playerName);
    });
  }, [players, searchQuery, sortState]);
  function updateSort(key) {
    setSortState((current) => ({
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
      key,
    }));
  }

  return (
    <main className="dashboard-shell player-history-shell">
      <section className="dashboard-heading members-heading" aria-labelledby="player-history-title">
        <div>
          <p className="eyebrow">Tool</p>
          <h1 id="player-history-title">Player Loot History</h1>
        </div>
      </section>

      {loadStatus.state === 'error' ? <p className="loot-message error">{loadStatus.message}</p> : null}

      <section className="members-table-section" aria-labelledby="player-history-table-title">
        <div className="members-table-heading player-history-table-heading">
          <div>
            <p className="eyebrow">Militant Members, Past and Present</p>
            <h2 id="player-history-table-title">Loot Statistics</h2>
          </div>
          <div className="members-table-tools">
            <label className="members-search player-history-search">
              <span>Search player</span>
              <input
                aria-label="Search player loot history"
                placeholder="Player name"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
            <strong>{formatNumber(visiblePlayers.length)} listed</strong>
          </div>
        </div>

        {loadStatus.state === 'loading' ? <p className="members-empty">Loading player loot history...</p> : null}
        {loadStatus.state === 'loaded' && players.length === 0 ? <p className="members-empty">No Militant player loot history found.</p> : null}
        {players.length > 0 && visiblePlayers.length === 0 ? <p className="members-empty">No member matches that player name.</p> : null}
        {visiblePlayers.length > 0 ? (
          <div className="members-table-wrap">
            <table className="members-table player-history-table">
              <thead>
                <tr>
                  {SORT_COLUMNS.map((column) => (
                    <th
                      aria-sort={sortState.key === column.key ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={column.text ? 'members-text-column' : ''}
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
                {visiblePlayers.map((player) => (
                  <tr key={player.playerId || player.playerKey}>
                    <td><strong className="player-history-name">{player.playerName}</strong></td>
                    <td>{formatNumber(player.ctaCount)}</td>
                    <td>{formatNumber(player.itemsLooted)}</td>
                    <td>{formatNumber(player.itemsKept)}</td>
                    <td>{formatNumber(player.itemsLost)}</td>
                    <td>{formatNumber(player.averageItemsLootedPerCta, 1)}</td>
                    <td>{formatNumber(player.averageItemsKeptPerCta, 1)}</td>
                    <td>{formatNumber(player.uniqueItemsLooted)}</td>
                    <td className="player-history-date">{formatDate(player.lastCtaAt)}</td>
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

import { useEffect, useMemo, useState } from 'react';
import { fetchPlayerHistory } from '../services/playerHistoryService';

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

export default function PlayerHistoryTool() {
  const [players, setPlayers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
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
        setLoadStatus({ message: error.message || 'Could not load player history.', state: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visiblePlayers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return query
      ? players.filter((player) => player.playerName.toLowerCase().includes(query))
      : players;
  }, [players, searchQuery]);
  const totals = useMemo(() => players.reduce((summary, player) => ({
    itemsKept: summary.itemsKept + player.itemsKept,
    itemsLooted: summary.itemsLooted + player.itemsLooted,
    playersWithHistory: summary.playersWithHistory + (player.ctaCount > 0 ? 1 : 0),
  }), { itemsKept: 0, itemsLooted: 0, playersWithHistory: 0 }), [players]);

  return (
    <main className="dashboard-shell player-history-shell">
      <section className="dashboard-heading members-heading" aria-labelledby="player-history-title">
        <div>
          <p className="eyebrow">Tool</p>
          <h1 id="player-history-title">Player History</h1>
        </div>
      </section>

      {loadStatus.state === 'error' ? <p className="loot-message error">{loadStatus.message}</p> : null}

      <section className="members-summary-grid" aria-label="Player history summary">
        <div className="members-summary-card">
          <span>Current Members</span>
          <strong>{formatNumber(players.length)}</strong>
        </div>
        <div className="members-summary-card">
          <span>Members With History</span>
          <strong>{formatNumber(totals.playersWithHistory)}</strong>
        </div>
        <div className="members-summary-card">
          <span>Items Looted</span>
          <strong>{formatNumber(totals.itemsLooted)}</strong>
        </div>
        <div className="members-summary-card">
          <span>Items Kept</span>
          <strong>{formatNumber(totals.itemsKept)}</strong>
        </div>
      </section>

      <section className="members-table-section" aria-labelledby="player-history-table-title">
        <div className="members-table-heading player-history-table-heading">
          <div>
            <p className="eyebrow">Militant Members</p>
            <h2 id="player-history-table-title">Loot Statistics</h2>
          </div>
          <div className="members-table-tools">
            <label className="members-search player-history-search">
              <span>Search player</span>
              <input
                aria-label="Search player history"
                placeholder="Player name"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
            <strong>{formatNumber(visiblePlayers.length)} listed</strong>
          </div>
        </div>

        {loadStatus.state === 'loading' ? <p className="members-empty">Loading player history...</p> : null}
        {loadStatus.state === 'loaded' && players.length === 0 ? <p className="members-empty">No Militant members found.</p> : null}
        {players.length > 0 && visiblePlayers.length === 0 ? <p className="members-empty">No member matches that player name.</p> : null}
        {visiblePlayers.length > 0 ? (
          <div className="members-table-wrap">
            <table className="members-table player-history-table">
              <thead>
                <tr>
                  <th className="members-text-column">Player</th>
                  <th>CTAs</th>
                  <th>Items Looted</th>
                  <th>Items Kept</th>
                  <th>Items Lost</th>
                  <th>Avg. Looted / CTA</th>
                  <th>Avg. Kept / CTA</th>
                  <th>Unique Items</th>
                  <th>Last CTA</th>
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

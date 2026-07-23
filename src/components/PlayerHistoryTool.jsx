import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { fetchPlayerHistory } from '../services/playerHistoryService';

const SORT_COLUMNS = [
  { key: 'playerName', label: 'Player', text: true },
  { key: 'ctaCount', label: 'CTAs' },
  { key: 'itemsLooted', label: 'Items Looted' },
  { key: 'itemsKept', label: 'Items Kept' },
  { key: 'itemsLost', label: 'Items Lost' },
  { key: 'averageItemsLootedPerCta', label: 'Avg. Looted / CTA' },
  { key: 'lastCtaAt', label: 'Last CTA' },
];

const FILTER_STORAGE_KEY = 'militant.playerLootHistory.filters.v1';
const NONE_SELECTED_VALUE = '__none__';
const TIER_OPTIONS = [
  { label: 'T4', value: 'tier4' },
  { label: 'T5', value: 'tier5' },
  { label: 'T6', value: 'tier6' },
  { label: 'T7', value: 'tier7' },
  { label: 'T8', value: 'tier8' },
];
const TYPE_OPTIONS = [
  { label: 'Bag', value: 'bag' },
  { label: 'Cape', value: 'cape' },
  { label: 'Food', value: 'food' },
  { label: 'Memento', value: 'memento' },
  { label: 'Mount', value: 'mount' },
  { label: 'Potions', value: 'potion' },
  { label: 'Trash', value: 'trash' },
  { label: 'Other', value: 'other' },
];

function loadItemFilters() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(FILTER_STORAGE_KEY) || '{}');
    const savedTiers = Array.isArray(saved.tierFilters)
      ? saved.tierFilters
      : saved.tier && saved.tier !== 'all' ? [saved.tier] : [];
    const savedTypes = Array.isArray(saved.typeFilters)
      ? saved.typeFilters
      : saved.type && saved.type !== 'all' ? [saved.type] : [];
    const sanitize = (values, options) => values.filter((value) => (
      value === NONE_SELECTED_VALUE || options.some((option) => option.value === value)
    ));
    return {
      tierFilters: sanitize(savedTiers, TIER_OPTIONS),
      typeFilters: sanitize(savedTypes, TYPE_OPTIONS),
    };
  } catch {
    return { tierFilters: [], typeFilters: [] };
  }
}

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label || value;
}

function MultiSelectDropdown({ allLabel, label, onChange, options, selectedValues }) {
  const controlRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const optionValues = options.map((option) => option.value);
  const noneSelected = selectedValues.includes(NONE_SELECTED_VALUE);
  const allSelected = !noneSelected && (
    selectedValues.length === 0 || optionValues.every((value) => selectedValues.includes(value))
  );
  const selectedLabels = selectedValues
    .filter((value) => value !== NONE_SELECTED_VALUE)
    .map((value) => optionLabel(options, value));
  const summary = allSelected ? allLabel
    : noneSelected ? 'None selected'
      : selectedLabels.length === 1 ? selectedLabels[0]
        : `${selectedLabels.length} selected`;

  useEffect(() => {
    if (!isOpen) return undefined;
    function closeMenu(event) {
      if (!controlRef.current?.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('touchstart', closeMenu);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('touchstart', closeMenu);
    };
  }, [isOpen]);

  function toggleValue(value) {
    if (noneSelected) {
      onChange([value]);
      return;
    }
    if (allSelected) {
      onChange(optionValues.filter((optionValue) => optionValue !== value));
      return;
    }
    const next = selectedValues.includes(value)
      ? selectedValues.filter((selectedValue) => selectedValue !== value)
      : [...selectedValues, value];
    const hasEveryOption = optionValues.every((optionValue) => next.includes(optionValue));
    onChange(hasEveryOption ? [] : (next.length === 0 ? [NONE_SELECTED_VALUE] : next));
  }

  return (
    <div className="filter-dropdown-control" ref={controlRef}>
      <span className="filter-label">{label}</span>
      <details className="filter-dropdown" open={isOpen}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            setIsOpen((current) => !current);
          }}
        >
          <strong>{summary}</strong>
        </summary>
        <div className="filter-menu">
          <button
            className={allSelected ? 'filter-all-button disable-all' : 'filter-all-button enable-all'}
            type="button"
            onClick={() => onChange(allSelected ? [NONE_SELECTED_VALUE] : [])}
          >
            {allSelected ? 'Disable All' : 'Enable All'}
          </button>
          {options.map((option) => {
            const isSelected = allSelected || (!noneSelected && selectedValues.includes(option.value));
            return (
              <button
                className={`filter-option ${isSelected ? 'selected-option' : 'unselected-option'}`}
                key={option.value}
                type="button"
                onClick={() => toggleValue(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}

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

function itemImageUrl(itemId) {
  if (!itemId) return '';
  const imagePath = `${itemId}.png?count=1&quality=1&size=96`;
  if (typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
    return `/item-image/${imagePath}`;
  }
  return `https://images.weserv.nl/?url=${encodeURIComponent(`render.albiononline.com/v1/item/${imagePath}`)}`;
}

function getItemTier(item) {
  const itemIdMatch = String(item.itemId || '').match(/^T([4-8])_/i);
  if (itemIdMatch) return `tier${itemIdMatch[1]}`;
  const itemName = String(item.item || '').toLowerCase();
  if (itemName.startsWith("adept's")) return 'tier4';
  if (itemName.startsWith("expert's")) return 'tier5';
  if (itemName.startsWith("master's")) return 'tier6';
  if (itemName.startsWith("grandmaster's")) return 'tier7';
  if (itemName.startsWith("elder's")) return 'tier8';
  return 'unknown';
}

function isWeaponOrArmor(item) {
  const itemId = String(item.itemId || '').toUpperCase();
  return /^T\d+_(2H|MAIN|OFF|HEAD|ARMOR|SHOES)_/.test(itemId);
}

function getItemType(item) {
  const text = `${item.itemId || ''} ${item.item || ''}`.toLowerCase();
  const itemName = String(item.item || '').toLowerCase();
  if (/\bskin\b|\bsiege hammer\b/.test(itemName)) return 'other';
  if (text.includes('trash')) return 'trash';
  if (text.includes('memento')) return 'memento';
  if (text.includes('cape')) return 'cape';
  if (text.includes('bag')) return 'bag';
  if (text.includes('potion') || text.includes('poison')) return 'potion';
  if (/mount|horse|ox|stag|swiftclaw|wolf|boar|bear|mare|panther|lizard|moose|mammoth|ram|cougar|basilisk|salamander|terrorbird/.test(text)) return 'mount';
  if (/meal|food|omelette|stew|sandwich|pie|salad|soup|fish|roast|goose|pork|beef|mutton|chicken/.test(text)) return 'food';
  if (isWeaponOrArmor(item)) return 'gear';
  return 'other';
}

function itemMatchesFilters(item, filters) {
  const tier = getItemTier(item);
  const type = getItemType(item);
  if (filters.tierFilters.includes(NONE_SELECTED_VALUE)) return false;
  if (filters.tierFilters.length > 0 && !filters.tierFilters.includes(tier)) return false;
  if (type === 'gear') return true;
  if (filters.typeFilters.includes(NONE_SELECTED_VALUE)) return false;
  return filters.typeFilters.length === 0 || filters.typeFilters.includes(type);
}

export default function PlayerHistoryTool() {
  const [players, setPlayers] = useState([]);
  const [itemFilters, setItemFilters] = useState(loadItemFilters);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayerKey, setSelectedPlayerKey] = useState('');
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

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(itemFilters));
    } catch {
      // Keep filters usable when browser storage is unavailable.
    }
  }, [itemFilters]);

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

  function togglePlayer(playerKey) {
    setSelectedPlayerKey((current) => (current === playerKey ? '' : playerKey));
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
            <p className="eyebrow">Militant Members</p>
            <h2 id="player-history-table-title">Loot Statistics</h2>
          </div>
          <div className="player-history-filters" aria-label="Kept item filters">
            <MultiSelectDropdown
              allLabel="All tiers"
              label="Tier"
              options={TIER_OPTIONS}
              selectedValues={itemFilters.tierFilters}
              onChange={(tierFilters) => setItemFilters((current) => ({ ...current, tierFilters }))}
            />
            <MultiSelectDropdown
              allLabel="All item types"
              label="Item Type"
              options={TYPE_OPTIONS}
              selectedValues={itemFilters.typeFilters}
              onChange={(typeFilters) => setItemFilters((current) => ({ ...current, typeFilters }))}
            />
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
                {visiblePlayers.map((player) => {
                  const isExpanded = selectedPlayerKey === player.playerKey;
                  const filteredCtas = player.ctas.map((cta) => ({
                    ...cta,
                    itemsKept: cta.itemsKept.filter((item) => itemMatchesFilters(item, itemFilters)),
                  })).filter((cta) => cta.itemsKept.length > 0);
                  return (
                    <Fragment key={player.playerId || player.playerKey}>
                      <tr
                        aria-expanded={isExpanded}
                        className="player-history-row"
                        tabIndex={0}
                        onClick={() => togglePlayer(player.playerKey)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            togglePlayer(player.playerKey);
                          }
                        }}
                      >
                        <td>
                          <button
                            aria-label={`${isExpanded ? 'Hide' : 'View'} loot history for ${player.playerName}`}
                            className="player-history-name"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              togglePlayer(player.playerKey);
                            }}
                          >
                            <strong>{player.playerName}</strong>
                          </button>
                        </td>
                        <td>{formatNumber(player.ctaCount)}</td>
                        <td>{formatNumber(player.itemsLooted)}</td>
                        <td>{formatNumber(player.itemsKept)}</td>
                        <td>{formatNumber(player.itemsLost)}</td>
                        <td>{formatNumber(player.averageItemsLootedPerCta, 1)}</td>
                        <td className="player-history-date">{formatDate(player.lastCtaAt)}</td>
                      </tr>
                      {isExpanded ? (
                        <tr className="player-history-detail-row">
                          <td colSpan={SORT_COLUMNS.length}>
                            <div className="player-history-cta-list">
                              {filteredCtas.length > 0 ? filteredCtas.map((cta, index) => (
                                <section className="player-history-cta" key={cta.bundleId || `${cta.date}-${index}`}>
                                  <header>
                                    <div>
                                      <span>Loot Log</span>
                                      <h3>
                                        <a
                                          href={`#loot-monitor/${encodeURIComponent(cta.bundleId)}`}
                                          rel="noreferrer"
                                          target="_blank"
                                        >
                                          {cta.lootLogTitle}
                                        </a>
                                      </h3>
                                    </div>
                                    <time dateTime={cta.date}>{formatDate(cta.date)}</time>
                                  </header>
                                  <div className="player-history-kept-items">
                                    {cta.itemsKept.map((item) => (
                                      <div
                                        aria-label={`${item.item}, ${formatNumber(item.quantity)} kept`}
                                        className="player-history-kept-item"
                                        key={`${item.itemId || item.item}-${item.enchantment}`}
                                        role="img"
                                        title={`${item.item} — ${formatNumber(item.quantity)} kept`}
                                      >
                                        {itemImageUrl(item.itemId) ? (
                                          <img
                                            alt=""
                                            decoding="async"
                                            loading="lazy"
                                            src={itemImageUrl(item.itemId)}
                                          />
                                        ) : null}
                                        <strong>{formatNumber(item.quantity)}</strong>
                                      </div>
                                    ))}
                                  </div>
                                </section>
                              )) : <p className="members-empty">No kept items match the selected filters.</p>}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}

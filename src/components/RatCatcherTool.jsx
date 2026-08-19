import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Check, ChevronsUpDown, X } from 'lucide-react';
import { fetchWestAveragePrices } from '../services/albionMarket';
import {
  fetchIgnoredLootItems,
  fetchLootLogBundle,
  fetchLootLogBundles,
} from '../services/lootLogApi';
import {
  applyLootDeathChecks,
  buildLootMonitorReportFromEvents,
  buildLootMonitorReportFromParsedLoot,
  parseLootEvents,
} from '../utils/lootMonitor';
import {
  DEFAULT_FILTERS,
  LootItemTile,
  MultiSelectDropdown,
  PlayerEmv,
  SORT_BY_OPTIONS,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  StatusMultiSelectDropdown,
  TYPE_OPTIONS,
  allianceValuesForRow,
  buildVisiblePlayerGroups,
  copyElementScreenshot,
  displayAlliance,
  displayGuild,
  formatAllianceList,
  formatGuildList,
  formatNumber,
  formatSilver,
  getLootLogIgnoredItemKey,
  getVisibleRows,
  guildValuesForRow,
  valuesToOptions,
} from './LootMonitor';

const RAT_FILTER_STORAGE_KEY = 'militant.ratCatcher.filters.v1';

function loadFilters() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(RAT_FILTER_STORAGE_KEY) || '{}');
    return {
      ...DEFAULT_FILTERS,
      ...saved,
      alliances: Array.isArray(saved.alliances) ? saved.alliances : [],
      guilds: Array.isArray(saved.guilds) ? saved.guilds : [],
      status: Array.isArray(saved.status) ? saved.status : [],
      typeFilters: Array.isArray(saved.typeFilters) ? saved.typeFilters : [],
    };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''), undefined, { sensitivity: 'base' });
}

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label || value;
}

function incrementCount(counts, player, value) {
  const cleanPlayer = String(player || '').trim().toLowerCase();
  const cleanValue = String(value || '').trim();
  if (!cleanPlayer || !cleanValue) return;
  const playerCounts = counts.get(cleanPlayer) || new Map();
  playerCounts.set(cleanValue, (playerCounts.get(cleanValue) || 0) + 1);
  counts.set(cleanPlayer, playerCounts);
}

function mostCommonValue(counts, player) {
  const cleanPlayer = String(player || '').trim().toLowerCase();
  const playerCounts = counts.get(cleanPlayer);
  if (!playerCounts) return '';
  return [...playerCounts.entries()]
    .sort((left, right) => right[1] - left[1] || compareText(left[0], right[0]))[0]?.[0] || '';
}

function historySortValue(entry) {
  const label = String(entry?.label || '');
  const match = label.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Number.POSITIVE_INFINITY;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function combineReportRows(reports) {
  const rowsByKey = new Map();
  const guildCounts = new Map();
  const allianceCounts = new Map();

  reports.flatMap((report) => report?.rows || []).forEach((row) => {
    incrementCount(guildCounts, row.player, row.guild);
    incrementCount(allianceCounts, row.player, row.alliance);
  });

  reports.flatMap((report) => report?.rows || []).forEach((row) => {
    const key = [
      String(row.player || '').trim().toLowerCase(),
      String(row.itemId || row.item || '').trim().toLowerCase(),
      Number(row.enchantment) || 0,
    ].join('|');
    const current = rowsByKey.get(key);
    const playerGuild = mostCommonValue(guildCounts, row.player) || row.guild || '';
    const playerAlliance = mostCommonValue(allianceCounts, row.player) || row.alliance || '';

    if (!current) {
      rowsByKey.set(key, {
        ...row,
        alliance: playerAlliance,
        custodyChains: row.custodyChains || '',
        deathEvents: [...(row.deathEvents || [])],
        guild: playerGuild,
        ratHistoryEntries: [...(row.ratHistoryEntries || [])],
      });
      return;
    }

    ['accounted', 'deathAccounted', 'donated', 'kept', 'lost', 'quantity'].forEach((field) => {
      current[field] = (Number(current[field]) || 0) + (Number(row[field]) || 0);
    });
    current.alliance = playerAlliance || current.alliance;
    current.custodyChains = [current.custodyChains, row.custodyChains].filter(Boolean).join('\n');
    current.deathEvents = [...(current.deathEvents || []), ...(row.deathEvents || [])];
    current.guild = playerGuild || current.guild;
    current.ratHistoryEntries = [...(current.ratHistoryEntries || []), ...(row.ratHistoryEntries || [])]
      .sort((left, right) => historySortValue(left) - historySortValue(right));
  });

  return [...rowsByKey.values()].map((row) => ({
    ...row,
    ratHistoryEntries: [...(row.ratHistoryEntries || [])]
      .sort((left, right) => historySortValue(left) - historySortValue(right)),
  }));
}

function calculateDisplayedEmv(player, prices) {
  const missingItems = [];
  let baseValue = 0;

  player.tiles.forEach((tile) => {
    const price = Number(prices[tile.itemId]?.averagePrice) || 0;
    if (!tile.itemId || price <= 0) {
      missingItems.push(`${tile.item || 'Unknown item'} | Enchantment ${tile.enchantment || 0}`);
      return;
    }
    baseValue += price * (Number(tile.quantity) || 0);
  });

  return {
    missingItems: [...new Set(missingItems)],
    pending: false,
    value: Math.round(baseValue * 1.15),
  };
}

function sortPlayers(players, filters, hasCurrentEmv) {
  const filteredPlayers = filters.hideUnder500kEmv && hasCurrentEmv
    ? players.filter((player) => (Number(player.emv?.value) || 0) >= 500000)
    : players;

  return [...filteredPlayers].sort((left, right) => {
    const leftValue = filters.sortBy === 'emv' && hasCurrentEmv
      ? Number(left.emv?.value) || 0
      : left.totalQuantity;
    const rightValue = filters.sortBy === 'emv' && hasCurrentEmv
      ? Number(right.emv?.value) || 0
      : right.totalQuantity;
    const delta = leftValue - rightValue;
    return (filters.sortDirection === 'asc' ? delta : -delta) || compareText(left.player, right.player);
  });
}

function getBundleLabel(bundle) {
  const number = bundle.logNumber ? `#${bundle.logNumber} ` : '';
  return `${number}${bundle.lootFileName || bundle.displayLootFileName || 'Loot Log'}`;
}

function bundleLootText(bundle) {
  return (bundle.submissions || [])
    .map((submission) => submission.rawLogText || submission.raw_log_text || '')
    .filter((text) => String(text || '').trim())
    .join('\n');
}

function bundleChestText(bundle) {
  const rawChestText = (bundle.chestSubmissions || [])
    .map((submission) => submission.rawLogText || submission.raw_log_text || '')
    .filter((text) => String(text || '').trim())
    .join('\n');

  return rawChestText || bundle.chestLogReportText || bundle.chestLogText || '';
}

function buildRatHistoryEntries(row, bundle) {
  const bundleId = bundle?.id || '';
  const bundleLabel = getBundleLabel(bundle || {});
  return String(row.custodyChains || '')
    .split('\n')
    .filter(Boolean)
    .flatMap((chain) => chain.split(' -> ').filter(Boolean))
    .map((label) => ({
      bundleId,
      bundleLabel,
      item: row.item || row.itemName || '',
      itemId: row.itemId || '',
      label,
      player: row.player || '',
    }));
}

function buildRatBundleReport(bundle) {
  const rawLootText = bundleLootText(bundle);
  const chestText = bundleChestText(bundle);
  const report = rawLootText.trim()
    ? buildLootMonitorReportFromParsedLoot(parseLootEvents(rawLootText), chestText)
    : buildLootMonitorReportFromEvents(bundle.events || [], chestText);
  const checkedReport = applyLootDeathChecks(report, bundle.deathChecks || []);

  return {
    ...checkedReport,
    rows: (checkedReport.rows || []).map((row) => ({
      ...row,
      ratHistoryEntries: buildRatHistoryEntries(row, bundle),
    })),
  };
}

function BundlePicker({ bundles, combinedIds, loading, onChange, selectedIds }) {
  const pickerRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    function closePicker(event) {
      if (!pickerRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', closePicker);
    return () => document.removeEventListener('pointerdown', closePicker);
  }, [open]);

  return (
    <div className="rat-bundle-picker" ref={pickerRef}>
      <span className="filter-label">Loot Log Bundles</span>
      <button
        aria-expanded={open}
        className="rat-bundle-picker-button"
        disabled={loading}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <strong>{loading ? 'Loading logs...' : `${selectedIds.length} selected`}</strong>
        <ChevronsUpDown aria-hidden="true" size={16} />
      </button>
      {open ? (
        <div className="rat-bundle-menu">
          {bundles.length === 0 ? <p>No loot logs available.</p> : bundles.map((bundle) => {
            const selected = selectedIds.includes(bundle.id);
            const combined = combinedIds.includes(bundle.id);
            return (
              <button
                aria-pressed={selected}
                className={[selected ? 'selected' : '', combined ? 'combined' : ''].filter(Boolean).join(' ')}
                disabled={combined}
                key={bundle.id}
                type="button"
                onClick={() => onChange(selected
                  ? selectedIds.filter((id) => id !== bundle.id)
                  : [...selectedIds, bundle.id])}
              >
                <span>{getBundleLabel(bundle)}</span>
                {combined ? <small>Combined</small> : selected ? <Check aria-hidden="true" size={15} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function StatsModal({ onClose, players }) {
  const groups = useMemo(() => {
    const byGuild = new Map();
    players.forEach((player) => {
      const guild = String(player.guild || '').split(',').map((value) => value.trim()).filter(Boolean)[0] || 'No Guild';
      const current = byGuild.get(guild) || { guild, players: [], total: 0 };
      const value = Number(player.emv?.value) || 0;
      current.players.push({ name: player.player, value });
      current.total += value;
      byGuild.set(guild, current);
    });
    return [...byGuild.values()]
      .sort((left, right) => (
        left.guild === 'No Guild' ? -1 : right.guild === 'No Guild' ? 1 : compareText(left.guild, right.guild)
      ))
      .map((group) => ({
        ...group,
        players: group.players.sort((left, right) => compareText(left.name, right.name)),
      }));
  }, [players]);

  return (
    <div className="rat-stats-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="rat-stats-modal" aria-label="Rat Catcher statistics" aria-modal="true" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">Current Results</p>
            <h2>EMV Stats</h2>
          </div>
          <button aria-label="Close stats" type="button" onClick={onClose}><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="rat-stats-groups">
          {groups.map((group) => (
            <section className="rat-stats-group" key={group.guild}>
              <div className="rat-stats-group-heading">
                <h3>{group.guild}</h3>
                <strong>{formatSilver(group.total)}</strong>
              </div>
              <div className="rat-stats-player-list">
                {group.players.map((player) => (
                  <div key={player.name}><span>{player.name}</span><strong>{formatSilver(player.value)}</strong></div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function RatCatcherTool({ canViewHiddenPlayers = false }) {
  const boardRef = useRef(null);
  const [bundles, setBundles] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedBundles, setSelectedBundles] = useState([]);
  const [filters, setFilters] = useState(loadFilters);
  const [ignoredItems, setIgnoredItems] = useState([]);
  const [loadStatus, setLoadStatus] = useState({ message: '', state: 'loading' });
  const [combineProgress, setCombineProgress] = useState({ completed: 0, total: 0 });
  const [emvStatus, setEmvStatus] = useState({ message: '', state: 'idle' });
  const [marketPrices, setMarketPrices] = useState({});
  const [pricedSignature, setPricedSignature] = useState('');
  const [statsOpen, setStatsOpen] = useState(false);
  const [screenshotStatus, setScreenshotStatus] = useState({ message: '', state: 'idle' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchLootLogBundles(), fetchIgnoredLootItems().catch(() => ({ items: [] }))])
      .then(([bundleResult, ignoredResult]) => {
        if (cancelled) return;
        setBundles(bundleResult.bundles || []);
        setIgnoredItems(ignoredResult.items || []);
        setLoadStatus({ message: '', state: 'loaded' });
      })
      .catch((error) => {
        if (!cancelled) setLoadStatus({ message: error.message || 'Could not load loot logs.', state: 'error' });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(RAT_FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  const reports = useMemo(() => selectedBundles.map(buildRatBundleReport), [selectedBundles]);
  const combinedRows = useMemo(() => combineReportRows(reports), [reports]);
  const ignoredKeys = useMemo(() => new Set(ignoredItems.map((item) => (
    item.itemKey || getLootLogIgnoredItemKey(item)
  )).filter(Boolean)), [ignoredItems]);
  const displayableRows = useMemo(() => combinedRows.filter((row) => (
    !ignoredKeys.has(getLootLogIgnoredItemKey(row))
  )), [combinedRows, ignoredKeys]);
  const filterOptions = useMemo(() => ({
    alliances: valuesToOptions(displayableRows.flatMap(allianceValuesForRow), displayAlliance),
    guilds: valuesToOptions(displayableRows.flatMap(guildValuesForRow), displayGuild),
  }), [displayableRows]);
  const visibleRows = useMemo(() => getVisibleRows(displayableRows, filters), [displayableRows, filters]);
  const hiddenPlayers = useMemo(() => new Set(selectedBundles.flatMap((bundle) => (
    bundle.summary?.hiddenPlayers || []
  )).map((player) => String(player).trim().toLowerCase())), [selectedBundles]);
  const visiblePlayers = useMemo(() => buildVisiblePlayerGroups(visibleRows, filters)
    .filter((player) => canViewHiddenPlayers || !hiddenPlayers.has(player.player.toLowerCase())), [
    canViewHiddenPlayers,
    filters,
    hiddenPlayers,
    visibleRows,
  ]);
  const visibleSignature = useMemo(() => JSON.stringify(visiblePlayers.map((player) => ({
    player: player.player,
    tiles: player.tiles.map((tile) => `${tile.status}:${tile.itemId}:${tile.quantity}`),
  }))), [visiblePlayers]);
  const hasCurrentEmv = pricedSignature !== '' && pricedSignature === visibleSignature;
  const pricedPlayers = useMemo(() => visiblePlayers.map((player) => ({
    ...player,
    emv: hasCurrentEmv ? calculateDisplayedEmv(player, marketPrices) : null,
  })), [hasCurrentEmv, marketPrices, visiblePlayers]);
  const displayedPlayers = useMemo(() => sortPlayers(pricedPlayers, filters, hasCurrentEmv), [
    filters,
    hasCurrentEmv,
    pricedPlayers,
  ]);
  const combinedIds = useMemo(() => selectedBundles.map((bundle) => bundle.id), [selectedBundles]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    if (!['hideUnder500kEmv', 'sortBy', 'sortDirection'].includes(key)) {
      setPricedSignature('');
      setStatsOpen(false);
    }
  }

  async function checkEmv() {
    if (visiblePlayers.length === 0 || emvStatus.state === 'loading') return;
    const itemIds = [...new Set(visiblePlayers.flatMap((player) => (
      player.tiles.map((tile) => tile.itemId).filter(Boolean)
    )))];
    setEmvStatus({ message: '', state: 'loading' });
    try {
      const prices = await fetchWestAveragePrices(itemIds);
      setMarketPrices(prices);
      setPricedSignature(visibleSignature);
      setEmvStatus({ message: '', state: 'loaded' });
    } catch (error) {
      setEmvStatus({ message: error.message || 'Could not load Albion West market prices.', state: 'error' });
    }
  }

  async function fetchBundleWithRetry(bundleId) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await fetchLootLogBundle(bundleId);
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, attempt * 600));
      }
    }
    throw lastError;
  }

  async function combineSelectedBundles() {
    if (selectedIds.length === 0 || loadStatus.state === 'loading-selection') return;
    const idsToLoad = selectedIds.filter((bundleId) => !combinedIds.includes(bundleId));
    if (idsToLoad.length === 0) {
      setSelectedIds([]);
      return;
    }

    setLoadStatus({ message: '', state: 'loading-selection' });
    setCombineProgress({ completed: 0, total: idsToLoad.length });
    const loadedBundles = [];
    const failures = [];

    for (const bundleId of idsToLoad) {
      try {
        const result = await fetchBundleWithRetry(bundleId);
        if (result.bundle) loadedBundles.push(result.bundle);
        else failures.push(bundleId);
      } catch {
        failures.push(bundleId);
      } finally {
        setCombineProgress((current) => ({ ...current, completed: current.completed + 1 }));
      }
    }

    if (loadedBundles.length > 0) {
      setSelectedBundles((current) => [...current, ...loadedBundles]);
      setSelectedIds([]);
      setPricedSignature('');
      setMarketPrices({});
      setStatsOpen(false);
    }
    setLoadStatus(failures.length > 0
      ? { message: `${failures.length} selected ${failures.length === 1 ? 'bundle' : 'bundles'} could not be loaded after 3 attempts.`, state: 'error' }
      : { message: '', state: 'loaded' });
    setCombineProgress({ completed: 0, total: 0 });
  }

  async function copyScreenshot() {
    if (!boardRef.current || displayedPlayers.length === 0 || screenshotStatus.state === 'copying') return;
    setScreenshotStatus({ message: '', state: 'copying' });
    try {
      await copyElementScreenshot(boardRef.current);
      setScreenshotStatus({ message: 'Screenshot copied.', state: 'copied' });
    } catch (error) {
      setScreenshotStatus({ message: error.message || 'Could not copy screenshot.', state: 'error' });
    }
  }

  return (
    <main className="dashboard-shell rat-catcher-shell">
      <section className="dashboard-heading" aria-labelledby="rat-catcher-title">
        <p className="eyebrow">Tool</p>
        <h1 id="rat-catcher-title">Rat Catcher</h1>
      </section>

      <section className="rat-source-panel" aria-label="Loot log bundle selection">
        <BundlePicker
          bundles={bundles}
          combinedIds={combinedIds}
          loading={loadStatus.state === 'loading'}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
        />
        <button
          className="rat-combine-button"
          disabled={selectedIds.length === 0 || loadStatus.state === 'loading-selection'}
          type="button"
          onClick={combineSelectedBundles}
        >
          {loadStatus.state === 'loading-selection' ? 'Combining...' : 'Combine'}
        </button>
        <div className="rat-source-summary">
          <strong>{formatNumber(selectedBundles.length)}</strong>
          <span>{selectedBundles.length === 1 ? 'bundle combined' : 'bundles combined'}</span>
        </div>
      </section>

      {loadStatus.state === 'loading-selection' ? (
        <section className="rat-combine-progress" aria-live="polite">
          <div><strong>Combining loot logs</strong><span>{combineProgress.completed} / {combineProgress.total}</span></div>
          <progress max={Math.max(1, combineProgress.total)} value={combineProgress.completed} />
          <small>Each bundle is retried automatically if loading is interrupted.</small>
        </section>
      ) : null}

      {loadStatus.state === 'error' ? <p className="loot-message error">{loadStatus.message}</p> : null}
      {emvStatus.state === 'error' ? <p className="loot-message error">{emvStatus.message}</p> : null}
      {screenshotStatus.state === 'error' ? <p className="loot-message error">{screenshotStatus.message}</p> : null}

      <section className="loot-controls" aria-label="Rat Catcher filters">
        <label>
          <span>Sort By</span>
          <select value={filters.sortBy} onChange={(event) => updateFilter('sortBy', event.target.value)}>
            {SORT_BY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <MultiSelectDropdown
          allLabel="All item types"
          getLabel={(value) => optionLabel(TYPE_OPTIONS, value)}
          label="Item Type"
          options={TYPE_OPTIONS}
          selectedValues={filters.typeFilters}
          onChange={(value) => updateFilter('typeFilters', value)}
        />
        <MultiSelectDropdown
          allLabel="All guilds"
          getLabel={displayGuild}
          label="Guild"
          options={filterOptions.guilds}
          selectedValues={filters.guilds}
          onChange={(value) => updateFilter('guilds', value)}
        />
        <MultiSelectDropdown
          allLabel="All alliances"
          getLabel={displayAlliance}
          label="Alliance"
          options={filterOptions.alliances}
          selectedValues={filters.alliances}
          onChange={(value) => updateFilter('alliances', value)}
        />
        <label>
          <span>Sort</span>
          <select value={filters.sortDirection} onChange={(event) => updateFilter('sortDirection', event.target.value)}>
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <StatusMultiSelectDropdown
          label="Status"
          options={STATUS_OPTIONS}
          selectedValues={filters.status}
          onChange={(value) => updateFilter('status', value)}
        />
      </section>

      <div className="loot-board-toolbar rat-toolbar">
        <button
          aria-pressed={filters.hideUnder500kEmv}
          className={`board-copy-button emv-threshold-button${filters.hideUnder500kEmv ? ' active' : ''}`}
          disabled={!hasCurrentEmv}
          type="button"
          onClick={() => updateFilter('hideUnder500kEmv', !filters.hideUnder500kEmv)}
        >
          Hide under 500k EMV
        </button>
        <button
          className="board-copy-button rat-stats-button"
          disabled={!hasCurrentEmv || displayedPlayers.length === 0}
          type="button"
          onClick={() => setStatsOpen(true)}
        >
          <BarChart3 aria-hidden="true" size={15} />
          Stats
        </button>
        <button
          className="board-copy-button rat-check-emv-button"
          disabled={visiblePlayers.length === 0 || emvStatus.state === 'loading'}
          type="button"
          onClick={checkEmv}
        >
          {emvStatus.state === 'loading' ? 'Checking...' : 'Check EMV'}
        </button>
        <button
          className="board-copy-button"
          disabled={displayedPlayers.length === 0 || screenshotStatus.state === 'copying'}
          type="button"
          onClick={copyScreenshot}
        >
          {screenshotStatus.state === 'copying' ? 'Copying...' : 'Copy Screenshot'}
        </button>
      </div>

      <section className="loot-board-section" aria-label="Rat Catcher player loot board" data-loot-board-screenshot="true" ref={boardRef}>
        <header className="loot-board-header"><span>Name</span><span>Items</span></header>
        {selectedBundles.length === 0 ? (
          <p className="loot-message">Select loot log bundles, then choose Combine.</p>
        ) : loadStatus.state === 'loading-selection' ? (
          <p className="loot-message">Combining selected loot logs...</p>
        ) : displayedPlayers.length === 0 ? (
          <p className="loot-message">No item icons match the current filters.</p>
        ) : (
          <div className="loot-player-list">
            {displayedPlayers.map((player) => (
              <article className="loot-player-row rat-player-row" key={player.player}>
                <aside className="loot-player-name">
                  <strong>{player.player} <span>({formatNumber(player.totalQuantity)})</span></strong>
                  <small>[{formatAllianceList(player.alliance)}] {formatGuildList(player.guild)}</small>
                </aside>
                <div className="loot-item-grid" aria-label={`${player.player} item icons`}>
                  {player.tiles.map((tile, index) => (
                    <LootItemTile
                      historyClickMode
                      key={`${tile.status}:${tile.itemId}:${index}`}
                      tile={tile}
                    />
                  ))}
                </div>
                <div className="loot-player-actions"><PlayerEmv emv={player.emv} /></div>
              </article>
            ))}
          </div>
        )}
      </section>

      {statsOpen ? <StatsModal players={displayedPlayers} onClose={() => setStatsOpen(false)} /> : null}
    </main>
  );
}

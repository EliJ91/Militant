import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { fetchWestAveragePrices } from '../services/albionMarket';
import {
  deleteLootLogBundle,
  fetchLootLogBundle,
  fetchLootLogBundles,
  submitChestLog,
  submitLootLog,
  updateLootLogBundle,
} from '../services/lootLogApi';
import {
  buildLootMonitorReportFromEvents,
  combineChestLogTexts,
} from '../utils/lootMonitor';
import { warmItemImageCache } from '../utils/itemImageCache';

const FILTER_STORAGE_KEY = 'militant.lootMonitor.filters.v3';
const LEGACY_FILTER_STORAGE_KEY = 'militant.lootMonitor.filters.v2';
const GUILDLESS_VALUE = '__guildless__';
const NO_ALLIANCE_VALUE = '__no_alliance__';
const NONE_SELECTED_VALUE = '__none__';
const DAY_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_AGE_DAYS = 60;
const RETENTION_DAYS = 90;
const CTA_UTC_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];

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

const SORT_OPTIONS = [
  { label: 'Most to least', value: 'desc' },
  { label: 'Least to most', value: 'asc' },
];

const STATUS_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Kept', value: 'kept' },
  { label: 'Lost', value: 'lost' },
  { label: 'Donated', value: 'donated' },
  { label: 'Resolved', value: 'resolved' },
];

const TILE_STATUS_ORDER = {
  kept: 0,
  donated: 1,
  resolved: 2,
  lost: 3,
};

const TILE_STATUS_LABELS = {
  donated: 'Donated',
  kept: 'Kept',
  lost: 'Lost',
  resolved: 'Resolved',
};

const DEFAULT_FILTERS = {
  alliances: [],
  guilds: [],
  sortDirection: 'desc',
  status: [],
  tierFilters: [],
  typeFilters: [],
};

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatSilver(value) {
  return `$${formatNumber(Math.round(value || 0))}`;
}

function formatUtcDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';

  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);
}

function formatUtcDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const day = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;

  return `${day} ${time}`;
}

function formatUtcDateInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function buildEditedFileNames(dateUtc, ctaHour) {
  const date = new Date(`${dateUtc}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { chest: 'Chest Log', loot: 'Loot Log' };

  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
    .format(date)
    .toUpperCase();
  const day = String(date.getUTCDate()).padStart(2, '0');
  const baseName = `${String(ctaHour).padStart(2, '0')}UTC-${month}-${day}`;

  return {
    chest: `${baseName} Chest Log`,
    loot: `${baseName} Loot Log`,
  };
}

function stripLogSuffix(value, suffix) {
  const suffixLower = suffix.toLowerCase();
  let prefix = String(value || '').trim();

  while (prefix.toLowerCase().endsWith(suffixLower)) {
    prefix = prefix.slice(0, -suffix.length).trim();
  }

  return prefix;
}

function appendLogSuffix(value, suffix) {
  const prefix = stripLogSuffix(value, suffix);
  return prefix ? `${prefix} ${suffix}` : suffix;
}

function getRetentionStatus(startAt, now = Date.now()) {
  const startedAt = new Date(startAt).getTime();
  if (!Number.isFinite(startedAt)) return null;

  const ageMs = now - startedAt;
  if (ageMs < DOWNLOAD_AGE_DAYS * DAY_MS) return null;

  const expiresAt = startedAt + (RETENTION_DAYS * DAY_MS);
  return {
    daysUntilDeletion: Math.max(0, Math.ceil((expiresAt - now) / DAY_MS)),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function formatDeletionCountdown(days) {
  if (days <= 0) return 'Deletes today';
  return `Deletes in ${formatNumber(days)} ${days === 1 ? 'day' : 'days'}`;
}

function archiveFileName(bundle) {
  return `${safeDownloadName(bundle.lootFileName, 'Loot Log')}.zip`;
}

function textDownloadName(value, fallback) {
  const name = safeDownloadName(value, fallback);
  return name.toLowerCase().endsWith('.txt') ? name : `${name}.txt`;
}

function safeDownloadName(value, fallback) {
  const cleaned = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || fallback;
}

function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''));
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label || value;
}

function sanitizeStringArray(value) {
  return Array.isArray(value) ? uniqueStrings(value) : [];
}

function sanitizeOptionArray(value, options) {
  if (Array.isArray(value) && value.includes(NONE_SELECTED_VALUE)) return [NONE_SELECTED_VALUE];

  const allowed = new Set(options.map((option) => option.value));
  const selected = sanitizeStringArray(value).filter((entry) => allowed.has(entry));
  return selected.length === options.length ? [] : selected;
}

function migrateOldTierFilters(value) {
  const oldFilters = sanitizeStringArray(value.itemFilters);
  return oldFilters.filter((filter) => filter.startsWith('tier'));
}

function migrateOldTypeFilters(value) {
  const typeValues = new Set(TYPE_OPTIONS.map((option) => option.value));
  return sanitizeStringArray(value.itemFilters)
    .map((filter) => (filter === 'others' ? 'other' : filter))
    .filter((filter) => typeValues.has(filter));
}

function sanitizeFilters(value = {}) {
  const statusValues = new Set(STATUS_OPTIONS.filter((option) => option.value !== 'all').map((option) => option.value));
  const sortValues = new Set(SORT_OPTIONS.map((option) => option.value));
  const migratedStatus = value.status === 'deposited' ? 'donated' : value.status;
  const rawStatuses = Array.isArray(migratedStatus) ? migratedStatus : [migratedStatus];
  const noneStatusSelected = rawStatuses.includes(NONE_SELECTED_VALUE);
  const selectedStatuses = Array.isArray(migratedStatus)
    ? uniqueStrings(migratedStatus).filter((status) => statusValues.has(status))
    : statusValues.has(migratedStatus) ? [migratedStatus] : [];

  return {
    alliances: sanitizeStringArray(value.alliances ?? (value.alliance ? [value.alliance] : [])),
    guilds: sanitizeStringArray(value.guilds ?? (value.guild ? [value.guild] : [])),
    sortDirection: sortValues.has(value.sortDirection) ? value.sortDirection : DEFAULT_FILTERS.sortDirection,
    status: noneStatusSelected ? [NONE_SELECTED_VALUE] : (selectedStatuses.length === statusValues.size ? [] : selectedStatuses),
    tierFilters: sanitizeOptionArray(value.tierFilters ?? migrateOldTierFilters(value), TIER_OPTIONS),
    typeFilters: sanitizeOptionArray(value.typeFilters ?? migrateOldTypeFilters(value), TYPE_OPTIONS),
  };
}

function loadSavedFilters() {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;

  try {
    const saved = window.localStorage.getItem(FILTER_STORAGE_KEY)
      || window.localStorage.getItem(LEGACY_FILTER_STORAGE_KEY);
    return saved ? sanitizeFilters(JSON.parse(saved)) : DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

function splitAffiliations(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function guildValuesForRow(row) {
  const guilds = splitAffiliations(row.guild);
  return guilds.length ? guilds : [GUILDLESS_VALUE];
}

function allianceValuesForRow(row) {
  const alliances = splitAffiliations(row.alliance);
  return alliances.length ? alliances : [NO_ALLIANCE_VALUE];
}

function displayGuild(value) {
  return value === GUILDLESS_VALUE ? 'Guildless' : value;
}

function displayAlliance(value) {
  return value === NO_ALLIANCE_VALUE ? 'No Alliance' : value;
}

function formatGuildList(value) {
  const guilds = splitAffiliations(value);
  return guilds.length ? guilds.join(', ') : 'Guildless';
}

function formatAllianceList(value) {
  const alliances = splitAffiliations(value);
  return alliances.length ? alliances.join(', ') : 'No Alliance';
}

function valuesToOptions(values, getLabel = (value) => value) {
  return uniqueStrings(values)
    .sort((left, right) => getLabel(left).localeCompare(getLabel(right)))
    .map((value) => ({ label: getLabel(value), value }));
}

function mergeSavedOptions(options, selectedValues, getLabel = (value) => value) {
  const seen = new Set(options.map((option) => option.value));
  const savedOptions = selectedValues
    .filter((value) => value && value !== NONE_SELECTED_VALUE && !seen.has(value))
    .map((value) => ({ label: getLabel(value), missing: true, value }));

  return [...options, ...savedOptions];
}

function matchesAny(rowValues, selectedValues) {
  if (selectedValues.includes(NONE_SELECTED_VALUE)) return false;
  return selectedValues.length === 0 || rowValues.some((value) => selectedValues.includes(value));
}

function getItemTier(row) {
  const itemIdMatch = String(row.itemId || '').match(/^T([4-8])_/i);
  if (itemIdMatch) return `tier${itemIdMatch[1]}`;

  const item = String(row.item || '').toLowerCase();
  if (item.startsWith("adept's")) return 'tier4';
  if (item.startsWith("expert's")) return 'tier5';
  if (item.startsWith("master's")) return 'tier6';
  if (item.startsWith("grandmaster's")) return 'tier7';
  if (item.startsWith("elder's")) return 'tier8';
  return '';
}

function getItemTierLabel(row) {
  const tier = getItemTier(row);
  return tier ? tier.replace('tier', 'T') : 'Unknown tier';
}

function isWeaponOrArmor(row) {
  const itemId = String(row.itemId || '').toUpperCase();
  return /^T\d+_(2H|MAIN|OFF|HEAD|ARMOR|SHOES)_/.test(itemId);
}

function getItemKind(row) {
  const text = `${row.itemId || ''} ${row.item || ''}`.toLowerCase();

  if (text.includes('trash')) return 'trash';
  if (text.includes('memento')) return 'memento';
  if (text.includes('potion') || text.includes('poison')) return 'potion';
  if (text.includes('cape')) return 'cape';
  if (text.includes('bag')) return 'bag';
  if (/mount|horse|ox|stag|swiftclaw|wolf|boar|bear|mare|panther|lizard|moose|mammoth|ram|cougar|basilisk|salamander|terrorbird/.test(text)) {
    return 'mount';
  }
  if (/meal|food|omelette|stew|sandwich|pie|salad|soup|fish|roast|goose|pork|beef|mutton|chicken/.test(text)) {
    return 'food';
  }
  if (isWeaponOrArmor(row)) return 'gear';

  return 'other';
}

function allowsTileStatus(tileStatus, selectedStatuses) {
  return selectedStatuses.length === 0 || selectedStatuses.includes(tileStatus);
}

function allowsItemFilters(row, filters) {
  const tier = getItemTier(row);
  const kind = getItemKind(row);

  if (filters.tierFilters.includes(NONE_SELECTED_VALUE)) return false;
  if (filters.tierFilters.length > 0 && (!tier || !filters.tierFilters.includes(tier))) return false;
  if (kind === 'gear') return true;
  if (filters.typeFilters.includes(NONE_SELECTED_VALUE)) return false;
  if (filters.typeFilters.length > 0 && !filters.typeFilters.includes(kind)) return false;
  return true;
}

function getVisibleRows(rows, filters) {
  return rows.filter((row) => {
    if (filters.status.length > 0 && !filters.status.some((status) => (
      (status === 'kept' && row.kept > 0)
      || (status === 'lost' && row.lost > 0)
      || (status === 'donated' && row.donated > 0)
      || (status === 'resolved' && row.accounted > 0)
    ))) return false;
    if (!matchesAny(guildValuesForRow(row), filters.guilds)) return false;
    if (!matchesAny(allianceValuesForRow(row), filters.alliances)) return false;
    return allowsItemFilters(row, filters);
  });
}

function itemImageUrl(itemId) {
  if (!itemId) return '';
  const imagePath = `${itemId}.png?count=1&quality=1&size=217`;
  if (typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
    return `/item-image/${imagePath}`;
  }

  return `https://images.weserv.nl/?url=${encodeURIComponent(`render.albiononline.com/v1/item/${imagePath}`)}`;
}

function waitForImages(element) {
  const images = [...element.querySelectorAll('img')];

  return Promise.all(images.map((image) => {
    image.loading = 'eager';
    if (image.complete && image.naturalWidth > 0) {
      return image.decode ? image.decode().catch(() => {}) : Promise.resolve();
    }

    return new Promise((resolve) => {
      const timeout = window.setTimeout(resolve, 2000);
      image.addEventListener('load', () => {
        window.clearTimeout(timeout);
        (image.decode ? image.decode() : Promise.resolve()).catch(() => {}).finally(resolve);
      }, { once: true });
      image.addEventListener('error', () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }));
}

async function renderElementScreenshotBlob(element) {
  if (!element) throw new Error('Nothing to capture.');

  await document.fonts?.ready;
  await waitForImages(element);

  const canvas = await html2canvas(element, {
    allowTaint: false,
    backgroundColor: '#181a18',
    height: element.scrollHeight,
    logging: false,
    scale: Math.min(2, window.devicePixelRatio || 1.5),
    scrollX: -window.scrollX,
    scrollY: -window.scrollY,
    useCORS: true,
    width: element.scrollWidth,
    windowHeight: Math.max(document.documentElement.clientHeight, element.scrollHeight),
    windowWidth: Math.max(document.documentElement.clientWidth, element.scrollWidth),
  });

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not create screenshot.');

  return blob;
}

async function copyElementScreenshot(element) {
  if (!navigator.clipboard?.write || typeof window.ClipboardItem === 'undefined') {
    throw new Error('Clipboard image copy is not available in this browser.');
  }

  window.focus();

  const blobPromise = renderElementScreenshotBlob(element);
  await navigator.clipboard.write([
    new window.ClipboardItem({ 'image/png': blobPromise }),
  ]);
}

function formatScreenshotError(error) {
  const message = error?.message || 'Could not copy screenshot.';
  if (/focus|focused/i.test(message)) return 'Click inside the page and try again.';
  return message;
}

function buildItemTiles(row, filters) {
  return [
    { quantity: row.kept, status: 'kept' },
    { quantity: row.donated, status: 'donated' },
    { quantity: row.accounted, status: 'resolved' },
    { quantity: row.lost, status: 'lost' },
  ].filter((tile) => (
    tile.quantity > 0 && allowsTileStatus(tile.status, filters.status)
  )).map((tile) => ({
    ...tile,
    alliance: row.alliance,
    guild: row.guild,
    enchantment: row.enchantment,
    imageUrl: itemImageUrl(row.itemId),
    item: row.item,
    itemId: row.itemId,
    lostTo: row.lostTo,
    player: row.player,
  }));
}

function formatMissingPriceItem(tile) {
  return `${getItemTierLabel(tile)} | ${tile.item || 'Unknown item'} | Enchantment ${tile.enchantment || 0}`;
}

function calculatePlayerEmv(player, marketPrices) {
  const missingByItem = new Map();
  let pendingCount = 0;
  let baseValue = 0;

  player.tiles
    .filter((tile) => tile.status === 'kept')
    .forEach((tile) => {
      if (!tile.itemId) {
        missingByItem.set(tile.item || 'unknown', tile);
        return;
      }

      const priceEntry = marketPrices[tile.itemId];
      if (!priceEntry) {
        pendingCount += 1;
        return;
      }

      const averagePrice = Number(priceEntry.averagePrice) || 0;
      if (averagePrice <= 0) {
        missingByItem.set(tile.itemId, tile);
        return;
      }

      baseValue += averagePrice * tile.quantity;
    });

  const missingItems = [...missingByItem.values()].map(formatMissingPriceItem);

  return {
    missingItems,
    pending: pendingCount > 0,
    value: Math.round(baseValue * 1.15),
  };
}

function addPlayerEmv(players, marketPrices) {
  return players.map((player) => ({
    ...player,
    emv: calculatePlayerEmv(player, marketPrices),
  }));
}

function buildVisiblePlayerGroups(rows, filters) {
  const byPlayer = new Map();

  rows.forEach((row) => {
    const tiles = buildItemTiles(row, filters);
    if (tiles.length === 0) return;

    const key = row.player.toLowerCase();
    const current = byPlayer.get(key) || {
      alliance: row.alliance,
      donatedQuantity: 0,
      guild: row.guild,
      keptQuantity: 0,
      lostQuantity: 0,
      player: row.player,
      resolvedQuantity: 0,
      tiles: [],
      totalQuantity: 0,
    };

    if (!current.alliance && row.alliance) current.alliance = row.alliance;
    if (!current.guild && row.guild) current.guild = row.guild;

    tiles.forEach((tile) => {
      current.tiles.push(tile);
      current.totalQuantity += tile.quantity;
      if (tile.status === 'kept') current.keptQuantity += tile.quantity;
      if (tile.status === 'donated') current.donatedQuantity += tile.quantity;
      if (tile.status === 'resolved') current.resolvedQuantity += tile.quantity;
      if (tile.status === 'lost') current.lostQuantity += tile.quantity;
    });

    byPlayer.set(key, current);
  });

  return [...byPlayer.values()].map((player) => ({
    ...player,
    tiles: player.tiles.sort((left, right) => (
      TILE_STATUS_ORDER[left.status] - TILE_STATUS_ORDER[right.status]
      || compareText(left.item, right.item)
    )),
  })).sort((left, right) => {
    const quantityDelta = left.totalQuantity - right.totalQuantity;
    return (filters.sortDirection === 'asc' ? quantityDelta : -quantityDelta)
      || compareText(left.player, right.player);
  });
}

function detectFileKind(text) {
  const sample = String(text || '').slice(0, 4000).toLowerCase();

  if (sample.includes('looted_by__name') && sample.includes('item_id') && sample.includes('item_name')) {
    return 'loot';
  }

  if (sample.includes('date') && sample.includes('player') && sample.includes('enchantment') && sample.includes('amount') && sample.includes('\t')) {
    return 'chest';
  }

  return '';
}

function StatusLegend({ className = '' }) {
  return (
    <div className={className ? `loot-status-legend ${className}` : 'loot-status-legend'} aria-label="Loot status legend">
      <span className="legend-kept">Kept</span>
      <span className="legend-donated">Donated</span>
      <span className="legend-resolved">Resolved</span>
      <span className="legend-lost">Lost</span>
    </div>
  );
}

function MultiSelectDropdown({ allLabel, getLabel, label, onChange, options, selectedValues }) {
  const controlRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const mergedOptions = mergeSavedOptions(options, selectedValues, getLabel);
  const optionValues = mergedOptions.map((option) => option.value);
  const noneSelected = selectedValues.includes(NONE_SELECTED_VALUE);
  const allSelected = !noneSelected && (
    selectedValues.length === 0
    || (optionValues.length > 0 && optionValues.every((optionValue) => selectedValues.includes(optionValue)))
  );
  const selectedLabels = selectedValues
    .filter((value) => value !== NONE_SELECTED_VALUE)
    .map((value) => getLabel(value));
  const summary = allSelected ? allLabel
    : noneSelected ? 'None selected'
    : selectedLabels.length === 1 ? selectedLabels[0]
      : `${selectedLabels.length} selected`;

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event) {
      if (!controlRef.current?.contains(event.target)) setIsOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
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
    const hasEveryOption = optionValues.length > 0 && optionValues.every((optionValue) => next.includes(optionValue));
    onChange(hasEveryOption ? [] : (next.length === 0 ? [NONE_SELECTED_VALUE] : next));
  }

  function toggleAll() {
    onChange(allSelected ? [NONE_SELECTED_VALUE] : []);
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
            title={allSelected ? 'Deselect all' : 'Select all'}
            type="button"
            onClick={toggleAll}
          >
            {allSelected ? 'Disable All' : 'Enable All'}
          </button>
          {mergedOptions.length === 0 ? (
            <p className="filter-empty">No options</p>
          ) : (
            mergedOptions.map((option) => {
              const isSelected = allSelected || (!noneSelected && selectedValues.includes(option.value));
              return (
                <button
                  className={[
                    'filter-option',
                    isSelected ? 'selected-option' : 'unselected-option',
                    option.missing ? 'missing-option' : '',
                  ].filter(Boolean).join(' ')}
                  key={option.value}
                  title={option.label}
                  type="button"
                  onClick={() => toggleValue(option.value)}
                >
                  {option.label}
                </button>
              );
            })
          )}
        </div>
      </details>
    </div>
  );
}

function StatusMultiSelectDropdown({ disabledOptions = {}, label, onChange, options, selectedValues }) {
  const controlRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const statusOptions = options.filter((option) => option.value !== 'all');
  const optionValues = statusOptions.map((option) => option.value);
  const noneSelected = selectedValues.includes(NONE_SELECTED_VALUE);
  const allSelected = !noneSelected && (
    selectedValues.length === 0
    || optionValues.every((optionValue) => selectedValues.includes(optionValue))
  );
  const selectedLabels = statusOptions
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => option.label);
  const summary = allSelected ? 'All'
    : noneSelected ? 'None selected'
    : selectedLabels.length === 1 ? selectedLabels[0]
      : `${selectedLabels.length} selected`;

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event) {
      if (!controlRef.current?.contains(event.target)) setIsOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen]);

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
        <div className="filter-menu single-select-menu">
          <button
            className={allSelected ? 'filter-all-button disable-all' : 'filter-all-button enable-all'}
            title={allSelected ? 'Deselect all' : 'Select all'}
            type="button"
            onClick={() => onChange(allSelected ? [NONE_SELECTED_VALUE] : [])}
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          {statusOptions.map((option) => {
            const tooltip = disabledOptions[option.value];
            const isSelected = allSelected || (!noneSelected && selectedValues.includes(option.value));
            return (
              <div
                className={tooltip ? 'filter-option-tooltip' : undefined}
                data-tooltip={tooltip || undefined}
                key={option.value}
                title={tooltip || undefined}
              >
                <button
                  aria-disabled={Boolean(tooltip)}
                  className={[
                    'filter-option',
                    isSelected ? 'selected-option' : 'unselected-option',
                    tooltip ? 'disabled-option' : '',
                  ].filter(Boolean).join(' ')}
                  disabled={Boolean(tooltip)}
                  title={tooltip || option.label}
                  type="button"
                  onClick={() => {
                    let next;
                    if (noneSelected) {
                      next = [option.value];
                    } else if (allSelected) {
                      next = optionValues.filter((value) => value !== option.value);
                    } else {
                      next = selectedValues.includes(option.value)
                        ? selectedValues.filter((value) => value !== option.value)
                        : [...selectedValues, option.value];
                    }
                    onChange(optionValues.every((value) => next.includes(value)) ? [] : (next.length === 0 ? [NONE_SELECTED_VALUE] : next));
                  }}
                >
                  {option.label}
                </button>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

function LootItemTile({ tile }) {
  const [imageAttempt, setImageAttempt] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const statusLabel = TILE_STATUS_LABELS[tile.status] || tile.status;
  const label = `${tile.player} ${statusLabel} ${tile.quantity} ${tile.item}`;
  const itemDetail = tile.itemId ? `${tile.item} (${tile.itemId})` : `${tile.item} (missing item id)`;
  const imageSrc = imageAttempt > 0 ? `${tile.imageUrl}&retry=${imageAttempt}` : tile.imageUrl;
  const itemInitials = String(tile.item || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  useEffect(() => {
    setImageAttempt(0);
    setImageFailed(false);
  }, [tile.imageUrl]);

  function handleImageError() {
    if (imageAttempt < 2) {
      window.setTimeout(() => setImageAttempt((current) => current + 1), 180 * (imageAttempt + 1));
      return;
    }

    setImageFailed(true);
  }

  return (
    <figure
      aria-label={label}
      className={`loot-item-tile ${tile.status}-tile`}
      title={tile.lostTo ? `${itemDetail} - ${statusLabel} to ${tile.lostTo}` : `${itemDetail} - ${statusLabel}`}
    >
      {tile.imageUrl && !imageFailed ? (
        <img
          alt=""
          crossOrigin="anonymous"
          decoding="async"
          loading="lazy"
          src={imageSrc}
          onError={handleImageError}
          onLoad={() => setImageFailed(false)}
        />
      ) : (
        <span className="loot-item-fallback">{itemInitials}</span>
      )}
      <figcaption>{formatNumber(tile.quantity)}</figcaption>
    </figure>
  );
}

function PlayerEmv({ emv }) {
  const hasMissingPrices = emv.missingItems.length > 0;
  const title = hasMissingPrices
    ? `Missing price data:\n${emv.missingItems.join('\n')}`
    : undefined;

  return (
    <strong
      className={[
        'loot-player-emv',
        hasMissingPrices ? 'missing-price' : '',
        emv.pending ? 'loading-price' : '',
      ].filter(Boolean).join(' ')}
      title={title}
    >
      {emv.pending ? 'EMV loading...' : `EMV ${formatSilver(emv.value)}`}
    </strong>
  );
}

function FileUploadButton({
  accept,
  className,
  disabled,
  dropLabel,
  enableDrop = false,
  label,
  loadingLabel,
  multiple = false,
  onFile,
  onFiles,
  title,
}) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  function receiveFiles(fileList) {
    const files = [...(fileList || [])];
    if (files.length === 0) return;

    if (multiple && onFiles) {
      onFiles(files);
      return;
    }

    onFile?.(files[0]);
  }

  function receiveDroppedFile(event) {
    if (!enableDrop || disabled) return;
    event.preventDefault();
    setIsDragging(false);
    receiveFiles(event.dataTransfer.files);
  }

  return (
    <>
      <input
        accept={accept}
        className="file-input-hidden"
        disabled={disabled}
        multiple={multiple}
        ref={inputRef}
        type="file"
        onChange={(event) => {
          const files = [...(event.target.files || [])];
          event.target.value = '';
          receiveFiles(files);
        }}
      />
      <button
        aria-label={title || label}
        className={`${className}${isDragging ? ' drag-over' : ''}`}
        disabled={disabled}
        title={title || label}
        type="button"
        onDragEnter={(event) => {
          if (!enableDrop || disabled) return;
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => {
          if (!enableDrop || disabled) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setIsDragging(true);
        }}
        onDrop={receiveDroppedFile}
        onClick={() => inputRef.current?.click()}
      >
        {isDragging && dropLabel ? dropLabel : (disabled && loadingLabel ? loadingLabel : label)}
      </button>
    </>
  );
}

function StatusToasts({ messages }) {
  const visibleMessages = messages
    .filter((status) => status?.message)
    .map((status, index) => ({ ...status, id: `${status.state || 'status'}-${index}` }));

  if (visibleMessages.length === 0) return null;

  return (
    <div className="status-toast-stack" aria-live="polite" aria-atomic="true">
      {visibleMessages.map((status) => (
        <p className={`status-toast ${status.state === 'error' ? 'error' : ''}`} key={status.id}>
          {status.message}
        </p>
      ))}
    </div>
  );
}

function formatSubmitterList(submitters, fallback = 'Manual') {
  const names = [...new Set((submitters || [])
    .map((submitter) => String(submitter || '').trim())
    .filter(Boolean))];
  return names.length ? names.join(', ') : fallback;
}

function submitterNamesFromSubmissions(submissions = []) {
  return submissions.map((submission) => submission.submittedBy);
}

function LootLogBundleList({
  bundles,
  deletingBundleId,
  downloadingBundleId,
  editingBundleId,
  editValues,
  onCancelEdit,
  onEdit,
  onEditValue,
  onDelete,
  onDownload,
  onUploadLoot,
  onSaveEdit,
  onUploadChest,
  onView,
  status,
  updatingBundleId,
  uploadingBundleId,
}) {
  if (status.state === 'idle') return null;

  return (
    <section className="saved-log-section" aria-label="Saved combined loot logs">
      <header className="saved-log-header">
        <h2>Loot Logs</h2>
        <strong>{status.state === 'loading' ? 'Loading' : `${formatNumber(bundles.length)} logs`}</strong>
      </header>
      {status.message ? (
        <p className={`saved-log-message ${status.state === 'error' ? 'error' : ''}`}>{status.message}</p>
      ) : null}
      {status.state !== 'loading' && bundles.length === 0 && !status.message ? (
        <p className="saved-log-message">No combined logs found.</p>
      ) : null}
      {bundles.length > 0 ? (
        <div className="saved-log-list">
          {bundles.map((bundle) => {
            const totals = bundle.summary?.totals || {};
            const lootSubmitters = bundle.submitters?.length
              ? bundle.submitters
              : submitterNamesFromSubmissions(bundle.submissions);
            const chestSubmitters = bundle.chestSubmitters?.length
              ? bundle.chestSubmitters
              : submitterNamesFromSubmissions(bundle.chestSubmissions);
            const lootSubmittersText = formatSubmitterList(lootSubmitters);
            const chestSubmittersText = bundle.hasChestLog
              ? formatSubmitterList(chestSubmitters)
              : 'No chest log';
            const retention = getRetentionStatus(bundle.startAt);
            const isEditing = editingBundleId === bundle.id;

            return (
              <article className={`saved-log-row${isEditing ? ' editing' : ''}`} key={bundle.id}>
                <div className="saved-log-card">
                  <div className="saved-log-card-main">
                    <div className="saved-log-time">
                      {isEditing ? (
                        <div className="saved-log-edit-fields">
                          <label>
                            <span>UTC Date</span>
                            <input
                              aria-label="UTC Date"
                              max="9999-12-31"
                              type="date"
                              value={editValues.dateUtc}
                              onChange={(event) => onEditValue('dateUtc', event.target.value)}
                            />
                          </label>
                          <label>
                            <span>CTA Time</span>
                            <select
                              aria-label="CTA Time"
                              value={editValues.ctaHour}
                              onChange={(event) => onEditValue('ctaHour', Number(event.target.value))}
                            >
                              {CTA_UTC_HOURS.map((hour) => (
                                <option key={hour} value={hour}>{String(hour).padStart(2, '0')} UTC</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ) : (
                        <>
                          <strong>Uploaded</strong>
                          <small>{formatUtcDateTime(bundle.updatedAt || bundle.startAt)}</small>
                        </>
                      )}
                      {!isEditing && retention ? (
                        <small className="saved-log-countdown" title={`Scheduled deletion: ${formatUtcDate(retention.expiresAt)}`}>
                          {formatDeletionCountdown(retention.daysUntilDeletion)}
                        </small>
                      ) : null}
                    </div>
                  <div className="saved-log-users">
                    <div className="saved-log-title-line">
                      <small>Loot Log</small>
                      {!isEditing ? (
                        <FileUploadButton
                          accept=".csv,.txt,text/csv,text/plain"
                          className="saved-log-title-upload"
                          disabled={uploadingBundleId === bundle.id}
                          label="Add Loot Log"
                          loadingLabel="Uploading..."
                          multiple
                          title="Add loot log"
                          onFiles={(files) => onUploadLoot(files, bundle)}
                        />
                      ) : null}
                    </div>
                    {isEditing ? (
                      <div className="saved-log-name-editor">
                        <input
                          aria-label="Loot Log Name"
                          className="saved-log-name-input"
                          maxLength={151}
                          type="text"
                          value={editValues.lootFileName}
                          onChange={(event) => onEditValue('lootFileName', event.target.value)}
                        />
                      </div>
                    ) : (
                      <strong>{bundle.lootFileName || 'Loot Log'}</strong>
                    )}
                    {!isEditing ? (
                      <div className={bundle.hasChestLog ? 'saved-log-chest linked' : 'saved-log-chest'}>
                        <div className="saved-log-chest-status">
                          <span>{bundle.hasChestLog ? 'Chest linked' : 'No chest log'}</span>
                          <FileUploadButton
                            accept=".txt,.tsv,text/plain,text/tab-separated-values"
                            className="saved-log-title-upload"
                            disabled={uploadingBundleId === bundle.id}
                            label={bundle.hasChestLog ? 'Add Chest Log' : 'Upload Chest Log'}
                            loadingLabel="Uploading..."
                            multiple
                            title="Add chest log"
                            onFiles={(files) => onUploadChest(bundle, files)}
                          />
                        </div>
                        <small>{bundle.hasChestLog ? bundle.chestFileName : 'Awaiting chest log'}</small>
                      </div>
                    ) : null}
                  </div>
                  <div className="saved-log-submitters">
                    <div className="saved-log-uploader-block">
                      <span>Loot Log Uploaded by</span>
                      {isEditing ? (
                        <input
                          aria-label="Loot Log Uploaded By"
                          className="saved-log-name-input"
                          maxLength={80}
                          type="text"
                          value={editValues.lootSubmitter}
                          onChange={(event) => onEditValue('lootSubmitter', event.target.value)}
                        />
                      ) : (
                        <strong>{lootSubmittersText}</strong>
                      )}
                    </div>
                    <div className="saved-log-uploader-block">
                      <span>Chest Log Uploaded by</span>
                      {isEditing ? (
                        <input
                          aria-label="Chest Log Uploaded By"
                          className="saved-log-name-input"
                          disabled={!bundle.hasChestLog}
                          maxLength={80}
                          type="text"
                          value={editValues.chestSubmitter}
                          onChange={(event) => onEditValue('chestSubmitter', event.target.value)}
                        />
                      ) : (
                        <strong>{chestSubmittersText}</strong>
                      )}
                    </div>
                  </div>
                  <div className="saved-log-totals">
                    <span><strong>{formatNumber(totals.players)}</strong><small>{totals.players === 1 ? 'player' : 'players'}</small></span>
                    <span><strong>{formatNumber(totals.lootedQuantity)}</strong><small>items</small></span>
                  </div>
                    <div className={`saved-log-actions${isEditing ? ' editing' : ''}`}>
                      {isEditing ? (
                        <>
                          <button
                            className="saved-log-save-button"
                            disabled={
                              !editValues.dateUtc
                              || !editValues.lootFileName.trim()
                              || !editValues.lootSubmitter.trim()
                              || (bundle.hasChestLog && !editValues.chestSubmitter.trim())
                              || updatingBundleId === bundle.id
                            }
                            title="Save changes"
                            type="button"
                            onClick={() => onSaveEdit(bundle)}
                          >
                            {updatingBundleId === bundle.id ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            className="saved-log-cancel-button"
                            disabled={updatingBundleId === bundle.id}
                            title="Cancel edit"
                            type="button"
                            onClick={onCancelEdit}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="saved-log-edit-button" title="Edit log" type="button" onClick={() => onEdit(bundle)}>
                            <span>Edit</span>
                          </button>
                          <button
                            className="saved-log-download-button"
                            disabled={downloadingBundleId === bundle.id}
                            title="Download log"
                            type="button"
                            onClick={() => onDownload(bundle)}
                          >
                            <span>{downloadingBundleId === bundle.id ? 'Packing...' : 'Download'}</span>
                          </button>
                          <button
                            className="saved-log-delete-button"
                            disabled={deletingBundleId === bundle.id}
                            title="Delete log"
                            type="button"
                            onClick={() => onDelete(bundle)}
                          >
                            <span>{deletingBundleId === bundle.id ? 'Deleting...' : 'Delete'}</span>
                          </button>
                          <button className="saved-log-view-button" title="View log" type="button" onClick={() => onView(bundle.id)}>
                            <span>View</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export function LootLogArchive({ onView = () => {} }) {
  const [actionStatus, setActionStatus] = useState({ message: '', state: 'idle' });
  const [deletingBundleId, setDeletingBundleId] = useState('');
  const [downloadingBundleId, setDownloadingBundleId] = useState('');
  const [editingBundleId, setEditingBundleId] = useState('');
  const [editValues, setEditValues] = useState({
    chestSubmitter: '',
    ctaHour: 0,
    dateUtc: '',
    lootFileName: '',
    lootSubmitter: '',
    originalChestSubmitter: '',
    originalLootSubmitter: '',
  });
  const [savedLogBundles, setSavedLogBundles] = useState([]);
  const [savedLogStatus, setSavedLogStatus] = useState({ message: '', state: 'loading' });
  const [updatingBundleId, setUpdatingBundleId] = useState('');
  const [uploadingBundleId, setUploadingBundleId] = useState('');

  async function loadSavedLogs() {
    setSavedLogStatus({ message: '', state: 'loading' });

    try {
      const result = await fetchLootLogBundles();
      setSavedLogBundles(result.bundles || []);
      setSavedLogStatus({ message: '', state: 'loaded' });
    } catch (savedLogError) {
      setSavedLogStatus({
        message: savedLogError.message || 'Could not load combined logs.',
        state: 'error',
      });
    }
  }

  useEffect(() => {
    loadSavedLogs();
  }, []);

  async function uploadLootLogs(files, bundle = null) {
    const selectedFiles = [...(Array.isArray(files) ? files : [files])].filter(Boolean);
    if (selectedFiles.length === 0) return;
    const targetBundleId = bundle?.id || null;

    if (targetBundleId) setUploadingBundleId(targetBundleId);
    setActionStatus({
      message: selectedFiles.length === 1
        ? `Uploading ${targetBundleId ? (bundle.lootFileName || 'loot log') : 'loot log'}...`
        : `Uploading ${selectedFiles.length} loot logs...`,
      state: 'loading',
    });

    try {
      const uploadedNames = [];

      for (const file of selectedFiles) {
        const text = await file.text();
        if (detectFileKind(text) !== 'loot') throw new Error(`${file.name} is not a valid loot-events file.`);

        const result = await submitLootLog({
          bundleId: targetBundleId,
          lootLogText: text,
          originalFileName: file.name,
          username: 'manual-web-upload',
        });
        uploadedNames.push(result.summary?.displayLootFileName || result.summary?.fileNames?.loot || file.name || 'Loot Log');
      }

      setActionStatus({
        message: selectedFiles.length === 1
          ? `${uploadedNames[0]} uploaded.`
          : `${selectedFiles.length} loot logs uploaded.`,
        state: 'success',
      });
      await loadSavedLogs();
    } catch (uploadError) {
      setActionStatus({
        message: uploadError.message || 'Could not upload the loot logs.',
        state: 'error',
      });
    } finally {
      if (targetBundleId) setUploadingBundleId('');
    }
  }

  async function uploadChestLog(bundle, files) {
    const selectedFiles = [...(Array.isArray(files) ? files : [files])].filter(Boolean);
    if (selectedFiles.length === 0) return;

    setUploadingBundleId(bundle.id);
    setActionStatus({
      message: selectedFiles.length === 1
        ? `Uploading ${bundle.chestFileName || 'chest log'}...`
        : `Uploading ${selectedFiles.length} chest logs...`,
      state: 'loading',
    });

    try {
      const uploadedNames = [];

      for (const file of selectedFiles) {
        const text = await file.text();
        if (detectFileKind(text) !== 'chest') throw new Error(`${file.name} is not a valid chest log file.`);

        const result = await submitChestLog({
          bundleId: bundle.id,
          chestLogText: text,
          username: 'manual-web-upload',
        });
        uploadedNames.push(result.fileName || file.name || 'Chest Log');
      }

      setActionStatus({
        message: selectedFiles.length === 1
          ? `${uploadedNames[0]} uploaded.`
          : `${selectedFiles.length} chest logs uploaded.`,
        state: 'success',
      });
      await loadSavedLogs();
    } catch (uploadError) {
      setActionStatus({
        message: uploadError.message || 'Could not upload the chest logs.',
        state: 'error',
      });
    } finally {
      setUploadingBundleId('');
    }
  }

  async function deleteBundle(bundle) {
    const confirmed = window.confirm(
      `Delete ${bundle.lootFileName || 'this loot log'} and its linked chest log? This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingBundleId(bundle.id);
    setActionStatus({ message: `Deleting ${bundle.lootFileName || 'loot log'}...`, state: 'deleting' });

    try {
      await deleteLootLogBundle(bundle.id);
      setActionStatus({ message: `${bundle.lootFileName || 'Loot log'} deleted.`, state: 'success' });
      await loadSavedLogs();
    } catch (deleteError) {
      setActionStatus({
        message: deleteError.message || 'Could not delete the loot log.',
        state: 'error',
      });
    } finally {
      setDeletingBundleId('');
    }
  }

  function editBundle(bundle) {
    const lootSubmitters = bundle.submitters?.length
      ? bundle.submitters
      : submitterNamesFromSubmissions(bundle.submissions);
    const chestSubmitters = bundle.chestSubmitters?.length
      ? bundle.chestSubmitters
      : submitterNamesFromSubmissions(bundle.chestSubmissions);

    setEditingBundleId(bundle.id);
    setEditValues({
      chestSubmitter: bundle.hasChestLog ? formatSubmitterList(chestSubmitters) : '',
      ctaHour: Number.parseInt(bundle.ctaTimer, 10) || 0,
      dateUtc: formatUtcDateInput(bundle.startAt),
      lootFileName: stripLogSuffix(bundle.lootFileName, 'Loot Log'),
      lootSubmitter: formatSubmitterList(lootSubmitters),
      originalChestSubmitter: bundle.hasChestLog ? formatSubmitterList(chestSubmitters) : '',
      originalLootSubmitter: formatSubmitterList(lootSubmitters),
    });
  }

  function cancelEditBundle() {
    setEditingBundleId('');
    setEditValues({
      chestSubmitter: '',
      ctaHour: 0,
      dateUtc: '',
      lootFileName: '',
      lootSubmitter: '',
      originalChestSubmitter: '',
      originalLootSubmitter: '',
    });
  }

  function updateEditValue(key, value) {
    setEditValues((current) => {
      const next = { ...current, [key]: value };

      if (key === 'dateUtc' || key === 'ctaHour') {
        const generated = buildEditedFileNames(next.dateUtc, next.ctaHour);
        next.lootFileName = stripLogSuffix(generated.loot, 'Loot Log');
      }

      return next;
    });
  }

  async function saveEditedBundle(bundle) {
    setUpdatingBundleId(bundle.id);
    setActionStatus({ message: `Updating ${bundle.lootFileName || 'loot log'}...`, state: 'loading' });

    try {
      const submitterUpdates = {};
      const lootSubmitter = editValues.lootSubmitter.trim();
      const chestSubmitter = editValues.chestSubmitter.trim();
      if (lootSubmitter !== editValues.originalLootSubmitter) submitterUpdates.loot = lootSubmitter;
      if (bundle.hasChestLog && chestSubmitter !== editValues.originalChestSubmitter) {
        submitterUpdates.chest = chestSubmitter;
      }
      const editedBaseName = editValues.lootFileName.trim();
      const editedFileNames = {
        baseName: editedBaseName,
        chest: appendLogSuffix(editValues.lootFileName, 'Chest Log'),
        loot: appendLogSuffix(editValues.lootFileName, 'Loot Log'),
      };

      const result = await updateLootLogBundle({
        bundleId: bundle.id,
        ctaHour: editValues.ctaHour,
        dateUtc: editValues.dateUtc,
        fileNames: editedFileNames,
        submitters: Object.keys(submitterUpdates).length ? submitterUpdates : undefined,
      });
      setSavedLogBundles((current) => current.map((savedBundle) => {
        if (savedBundle.id !== bundle.id) return savedBundle;

        return {
          ...savedBundle,
          chestFileName: result.fileNames?.chest || editedFileNames.chest,
          chestSubmissions: submitterUpdates.chest
            ? (savedBundle.chestSubmissions || []).map((submission) => ({ ...submission, submittedBy: chestSubmitter }))
            : savedBundle.chestSubmissions,
          chestSubmitters: submitterUpdates.chest ? [chestSubmitter] : savedBundle.chestSubmitters,
          ctaTimer: result.ctaTimer || savedBundle.ctaTimer,
          endAt: result.bundle?.end_at || savedBundle.endAt,
          lootFileName: result.displayLootFileName || result.fileNames?.baseName || editedBaseName,
          startAt: result.bundle?.start_at || savedBundle.startAt,
          submissions: submitterUpdates.loot
            ? (savedBundle.submissions || []).map((submission) => ({ ...submission, submittedBy: lootSubmitter }))
            : savedBundle.submissions,
          submitters: submitterUpdates.loot ? [lootSubmitter] : savedBundle.submitters,
          summary: {
            ...(savedBundle.summary || {}),
            displayLootFileName: result.displayLootFileName || result.fileNames?.baseName || editedBaseName,
            fileNames: result.fileNames || editedFileNames,
          },
          updatedAt: result.bundle?.updated_at || new Date().toISOString(),
        };
      }));
      setActionStatus({
        message: `${result.displayLootFileName || result.fileNames?.baseName || 'Loot log'} updated.`,
        state: 'success',
      });
      cancelEditBundle();
    } catch (updateError) {
      setActionStatus({
        message: updateError.message || 'Could not update the loot log.',
        state: 'error',
      });
    } finally {
      setUpdatingBundleId('');
    }
  }

  async function downloadBundle(bundle) {
    setDownloadingBundleId(bundle.id);
    setActionStatus({ message: `Packing ${archiveFileName(bundle)}...`, state: 'downloading' });

    try {
      const result = await fetchLootLogBundle(bundle.id);
      const detail = result.bundle;
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      if (!detail.lootLogText) throw new Error('The original loot log text is unavailable.');

      zip.file(textDownloadName(`${detail.lootFileName} Loot Log`, 'Loot Log'), detail.lootLogText);
      if (detail.chestLogText) {
        zip.file(textDownloadName(`${detail.chestFileName} Chest Log`, 'Chest Log'), detail.chestLogText);
      }

      const blob = await zip.generateAsync({ compression: 'DEFLATE', type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = archiveFileName(detail);
      link.href = url;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setActionStatus({ message: `${archiveFileName(detail)} downloaded.`, state: 'success' });
    } catch (downloadError) {
      setActionStatus({
        message: downloadError.message || 'Could not download the log archive.',
        state: 'error',
      });
    } finally {
      setDownloadingBundleId('');
    }
  }

  return (
    <main className="dashboard-shell loot-monitor-shell">
      <section className="dashboard-heading loot-monitor-heading" aria-labelledby="view-logs-title">
        <div>
          <p className="eyebrow">Tool</p>
          <h1 id="view-logs-title">Loot Logs</h1>
        </div>
        <div className="loot-monitor-heading-actions">
          <FileUploadButton
            accept=".csv,.txt,text/csv,text/plain"
            className="view-logs-button"
            disabled={actionStatus.state === 'loading'}
            dropLabel="Drop Loot Log"
            enableDrop
            label="Upload"
            loadingLabel="Uploading"
            multiple
            title="Upload log"
            onFiles={uploadLootLogs}
          />
          <button
            aria-label="Refresh logs"
            className="view-logs-button view-logs-icon-button"
            disabled={savedLogStatus.state === 'loading'}
            title="Refresh logs"
            type="button"
            onClick={loadSavedLogs}
          >
            <span
              aria-hidden="true"
              className={savedLogStatus.state === 'loading' ? 'refresh-icon spinning' : 'refresh-icon'}
            >
              &#x21bb;
            </span>
          </button>
        </div>
      </section>

      <StatusToasts messages={[actionStatus]} />

      <LootLogBundleList
        bundles={savedLogBundles}
        deletingBundleId={deletingBundleId}
        downloadingBundleId={downloadingBundleId}
        editingBundleId={editingBundleId}
        editValues={editValues}
        onCancelEdit={cancelEditBundle}
        onEdit={editBundle}
        onEditValue={updateEditValue}
        onDelete={deleteBundle}
        onDownload={downloadBundle}
        onUploadLoot={uploadLootLogs}
        onSaveEdit={saveEditedBundle}
        onUploadChest={uploadChestLog}
        onView={onView}
        status={savedLogStatus}
        updatingBundleId={updatingBundleId}
        uploadingBundleId={uploadingBundleId}
      />
    </main>
  );
}

export default function LootMonitor({ bundleId = '', onViewLogs = () => {}, showShare = true }) {
  const boardRef = useRef(null);
  const [filters, setFilters] = useState(loadSavedFilters);
  const [loadStatus, setLoadStatus] = useState({ message: '', state: bundleId ? 'loading' : 'idle' });
  const [marketPrices, setMarketPrices] = useState({});
  const [marketPriceError, setMarketPriceError] = useState('');
  const [rawModalOpen, setRawModalOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState({ message: '', state: 'idle' });
  const [screenshotStatus, setScreenshotStatus] = useState({ message: '', state: 'idle' });
  const [selectedBundle, setSelectedBundle] = useState(null);

  useEffect(() => {
    let cancelled = false;

    if (!bundleId) {
      setSelectedBundle(null);
      setLoadStatus({ message: '', state: 'idle' });
      return () => {
        cancelled = true;
      };
    }

    setSelectedBundle(null);
    setLoadStatus({ message: '', state: 'loading' });
    fetchLootLogBundle(bundleId)
      .then((result) => {
        if (cancelled) return;
        setSelectedBundle(result.bundle || null);
        setLoadStatus({ message: '', state: 'loaded' });
      })
      .catch((bundleError) => {
        if (cancelled) return;
        setLoadStatus({
          message: bundleError.message || 'Could not load the selected loot log.',
          state: 'error',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [bundleId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // Filter persistence is a convenience; the tool still works without storage.
    }
  }, [filters]);

  const report = useMemo(() => {
    if (!selectedBundle) return null;
    return buildLootMonitorReportFromEvents(
      selectedBundle.events || [],
      selectedBundle.chestLogReportText || selectedBundle.chestLogText || '',
    );
  }, [selectedBundle]);

  const hasChestLog = Boolean(selectedBundle?.hasChestLog && selectedBundle?.chestLogText);
  const lootLoggers = useMemo(() => uniqueStrings(
    (selectedBundle?.submissions || []).map((submission) => submission.submittedBy),
  ), [selectedBundle?.submissions]);
  const rawLootLogText = useMemo(() => {
    const rawSubmissions = (selectedBundle?.submissions || [])
      .map((submission) => submission.rawLogText || '')
      .filter(Boolean);
    return rawSubmissions.length > 0
      ? rawSubmissions.join('\n\n--- NEXT LOOT LOG ---\n\n')
      : selectedBundle?.lootLogText || '';
  }, [selectedBundle]);
  const rawChestLogText = useMemo(() => {
    const rawSubmissions = (selectedBundle?.chestSubmissions || [])
      .map((submission) => submission.rawLogText || '')
      .filter(Boolean);
    return combineChestLogTexts(rawSubmissions.length > 0
      ? rawSubmissions
      : [selectedBundle?.chestLogText || '']);
  }, [selectedBundle]);
  const activeFilters = filters;

  const filterOptions = useMemo(() => {
    if (!report) return { alliances: [], guilds: [] };

    return {
      alliances: valuesToOptions(report.rows.flatMap(allianceValuesForRow), displayAlliance),
      guilds: valuesToOptions(report.rows.flatMap(guildValuesForRow), displayGuild),
    };
  }, [report]);

  const visibleRows = useMemo(() => (
    report ? getVisibleRows(report.rows, activeFilters) : []
  ), [activeFilters, report]);

  const visiblePlayers = useMemo(() => buildVisiblePlayerGroups(visibleRows, activeFilters), [activeFilters, visibleRows]);
  const visiblePlayersWithEmv = useMemo(() => (
    addPlayerEmv(visiblePlayers, marketPrices)
  ), [marketPrices, visiblePlayers]);
  const visibleKeptItemIds = useMemo(() => (
    [...new Set(visiblePlayers.flatMap((player) => (
      player.tiles
        .filter((tile) => tile.status === 'kept')
        .map((tile) => tile.itemId)
        .filter(Boolean)
    )))]
  ), [visiblePlayers]);
  const unfetchedKeptItemIds = useMemo(() => (
    visibleKeptItemIds.filter((itemId) => !Object.hasOwn(marketPrices, itemId))
  ), [marketPrices, visibleKeptItemIds]);
  const visibleImageUrls = useMemo(() => (
    visiblePlayers.flatMap((player) => player.tiles.map((tile) => tile.imageUrl)).filter(Boolean)
  ), [visiblePlayers]);

  useEffect(() => {
    if (unfetchedKeptItemIds.length === 0) return undefined;

    const controller = new AbortController();
    setMarketPriceError('');

    fetchWestAveragePrices(unfetchedKeptItemIds, controller.signal)
      .then((prices) => {
        setMarketPrices((current) => ({ ...current, ...prices }));
      })
      .catch((priceError) => {
        if (priceError.name === 'AbortError') return;
        setMarketPriceError('Some Albion West market prices could not be loaded.');
        setMarketPrices((current) => ({
          ...current,
          ...Object.fromEntries(unfetchedKeptItemIds.map((itemId) => [itemId, { averagePrice: null }])),
        }));
      });

    return () => controller.abort();
  }, [unfetchedKeptItemIds.join('|')]);

  useEffect(() => {
    warmItemImageCache(visibleImageUrls);
  }, [visibleImageUrls]);

  function updateFilter(key, value) {
    setFilters((current) => sanitizeFilters({ ...current, [key]: value }));
  }

  async function shareBundleLink() {
    if (!selectedBundle?.id || shareStatus.state === 'copying') return;

    const shareUrl = new URL(window.location.href);
    shareUrl.hash = `shared-log/${encodeURIComponent(selectedBundle.id)}`;
    setShareStatus({ message: 'Copying...', state: 'copying' });

    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      setShareStatus({ message: 'Link copied', state: 'copied' });
      window.setTimeout(() => {
        setShareStatus((current) => (current.state === 'copied' ? { message: '', state: 'idle' } : current));
      }, 1800);
    } catch {
      setShareStatus({ message: 'Could not copy link', state: 'error' });
    }
  }

  async function copyBoardScreenshot() {
    if (!boardRef.current || screenshotStatus.state === 'copying') return;

    setScreenshotStatus({ message: 'Copying...', state: 'copying' });

    try {
      await copyElementScreenshot(boardRef.current);
      setScreenshotStatus({ message: 'Copied', state: 'copied' });
      window.setTimeout(() => {
        setScreenshotStatus((current) => (current.state === 'copied' ? { message: '', state: 'idle' } : current));
      }, 1800);
    } catch (captureError) {
      setScreenshotStatus({
        message: formatScreenshotError(captureError),
        state: 'error',
      });
    }
  }

  return (
    <main className="dashboard-shell loot-monitor-shell">
      <section className="dashboard-heading loot-monitor-heading" aria-labelledby="loot-monitor-title">
        <div>
          <p className="eyebrow">Tool</p>
          <h1 id="loot-monitor-title">View Loot Log</h1>
        </div>
        <div className="loot-monitor-heading-actions">
          <button
            className="view-logs-button"
            disabled={!selectedBundle?.id}
            title="View raw logs"
            type="button"
            onClick={() => setRawModalOpen(true)}
          >
            View Raw
          </button>
          {showShare ? (
            <button
              className="view-logs-button"
              disabled={!selectedBundle?.id || shareStatus.state === 'copying'}
              title="Share log"
              type="button"
              onClick={shareBundleLink}
            >
              {shareStatus.state === 'copying' ? 'Copying...' : 'Share'}
            </button>
          ) : null}
        </div>
      </section>

      {selectedBundle ? (
        <section className="selected-log-summary" aria-label="Selected CTA log">
          <div className="selected-log-cta">
            <small>CTA</small>
            <strong>{formatUtcDate(selectedBundle.startAt)}</strong>
            <span>{selectedBundle.ctaTimer || '-- UTC'} CTA</span>
          </div>
          <div className="selected-log-file">
            <small>Loot Log</small>
            <strong>{selectedBundle.lootFileName || 'Loot Log'}</strong>
          </div>
          <div className="selected-log-file selected-log-loggers">
            <small>Loot Loggers</small>
            <strong>{lootLoggers.length > 0 ? lootLoggers.join(', ') : 'Unknown'}</strong>
          </div>
          <StatusLegend className="selected-log-legend" />
        </section>
      ) : null}

      {loadStatus.state === 'error' ? <p className="loot-message error">{loadStatus.message}</p> : null}
      {marketPriceError && <p className="loot-message error">{marketPriceError}</p>}
      <StatusToasts messages={[shareStatus, screenshotStatus]} />
      {rawModalOpen ? (
        <div className="raw-log-modal-backdrop" role="presentation" onMouseDown={() => setRawModalOpen(false)}>
          <section
            aria-label="Raw logs"
            aria-modal="true"
            className="raw-log-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="raw-log-modal-body">
              <section>
                <h3>Loot Log</h3>
                <pre>{rawLootLogText || 'No raw loot log data.'}</pre>
              </section>
              <section>
                <h3>Chest Log</h3>
                <pre>{rawChestLogText || 'No raw chest log data.'}</pre>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {!report ? (
        <section className="loot-empty-state">
          <h2>{loadStatus.state === 'loading' ? 'Loading Log' : 'Select a Stored Log'}</h2>
          <p>
            {loadStatus.state === 'loading'
              ? 'Loading the selected CTA from the database.'
              : 'Open View Loot Logs to choose a stored CTA.'}
          </p>
        </section>
      ) : (
        <>
          <section className="loot-controls" aria-label="Loot monitor controls">
            <MultiSelectDropdown
              allLabel="All tiers"
              getLabel={(value) => optionLabel(TIER_OPTIONS, value)}
              label="Tier"
              options={TIER_OPTIONS}
              selectedValues={filters.tierFilters}
              onChange={(value) => updateFilter('tierFilters', value)}
            />
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
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <StatusMultiSelectDropdown
              disabledOptions={hasChestLog ? {} : {
                kept: 'A chest log must be uploaded to select Kept.',
              }}
              label="Status"
              options={STATUS_OPTIONS}
              selectedValues={filters.status}
              onChange={(value) => updateFilter('status', value)}
            />
          </section>

          <div className="loot-board-toolbar">
            <button
              className="board-copy-button"
              disabled={visiblePlayers.length === 0 || screenshotStatus.state === 'copying'}
              title="Copy board"
              type="button"
              onClick={copyBoardScreenshot}
            >
              {screenshotStatus.state === 'copying' ? 'Copying...' : 'Copy Screenshot'}
            </button>
          </div>

          <section className="loot-board-section" aria-label="Player loot board" ref={boardRef}>
            <header className="loot-board-header">
              <span>Name</span>
              <span>Items</span>
              <strong>{formatNumber(visiblePlayers.length)} players</strong>
            </header>
            {visiblePlayers.length === 0 ? (
              <p className="loot-message">No item icons match the current filters.</p>
            ) : (
              <div className="loot-player-list">
                {visiblePlayersWithEmv.map((player) => (
                  <article className="loot-player-row" key={player.player}>
                    <aside className="loot-player-name">
                      <strong>
                        {player.player} <span>({formatNumber(player.totalQuantity)})</span>
                      </strong>
                      <small>
                        [{formatAllianceList(player.alliance)}] {formatGuildList(player.guild)}
                      </small>
                    </aside>
                    <div className="loot-item-grid" aria-label={`${player.player} item icons`}>
                      {player.tiles.map((tile, index) => (
                        <LootItemTile key={`${tile.status}:${tile.itemId}:${tile.item}:${index}`} tile={tile} />
                      ))}
                    </div>
                    <PlayerEmv emv={player.emv} />
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

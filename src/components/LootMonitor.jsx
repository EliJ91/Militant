import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { fetchWestAveragePrices } from '../services/albionMarket';
import { buildLootMonitorReport } from '../utils/lootMonitor';
import { warmItemImageCache } from '../utils/itemImageCache';

const FILTER_STORAGE_KEY = 'militant.lootMonitor.filters.v3';
const LEGACY_FILTER_STORAGE_KEY = 'militant.lootMonitor.filters.v2';
const GUILDLESS_VALUE = '__guildless__';
const NO_ALLIANCE_VALUE = '__no_alliance__';
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
  status: 'all',
  tierFilters: [],
  typeFilters: [],
};

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatSilver(value) {
  return `$${formatNumber(Math.round(value || 0))}`;
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
  const statusValues = new Set(STATUS_OPTIONS.map((option) => option.value));
  const sortValues = new Set(SORT_OPTIONS.map((option) => option.value));
  const migratedStatus = value.status === 'deposited' ? 'donated' : value.status;

  return {
    alliances: sanitizeStringArray(value.alliances ?? (value.alliance ? [value.alliance] : [])),
    guilds: sanitizeStringArray(value.guilds ?? (value.guild ? [value.guild] : [])),
    sortDirection: sortValues.has(value.sortDirection) ? value.sortDirection : DEFAULT_FILTERS.sortDirection,
    status: statusValues.has(migratedStatus) ? migratedStatus : DEFAULT_FILTERS.status,
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

function allowsTileStatus(tileStatus, selectedStatus) {
  if (selectedStatus === 'all') return true;
  return tileStatus === selectedStatus;
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
    if (filters.status === 'kept' && row.kept <= 0) return false;
    if (filters.status === 'lost' && row.lost <= 0) return false;
    if (filters.status === 'donated' && row.donated <= 0) return false;
    if (filters.status === 'resolved' && row.accounted <= 0) return false;
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

  return `https://render.albiononline.com/v1/item/${imagePath}`;
}

function waitForImages(element) {
  const images = [...element.querySelectorAll('img')];

  return Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();

    return new Promise((resolve) => {
      const timeout = window.setTimeout(resolve, 2000);
      image.addEventListener('load', () => {
        window.clearTimeout(timeout);
        resolve();
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
    useCORS: false,
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

function FileDropzone({ chestFileName, lootFileName, onFiles }) {
  const [isDragging, setIsDragging] = useState(false);

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    onFiles(event.dataTransfer.files);
  }

  return (
    <section
      className={isDragging ? 'loot-upload-panel drag-over' : 'loot-upload-panel'}
      aria-label="Loot monitor files"
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <div className="file-dropzone">
        <label className="file-drop-label">
          <span>Log Upload</span>
          <input
            accept=".csv,.txt,.tsv,text/csv,text/plain"
            className="file-input-hidden"
            multiple
            type="file"
            onChange={(event) => {
              onFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <strong>Choose files</strong>
        </label>
        <div className="loaded-files" aria-label="Loaded files">
          <span className="loaded-file">
            <small>Loot Events</small>
            <strong>{lootFileName || 'No loot file loaded'}</strong>
          </span>
          <span className="loaded-file">
            <small>Chest Log</small>
            <strong>{chestFileName || 'No chest log loaded'}</strong>
          </span>
        </div>
        <StatusLegend className="upload-status-legend" />
      </div>
    </section>
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

export default function LootMonitor() {
  const boardRef = useRef(null);
  const [chestFile, setChestFile] = useState({ name: '', text: '' });
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(loadSavedFilters);
  const [lootFile, setLootFile] = useState({ name: '', text: '' });
  const [marketPrices, setMarketPrices] = useState({});
  const [marketPriceError, setMarketPriceError] = useState('');
  const [screenshotStatus, setScreenshotStatus] = useState({ message: '', state: 'idle' });

  async function readSelectedFiles(fileList) {
    const files = [...(fileList || [])];
    if (files.length === 0) return;

    setError('');

    const detected = {
      chest: null,
      loot: null,
      unknown: [],
    };

    await Promise.all(files.map(async (file) => {
      try {
        const text = await file.text();
        const kind = detectFileKind(text);

        if (kind === 'loot') {
          detected.loot = { name: file.name, text };
        } else if (kind === 'chest') {
          detected.chest = { name: file.name, text };
        } else {
          detected.unknown.push(file.name);
        }
      } catch {
        detected.unknown.push(file.name);
      }
    }));

    setLootFile(detected.loot || (detected.chest && lootFile.text ? lootFile : { name: '', text: '' }));
    setChestFile(detected.chest || (detected.loot ? { name: '', text: '' } : chestFile));

    if (!detected.loot && !(detected.chest && lootFile.text)) {
      setError('Upload a loot-events file to show loot.');
    } else if (detected.unknown.length > 0) {
      setError(`Ignored unrecognized file${detected.unknown.length > 1 ? 's' : ''}: ${detected.unknown.join(', ')}.`);
    }
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // Filter persistence is a convenience; the tool still works without storage.
    }
  }, [filters]);

  const report = useMemo(() => {
    if (!lootFile.text) return null;
    return buildLootMonitorReport(lootFile.text, chestFile.text);
  }, [chestFile.text, lootFile.text]);

  const hasChestLog = Boolean(chestFile.text);
  const activeFilters = useMemo(() => (
    hasChestLog ? filters : { ...filters, status: 'all' }
  ), [filters, hasChestLog]);

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
      <section className="dashboard-heading" aria-labelledby="loot-monitor-title">
        <p className="eyebrow">Tool</p>
        <h1 id="loot-monitor-title">Loot Monitor</h1>
      </section>

      <FileDropzone
        chestFileName={chestFile.name}
        lootFileName={lootFile.name}
        onFiles={readSelectedFiles}
      />

      {error && <p className="loot-message error">{error}</p>}
      {marketPriceError && <p className="loot-message error">{marketPriceError}</p>}

      {!report ? (
        <section className="loot-empty-state">
          <h2>Awaiting Files</h2>
          <p>Load a loot-events file to inspect items.</p>
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
            <label
              className={hasChestLog ? 'status-control' : 'status-control disabled-control'}
              data-tooltip={hasChestLog ? undefined : 'There must be a chest log uploaded to sort by status.'}
              title={hasChestLog ? undefined : 'There must be a chest log uploaded to sort by status.'}
            >
              <span>Status</span>
              <select
                disabled={!hasChestLog}
                value={hasChestLog ? filters.status : 'all'}
                onChange={(event) => updateFilter('status', event.target.value)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </section>

          <div className="loot-board-toolbar">
            <button
              className="board-copy-button"
              disabled={visiblePlayers.length === 0 || screenshotStatus.state === 'copying'}
              type="button"
              onClick={copyBoardScreenshot}
            >
              {screenshotStatus.state === 'copying' ? 'Copying...' : 'Copy Screenshot'}
            </button>
            {screenshotStatus.message ? (
              <span className={`screenshot-status screenshot-${screenshotStatus.state}`}>
                {screenshotStatus.message}
              </span>
            ) : null}
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

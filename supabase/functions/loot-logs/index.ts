import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ONE_HOUR_MS = 60 * 60 * 1000;
const NEARBY_DUPLICATE_MS = 30000;
const CTA_UTC_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
const HASH_LOOKUP_BATCH_SIZE = 40;
const INSERT_BATCH_SIZE = 250;
const UPDATE_BATCH_SIZE = 25;
const DATABASE_PAGE_SIZE = 1000;
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const MILITANT_GUILD_ID = 'HNWzt1KSQMSQ855Q9rLvSA';
const ALBION_DEATHS_URL = 'https://gameinfo.albiononline.com/api/gameinfo/players';
const ALBION_EVENT_URL = 'https://gameinfo.albiononline.com/api/gameinfo/events';
const KILLBOARD_EVENT_URL = 'https://albiononline.com/killboard/kill';
const DEATH_CHECK_BATCH_SIZE = 1;
const DEATH_REQUEST_TIMEOUT_MS = 12000;
const DEATH_EVENT_REQUEST_TIMEOUT_MS = 8000;
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'DELETE, GET, PATCH, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function fetchAllBundleEvents(supabase: any, bundleId: string) {
  const events: any[] = [];

  for (let from = 0; ; from += DATABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('loot_log_events')
      .select('*')
      .eq('bundle_id', bundleId)
      .order('timestamp_utc')
      .order('id')
      .range(from, from + DATABASE_PAGE_SIZE - 1);

    if (error) throw error;
    events.push(...(data || []));
    if (!data || data.length < DATABASE_PAGE_SIZE) break;
  }

  return events;
}

async function deleteExpiredLootLogBundles(supabase: any) {
  const cutoff = new Date(Date.now() - (RETENTION_DAYS * DAY_MS)).toISOString();
  const { data, error } = await supabase
    .from('loot_log_bundles')
    .delete()
    .lt('start_at', cutoff)
    .select('id');

  if (error) throw error;

  return {
    cutoff,
    deleted: true,
    deletedBundleIds: (data || []).map((bundle: any) => bundle.id),
  };
}

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
    status,
  });
}

function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(value);
      value = '';
    } else if (char === '\n' || char === '\r') {
      row.push(value);
      value = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      if (char === '\r' && next === '\n') index += 1;
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);

  return rows;
}

function rowsToObjects(rows: string[][]) {
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim());

  return rows.slice(1).map((row) => headers.reduce<Record<string, string>>((record, header, index) => ({
    ...record,
    [header]: (row[index] || '').trim(),
  }), {}));
}

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSubmitterName(name: unknown) {
  const clean = String(name || '').trim();
  return clean === 'manual-web-upload' ? 'Manual' : clean;
}

function cleanEditedSubmitterName(name: unknown) {
  const clean = String(name || '').trim();
  if (!clean || clean.length > 80 || /[\r\n]/.test(clean)) return '';
  return clean;
}

function formatCtaTimer(hour: number) {
  return `${String(hour).padStart(2, '0')} UTC`;
}

function getCtaTimer(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  const hour = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const decimalHour = hour + (minutes / 60);
  const nearest = CTA_UTC_HOURS.reduce((best, candidate) => {
    const bestDistance = Math.min(Math.abs(decimalHour - best), 24 - Math.abs(decimalHour - best));
    const candidateDistance = Math.min(Math.abs(decimalHour - candidate), 24 - Math.abs(decimalHour - candidate));
    return candidateDistance < bestDistance ? candidate : best;
  }, CTA_UTC_HOURS[0]);

  return formatCtaTimer(nearest);
}

function buildBundleFileNames(startAt: string) {
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) {
    return { baseName: 'UNKNOWN-CTA', chest: 'UNKNOWN-CTA Chest Log', loot: 'UNKNOWN-CTA Loot Log' };
  }

  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
    .format(date)
    .toUpperCase();
  const day = String(date.getUTCDate()).padStart(2, '0');
  const cta = getCtaTimer(startAt).replace(/\s+/g, '');
  const baseName = `${cta}-${month}-${day}`;

  return {
    baseName,
    chest: `${baseName} Chest Log`,
    loot: `${baseName} Loot Log`,
  };
}

function stripLogTypeSuffixes(value: unknown) {
  let prefix = String(value || '').trim();
  let changed = true;

  while (changed) {
    changed = false;
    for (const suffix of ['Loot Log', 'Chest Log']) {
      if (prefix.toLowerCase().endsWith(suffix.toLowerCase())) {
        prefix = prefix.slice(0, -suffix.length).trim();
        changed = true;
      }
    }
  }

  return prefix;
}

function buildSharedFileNames(value: unknown, fallback: string) {
  const baseName = stripLogTypeSuffixes(value || fallback);
  return {
    baseName,
    chest: baseName ? `${baseName} Chest Log` : '',
    loot: baseName ? `${baseName} Loot Log` : '',
  };
}

function getBundleFileNames(bundle: any, startAt = bundle?.start_at) {
  const generated = buildBundleFileNames(startAt);
  const stored = bundle?.combined_loot_summary?.fileNames || {};

  return buildSharedFileNames(
    stored.loot || stored.chest || stored.baseName,
    generated.baseName,
  );
}

function cleanDisplayLogName(value: unknown) {
  const fileName = String(value || '').trim().split(/\\/).pop() || '';
  return stripLogTypeSuffixes(
    fileName.replace(/[\r\n]/g, '').replace(/\.(?:csv|log|tsv|txt)$/i, ''),
  ).slice(0, 151);
}

function getBundleDisplayLootFileName(bundle: any, originalFileName?: unknown, startAt = bundle?.start_at) {
  const summary = bundle?.combined_loot_summary || {};
  return cleanDisplayLogName(summary.discordThreadName)
    || cleanDisplayLogName(summary.displayLootFileName)
    || cleanDisplayLogName(summary.fileNames?.loot)
    || cleanDisplayLogName(originalFileName)
    || getBundleFileNames(bundle, startAt).baseName;
}

function getBundleDisplayChestFileName(bundle: any, startAt = bundle?.start_at) {
  return getBundleDisplayLootFileName(bundle, '', startAt);
}

function getEditedFileNames(fileNames: any, startAt: string) {
  const generated = buildBundleFileNames(startAt);
  const edited = buildSharedFileNames(
    fileNames?.baseName || fileNames?.loot || fileNames?.chest,
    generated.baseName,
  );

  if (!edited.chest || !edited.loot) throw new Error('Loot and chest log names are required.');
  if (edited.chest.length > 160 || edited.loot.length > 160 || /[\r\n]/.test(`${edited.chest}${edited.loot}`)) {
    throw new Error('Log names must be a single line and no longer than 160 characters.');
  }

  return edited;
}

function buildEditedBundleRange(bundle: any, dateUtc: unknown, ctaHour: unknown) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateUtc || ''))) {
    throw new Error('A valid UTC date is required.');
  }

  const hour = Number(ctaHour);
  if (!CTA_UTC_HOURS.includes(hour)) throw new Error('A valid CTA hour is required.');

  const currentStart = new Date(bundle.start_at);
  const currentEnd = new Date(bundle.end_at);
  if (Number.isNaN(currentStart.getTime()) || Number.isNaN(currentEnd.getTime())) {
    throw new Error('The current bundle date range is invalid.');
  }

  const currentCtaHour = Number.parseInt(getCtaTimer(bundle.start_at), 10);
  const baseAnchor = Date.UTC(
    currentStart.getUTCFullYear(),
    currentStart.getUTCMonth(),
    currentStart.getUTCDate(),
    currentCtaHour,
  );
  const candidateAnchors = [baseAnchor - DAY_MS, baseAnchor, baseAnchor + DAY_MS];
  const currentAnchor = candidateAnchors.reduce((nearest, candidate) => (
    Math.abs(currentStart.getTime() - candidate) < Math.abs(currentStart.getTime() - nearest)
      ? candidate
      : nearest
  ));
  const offsetFromCta = currentStart.getTime() - currentAnchor;
  const [year, month, day] = String(dateUtc).split('-').map(Number);
  const newAnchor = Date.UTC(year, month - 1, day, hour);
  const duration = Math.max(0, currentEnd.getTime() - currentStart.getTime());
  const startAt = new Date(newAnchor + offsetFromCta).toISOString();

  return {
    endAt: new Date(newAnchor + offsetFromCta + duration).toISOString(),
    startAt,
  };
}

function parseInteger(value: unknown) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractEnchantment(itemId: string) {
  const match = String(itemId || '').match(/@(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function cleanTimestamp(value: unknown) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function eventIdentityKey(event: LootEvent) {
  return [
    event.eventType,
    normalize(event.player),
    normalize(event.itemId),
    normalize(event.item),
    String(event.enchantment || 0),
    cleanTimestamp(event.timestamp),
    normalize(event.alliance),
    normalize(event.guild),
    normalize(event.lostTo),
  ].join('|');
}

function duplicateEventTimestampMs(event: LootEvent) {
  const time = new Date(event.timestamp).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

function duplicateItemIdentity(event: LootEvent) {
  return normalize(event.itemId) || [normalize(event.item), String(event.enchantment || 0)].join('|');
}

function sourceActorKey(event: LootEvent, actor: unknown) {
  return [
    duplicateItemIdentity(event),
    String(Number(event.quantity) || 0),
    normalize(actor),
  ].join('|');
}

function withInferredSources(events: LootEvent[]) {
  const sourcesByActor = new Map<string, Array<{ player: string; time: number }>>();

  (events || [])
    .filter((event) => event.eventType === 'lost')
    .forEach((event) => {
      const key = sourceActorKey(event, event.lostTo);
      const candidates = sourcesByActor.get(key) || [];
      candidates.push({ player: event.player, time: duplicateEventTimestampMs(event) });
      sourcesByActor.set(key, candidates);
    });

  return (events || []).map((event) => {
    if (event.sourcePlayer || event.eventType === 'lost') {
      return { ...event, sourcePlayer: event.sourcePlayer || event.player };
    }

    const time = duplicateEventTimestampMs(event);
    const nearest = (sourcesByActor.get(sourceActorKey(event, event.player)) || [])
      .filter((candidate) => Math.abs(candidate.time - time) <= NEARBY_DUPLICATE_MS)
      .sort((left, right) => Math.abs(left.time - time) - Math.abs(right.time - time))[0];
    return { ...event, sourcePlayer: nearest?.player || '' };
  });
}

function nearbyDuplicateKey(event: LootEvent) {
  return [
    event.eventType,
    normalize(event.player),
    normalize(event.guild),
    normalize(event.itemId),
    normalize(event.item),
    String(event.enchantment || 0),
    event.eventType === 'lost' ? normalize(event.lostTo) : '',
  ].join('|');
}

function sourceConflictKey(event: LootEvent) {
  return [
    event.eventType,
    normalize(event.sourcePlayer),
    duplicateItemIdentity(event),
    String(Number(event.quantity) || 0),
  ].join('|');
}

function resolveSourceConflicts(events: LootEvent[]) {
  const groups = new Map<string, Array<{ event: LootEvent; index: number; time: number }>>();
  const resolved: LootEvent[] = [];

  events.forEach((event, index) => {
    if (!normalize(event.sourcePlayer)) {
      resolved.push(event);
      return;
    }
    const key = sourceConflictKey(event);
    const group = groups.get(key) || [];
    group.push({ event, index, time: duplicateEventTimestampMs(event) });
    groups.set(key, group);
  });

  groups.forEach((group) => {
    const clusters: Array<{ entries: Array<{ event: LootEvent; index: number; time: number }>; lastTime: number }> = [];
    group
      .sort((left, right) => left.time - right.time || left.index - right.index)
      .forEach((entry) => {
        const cluster = clusters.find((current) => (
          Number.isFinite(current.lastTime) && entry.time - current.lastTime <= NEARBY_DUPLICATE_MS
        ));
        if (cluster) {
          cluster.entries.push(entry);
          cluster.lastTime = Math.max(cluster.lastTime, entry.time);
        } else {
          clusters.push({ entries: [entry], lastTime: entry.time });
        }
      });

    clusters.forEach((cluster) => {
      const actors = new Set(cluster.entries.map(({ event }) => normalize(
        event.eventType === 'lost' ? event.lostTo : event.player,
      )).filter(Boolean));
      if (actors.size > 1) {
        resolved.push((cluster.entries.at(-1) || cluster.entries[0]).event);
      } else {
        resolved.push(...cluster.entries.map(({ event }) => event));
      }
    });
  });

  return resolved;
}

function bestDuplicateValue(entries: Array<{ event: LootEvent }>, field: keyof LootEvent) {
  return String(entries.map(({ event }) => event[field]).find((value) => String(value || '').trim()) || '');
}

function duplicateQuantity(entries: Array<{ event: LootEvent }>) {
  const quantities = entries
    .map(({ event }) => Number(event.quantity) || 0)
    .filter((quantity) => quantity > 0);
  if (!quantities.length) return 0;

  const counts = new Map<number, number>();
  quantities.forEach((quantity) => counts.set(quantity, (counts.get(quantity) || 0) + 1));

  return quantities.reduce((best, quantity) => {
    const quantityCount = counts.get(quantity) || 0;
    const bestCount = counts.get(best) || 0;
    return quantityCount > bestCount || (quantityCount === bestCount && quantity < best)
      ? quantity
      : best;
  }, quantities[0]);
}

function dedupeNearbyEvents(events: LootEvent[]) {
  const groups = new Map<string, Array<{ event: LootEvent; index: number; time: number }>>();

  withInferredSources(events).forEach((event, index) => {
    const key = nearbyDuplicateKey(event);
    const group = groups.get(key) || [];
    group.push({ event, index, time: duplicateEventTimestampMs(event) });
    groups.set(key, group);
  });

  const deduped: LootEvent[] = [];
  groups.forEach((group) => {
    const clusters: Array<{ entries: Array<{ event: LootEvent; index: number; time: number }>; lastTime: number }> = [];
    group
      .sort((left, right) => (
        (Number.isNaN(left.time) ? Number.POSITIVE_INFINITY : left.time)
        - (Number.isNaN(right.time) ? Number.POSITIVE_INFINITY : right.time)
        || left.index - right.index
      ))
      .forEach((entry) => {
        if (Number.isNaN(entry.time)) {
          clusters.push({ entries: [entry], lastTime: Number.NaN });
          return;
        }

        const cluster = clusters.find((current) => (
          Number.isFinite(current.lastTime) && entry.time - current.lastTime <= NEARBY_DUPLICATE_MS
        ));
        if (cluster) {
          cluster.entries.push(entry);
          cluster.lastTime = Math.max(cluster.lastTime, entry.time);
        } else {
          clusters.push({ entries: [entry], lastTime: entry.time });
        }
      });

    clusters.forEach((cluster) => {
      const first = cluster.entries[0];
      const latest = cluster.entries.at(-1) || first;
      const usesSourceIdentity = cluster.entries.some(({ event }) => normalize(event.sourcePlayer));
      const winner = usesSourceIdentity ? latest : first;
      deduped.push({
        ...winner.event,
        alliance: winner.event.alliance || bestDuplicateValue(cluster.entries, 'alliance'),
        guild: winner.event.guild || bestDuplicateValue(cluster.entries, 'guild'),
        lostTo: winner.event.lostTo || bestDuplicateValue(cluster.entries, 'lostTo'),
        quantity: usesSourceIdentity ? winner.event.quantity : duplicateQuantity(cluster.entries),
      });
    });
  });

  return resolveSourceConflicts(deduped).sort((left, right) => (
    (Number.isNaN(duplicateEventTimestampMs(left)) ? Number.POSITIVE_INFINITY : duplicateEventTimestampMs(left))
    - (Number.isNaN(duplicateEventTimestampMs(right)) ? Number.POSITIVE_INFINITY : duplicateEventTimestampMs(right))
    || nearbyDuplicateKey(left).localeCompare(nearbyDuplicateKey(right))
  ));
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

type LootEvent = {
  alliance: string;
  dedupeKey: string;
  enchantment: number;
  eventHash?: string;
  eventType: 'looted' | 'lost';
  guild: string;
  item: string;
  itemId: string;
  lostTo: string;
  player: string;
  quantity: number;
  sourcePlayer?: string;
  timestamp: string;
};

function parseLootEvents(text: string) {
  const records = rowsToObjects(parseDelimited(text, ';'));
  const skippedRows: number[] = [];
  const rows: LootEvent[] = [];

  records.forEach((record, index) => {
    const player = record.looted_by__name;
    const item = record.item_name;
    const quantity = parseInteger(record.quantity);

    if (!player || !item || quantity === null) {
      skippedRows.push(index + 2);
      return;
    }

    const baseRow = {
      alliance: record.looted_by__alliance || '',
      enchantment: extractEnchantment(record.item_id || ''),
      guild: record.looted_by__guild || '',
      item,
      itemId: record.item_id || '',
      player,
      quantity,
      timestamp: cleanTimestamp(record.timestamp_utc),
    };

    rows.push({
      ...baseRow,
      dedupeKey: '',
      eventType: 'looted',
      lostTo: '',
    });

    const lostBy = record.looted_from__name;
    if (lostBy && !lostBy.startsWith('@')) {
      rows.push({
        ...baseRow,
        alliance: record.looted_from__alliance || '',
        dedupeKey: '',
        eventType: 'lost',
        guild: record.looted_from__guild || '',
        lostTo: player,
        player: lostBy,
      });
    }
  });

  return {
    events: dedupeNearbyEvents(rows).map((event) => {
      const dedupeKey = eventIdentityKey(event);
      return { ...event, dedupeKey };
    }),
    skippedRows,
  };
}

function chestTimestampMs(value: unknown) {
  const text = String(value || '').trim();
  const localMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (localMatch) {
    const [, month, day, year, hour, minute, second = '0'] = localMatch;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  }
  return new Date(text).getTime();
}

function escapeChestCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function isChestHeader(cells: string[]) {
  const normalized = cells.map((cell) => cell.trim());
  return normalized[0] === 'Date' && normalized.includes('Player') && normalized.includes('Amount');
}

function filterChestLogTextByWindow(
  text: string,
  timeWindow: { endAt?: string; startAt?: string },
) {
  const source = String(text || '');
  const rangeStart = chestTimestampMs(timeWindow.startAt);
  const rangeEnd = chestTimestampMs(timeWindow.endAt);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) return source;

  const sections: Array<{ header: string[]; rows: string[][] }> = [];
  let activeSection: { header: string[]; rows: string[][] } | null = null;

  parseDelimited(source, '\t').forEach((cells) => {
    if (isChestHeader(cells)) {
      activeSection = {
        header: cells.map((cell) => cell.replace(/^\uFEFF/, '').trim()),
        rows: [],
      };
      sections.push(activeSection);
      return;
    }

    if (!activeSection || !cells.some((cell) => cell.trim())) return;
    const dateIndex = activeSection.header.findIndex((cell) => cell === 'Date');
    const eventTime = chestTimestampMs(cells[dateIndex] || '');
    if (Number.isFinite(eventTime) && eventTime >= rangeStart && eventTime <= rangeEnd + (2 * ONE_HOUR_MS)) {
      activeSection.rows.push(cells);
    }
  });

  return sections
    .filter((section) => section.rows.length > 0)
    .flatMap((section) => [section.header, ...section.rows])
    .map((row) => row.map(escapeChestCell).join('\t'))
    .join('\n');
}

function parseChestLog(text: string, timeWindow: { endAt?: string; startAt?: string } = {}) {
  const records = rowsToObjects(parseDelimited(text, '\t'));
  const rows: Array<Record<string, unknown>> = [];
  const withdrawals: Array<Record<string, unknown>> = [];
  const skippedRows: number[] = [];
  const rangeStart = chestTimestampMs(timeWindow.startAt);
  const rangeEnd = chestTimestampMs(timeWindow.endAt);
  const hasTimeWindow = Number.isFinite(rangeStart) && Number.isFinite(rangeEnd);

  records.forEach((record, index) => {
    const player = record.Player;
    const item = record.Item;
    const amount = parseInteger(record.Amount);
    const enchantment = parseInteger(record.Enchantment) ?? 0;
    const quality = parseInteger(record.Quality) ?? 0;

    if (record.Date === 'Date' || player === 'Player') return;
    if (!player || !item || amount === null) {
      skippedRows.push(index + 2);
      return;
    }

    const eventTime = chestTimestampMs(record.Date);
    if (hasTimeWindow && (!Number.isFinite(eventTime) || eventTime < rangeStart || eventTime > rangeEnd + (2 * ONE_HOUR_MS))) {
      return;
    }

    const row = {
      amount,
      date: record.Date || '',
      enchantment,
      item,
      player,
      quality,
    };

    if (amount < 0) withdrawals.push(row);
    if (amount > 0) rows.push(row);
  });

  return { rows, skippedRows, withdrawals };
}

function getLootLogTimeRange(events: LootEvent[]) {
  const timestamps = dedupeNearbyEvents(events)
    .map((event) => new Date(event.timestamp).getTime())
    .filter((time) => Number.isFinite(time));

  if (timestamps.length === 0) return null;

  return {
    endAt: new Date(Math.max(...timestamps)).toISOString(),
    matchEndAt: new Date(Math.max(...timestamps) + ONE_HOUR_MS).toISOString(),
    matchStartAt: new Date(Math.min(...timestamps) - ONE_HOUR_MS).toISOString(),
    startAt: new Date(Math.min(...timestamps)).toISOString(),
  };
}

function unique(values: unknown[]) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function aggregateLootLogEvents(events: LootEvent[]) {
  const byKey = new Map<string, any>();

  dedupeNearbyEvents(events).forEach((event) => {
    const key = [
      normalize(event.player),
      normalize(event.itemId),
      normalize(event.item),
      String(event.enchantment || 0),
    ].join('|');
    const current = byKey.get(key) || {
      alliance: [],
      enchantment: event.enchantment || 0,
      guild: [],
      item: event.item,
      itemId: event.itemId,
      lost: 0,
      lostTo: [],
      looted: 0,
      player: event.player,
      timestamps: [],
    };

    if (event.eventType === 'lost') {
      current.lost += event.quantity || 0;
      if (event.lostTo) current.lostTo.push(event.lostTo);
    } else {
      current.looted += event.quantity || 0;
    }

    current.alliance.push(event.alliance);
    current.guild.push(event.guild);
    current.timestamps.push(event.timestamp);
    byKey.set(key, current);
  });

  const rows = [...byKey.values()].map((row) => ({
    ...row,
    alliance: unique(row.alliance).join(', '),
    guild: unique(row.guild).join(', '),
    kept: Math.max(row.looted - row.lost, 0),
    lostTo: unique(row.lostTo).join(', '),
    timestamps: unique(row.timestamps).sort(),
  }));

  return {
    rows,
    totals: {
      eventRows: events.length,
      keptQuantity: rows.reduce((sum, row) => sum + row.kept, 0),
      lostQuantity: rows.reduce((sum, row) => sum + row.lost, 0),
      lootedQuantity: rows.reduce((sum, row) => sum + row.looted, 0),
      players: new Set(rows.map((row) => normalize(row.player))).size,
    },
  };
}

function dbEventToMergeEvent(event: any): LootEvent {
  return {
    alliance: event.alliance,
    dedupeKey: event.dedupe_key,
    enchantment: event.enchantment,
    eventType: event.event_type,
    guild: event.guild,
    item: event.item_name,
    itemId: event.item_id,
    lostTo: event.lost_to,
    player: event.player_name,
    quantity: event.quantity,
    timestamp: event.timestamp_utc,
  };
}

function normalizeDeathCheckRanges(ranges: any, fallbackBundle: any = null) {
  const sourceRanges = Array.isArray(ranges) && ranges.length > 0
    ? ranges
    : fallbackBundle
      ? [{ endAt: fallbackBundle.end_at, startAt: fallbackBundle.start_at }]
      : [];
  const validRanges = sourceRanges
    .map((range: any) => {
      const start = new Date(range?.startAt || range?.start_at || '').getTime();
      const end = new Date(range?.endAt || range?.end_at || '').getTime();
      return Number.isFinite(start) && Number.isFinite(end) && start <= end ? { end, start } : null;
    })
    .filter(Boolean)
    .sort((left: any, right: any) => left.start - right.start);

  return validRanges.reduce((merged: any[], range: any) => {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      return merged;
    }
    merged.push({ ...range });
    return merged;
  }, []).map((range: any) => ({
    endAt: new Date(range.end).toISOString(),
    startAt: new Date(range.start).toISOString(),
  }));
}

function normalizeDeathKey(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeKeptItems(items: unknown) {
  const quantities = new Map<string, { itemId: string; lootDateKey: string; lootTimestamps: Set<string>; quantity: number }>();

  function addItem(itemId: string, quantity: number, lootDateKey = '', lootTimestamps: string[] = []) {
    if (!itemId || quantity <= 0) return;
    const key = `${itemId}::${lootDateKey}`;
    const current = quantities.get(key) || {
      itemId,
      lootDateKey,
      lootTimestamps: new Set<string>(),
      quantity: 0,
    };
    current.quantity += quantity;
    lootTimestamps.forEach((timestamp) => {
      const value = String(timestamp || '').trim();
      if (value) current.lootTimestamps.add(value);
    });
    quantities.set(key, current);
  }

  (Array.isArray(items) ? items : []).forEach((item: any) => {
    const itemId = String(item?.itemId || '').trim().toUpperCase();
    const quantity = Math.max(0, Math.trunc(Number(item?.quantity) || 0));
    if (!itemId || quantity <= 0) return;
    const lootTimestamps = (Array.isArray(item?.lootTimestamps) ? item.lootTimestamps : [])
      .map((timestamp: unknown) => String(timestamp || '').trim())
      .filter(Boolean);
    const dateQuantities = item?.lootDateQuantities && typeof item.lootDateQuantities === 'object'
      ? Object.entries(item.lootDateQuantities)
      : [];

    if (dateQuantities.length > 0) {
      dateQuantities.forEach(([dateKey, dateQuantity]) => {
        const cleanDateKey = timestampDateKey(dateKey);
        const cleanQuantity = Math.max(0, Math.trunc(Number(dateQuantity) || 0));
        const matchingTimestamps = lootTimestamps.filter((timestamp) => timestampDateKey(timestamp) === cleanDateKey);
        addItem(itemId, cleanQuantity, cleanDateKey, matchingTimestamps);
      });
      return;
    }

    addItem(itemId, quantity, '', lootTimestamps);
  });

  return [...quantities.values()].map((item) => ({
    itemId: item.itemId,
    lootDateKey: item.lootDateKey,
    lootTimestamps: [...item.lootTimestamps],
    quantity: item.quantity,
  }));
}

function deathTimestamp(death: any) {
  const timestamp = new Date(death?.TimeStamp || death?.timestamp || '');
  return Number.isNaN(timestamp.getTime()) ? '' : timestamp.toISOString();
}

function deathEventUrl(eventId: unknown) {
  const cleanEventId = String(eventId || '').trim();
  return cleanEventId ? `${KILLBOARD_EVENT_URL}/${encodeURIComponent(cleanEventId)}?server=live_us` : '';
}

async function fetchDeathEvent(eventId: string) {
  const requestOptions: RequestInit = {};
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    requestOptions.signal = AbortSignal.timeout(DEATH_REQUEST_TIMEOUT_MS);
  }

  const response = await fetch(`${ALBION_EVENT_URL}/${encodeURIComponent(eventId)}`, requestOptions);
  if (!response.ok) throw new Error('The death ID could not be found.');
  return response.json();
}

async function deathEventExists(eventId: unknown) {
  const url = deathEventUrl(eventId);
  if (!url) return false;

  const requestOptions: RequestInit = {};
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    requestOptions.signal = AbortSignal.timeout(DEATH_EVENT_REQUEST_TIMEOUT_MS);
  }

  try {
    const response = await fetch(url, requestOptions);
    return response.ok;
  } catch (error) {
    console.warn('[loot death check] death event verification failed', {
      eventId: String(eventId || '').trim(),
      message: error instanceof Error ? error.message : String(error),
      url,
    });
    return false;
  }
}

function deathMatchesBundle(death: any, bundle: any) {
  const timestamp = new Date(deathTimestamp(death)).getTime();
  const deathCheckRanges = normalizeDeathCheckRanges(
    bundle?.combined_loot_summary?.deathCheckRanges,
    bundle,
  );
  if (deathCheckRanges.length > 0) {
    return Number.isFinite(timestamp) && deathCheckRanges.some((range: any) => (
      timestamp >= new Date(range.startAt).getTime()
      && timestamp <= new Date(range.endAt).getTime()
    ));
  }
  const startAt = new Date(bundle.start_at).getTime();
  const endAt = new Date(bundle.end_at).getTime();
  return Number.isFinite(timestamp)
    && Number.isFinite(startAt)
    && Number.isFinite(endAt)
    && timestamp >= startAt
    && timestamp <= endAt;
}

function timestampDateKey(value: unknown) {
  const rawValue = String(value || '').trim();
  const isoDate = rawValue.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  const timestamp = new Date(rawValue);
  return Number.isNaN(timestamp.getTime()) ? '' : timestamp.toISOString().slice(0, 10);
}

function matchDeathInventory(death: any, keptItems: Array<{ itemId: string; lootDateKey?: string; lootTimestamps?: string[]; quantity: number }>) {
  const inventory = Array.isArray(death?.Victim?.Inventory) ? death.Victim.Inventory : [];
  const inventoryQuantities = new Map<string, number>();
  const keptQuantities = new Map<string, number>();

  inventory.forEach((item: any) => {
    const itemId = String(item?.Type || '').trim().toUpperCase();
    const quantity = Math.max(0, Math.trunc(Number(item?.Count) || 0));
    if (!itemId || quantity <= 0) return;
    inventoryQuantities.set(itemId, (inventoryQuantities.get(itemId) || 0) + quantity);
  });

  keptItems.forEach(({ itemId, quantity }) => {
    const cleanItemId = String(itemId || '').trim().toUpperCase();
    const cleanQuantity = Math.max(0, Math.trunc(Number(quantity) || 0));
    if (!cleanItemId || cleanQuantity <= 0) return;
    keptQuantities.set(cleanItemId, (keptQuantities.get(cleanItemId) || 0) + cleanQuantity);
  });

  return [...keptQuantities.entries()].flatMap(([itemId, quantity]) => {
    const matchedQuantity = Math.min(quantity, inventoryQuantities.get(itemId) || 0);
    return matchedQuantity > 0 ? [{ itemId, quantity: matchedQuantity }] : [];
  });
}

function pickMatchingDeath(
  deaths: any[],
  bundle: any,
  playerId: string,
  keptItems: Array<{ itemId: string; lootDateKey?: string; lootTimestamps?: string[]; quantity: number }>,
) {
  let bestMatch: { death: any; eventId: string; matchedItems: Array<{ itemId: string; quantity: number }> } | null = null;
  let bestScore = -1;
  let bestTimestamp = -1;

  (Array.isArray(deaths) ? deaths : []).forEach((death: any) => {
    if (!deathMatchesBundle(death, bundle)) return;
    if (String(death?.Victim?.Id || '').trim() !== playerId) return;

    const eventId = String(death?.EventId || '').trim();
    if (!eventId) return;

    const matchedItems = matchDeathInventory(death, keptItems);
    const score = matchedItems.reduce((total, item) => total + item.quantity, 0);
    const timestamp = new Date(deathTimestamp(death)).getTime();
    if (score <= 0 || !Number.isFinite(timestamp)) return;

    if (score > bestScore || (score === bestScore && timestamp > bestTimestamp)) {
      bestMatch = { death, eventId, matchedItems };
      bestScore = score;
      bestTimestamp = timestamp;
    }
  });

  return bestMatch;
}

async function fetchPlayerDeaths(playerId: string) {
  const deathApiUrl = `${ALBION_DEATHS_URL}/${encodeURIComponent(playerId)}/deaths`;
  const requestOptions: RequestInit = {};
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    requestOptions.signal = AbortSignal.timeout(DEATH_REQUEST_TIMEOUT_MS);
  }

  const response = await fetch(deathApiUrl, requestOptions);
  if (!response.ok) {
    throw new Error(`Could not load the player death log. ${response.status} ${response.statusText} ${deathApiUrl}`);
  }

  const deaths = await response.json();
  return Array.isArray(deaths) ? deaths : [];
}

function normalizeDeathCheckRequests(checks: unknown) {
  const requestsByPlayer = new Map<string, { keptItems: ReturnType<typeof normalizeKeptItems>; player: string; playerKey: string }>();

  (Array.isArray(checks) ? checks : []).forEach((check: any) => {
    const player = String(check?.player || '').trim();
    const playerKey = normalizeDeathKey(player);
    const keptItems = normalizeKeptItems(check?.keptItems);
    if (!player) throw new Error('player is required.');
    if (keptItems.length === 0) throw new Error('No kept items are available to check.');

    const current = requestsByPlayer.get(playerKey);
    requestsByPlayer.set(playerKey, {
      keptItems: normalizeKeptItems([...(current?.keptItems || []), ...keptItems]),
      player: current?.player || player,
      playerKey,
    });
  });

  const requests = [...requestsByPlayer.values()];
  if (requests.length === 0) throw new Error('At least one player is required.');
  if (requests.length > DEATH_CHECK_BATCH_SIZE) {
    throw new Error(`A maximum of ${DEATH_CHECK_BATCH_SIZE} players can be checked at once.`);
  }
  return requests;
}

async function loadDeathCheckContext(supabase: any, bundleId: string, playerKeys: string[]) {
  const [bundleResult, membersResult, startResult, endResult] = await Promise.all([
    supabase
      .from('loot_log_bundles')
      .select('id,start_at,end_at,combined_loot_summary')
      .eq('id', bundleId)
      .single(),
    supabase
      .from('guild_members')
      .select('player_id,player_key,player_name')
      .eq('guild_id', MILITANT_GUILD_ID)
      .in('player_key', playerKeys),
    supabase
      .from('loot_log_events')
      .select('timestamp_utc')
      .eq('bundle_id', bundleId)
      .order('timestamp_utc', { ascending: true })
      .order('id', { ascending: true })
      .limit(1),
    supabase
      .from('loot_log_events')
      .select('timestamp_utc')
      .eq('bundle_id', bundleId)
      .order('timestamp_utc', { ascending: false })
      .order('id', { ascending: false })
      .limit(1),
  ]);

  if (bundleResult.error) throw bundleResult.error;
  if (membersResult.error) throw membersResult.error;
  if (startResult.error) throw startResult.error;
  if (endResult.error) throw endResult.error;

  const bundle = bundleResult.data;
  const exactStartAt = startResult.data?.[0]?.timestamp_utc || bundle.start_at;
  const exactEndAt = endResult.data?.[0]?.timestamp_utc || bundle.end_at;
  const startTime = new Date(exactStartAt).getTime();
  const endTime = new Date(exactEndAt).getTime();
  const hasValidRange = Number.isFinite(startTime) && Number.isFinite(endTime) && startTime <= endTime;
  const effectiveBundle = hasValidRange
    ? { ...bundle, end_at: exactEndAt, start_at: exactStartAt }
    : bundle;

  return {
    bundle,
    effectiveBundle,
    membersByPlayer: new Map((membersResult.data || []).map((member: any) => [member.player_key, member])),
    rangeNeedsUpdate: hasValidRange && (bundle.start_at !== exactStartAt || bundle.end_at !== exactEndAt),
  };
}

function mapDeathCheck(row: any) {
  return {
    checkedAt: row.checked_at,
    deathAt: row.death_at || '',
    deathUrl: row.death_url || deathEventUrl(row.event_id),
    eventId: row.event_id || '',
    matchedItems: Array.isArray(row.matched_items) ? row.matched_items : [],
    player: row.player_name,
    playerId: row.player_id || '',
    playerName: row.player_name,
    status: row.status,
  };
}

async function clearLootLogDeathChecks(supabase: any, bundleId: string) {
  const { error } = await supabase
    .from('loot_log_death_checks')
    .delete()
    .eq('bundle_id', bundleId);

  if (error) throw error;
}

async function mergeLootLogBundles(supabase: any, body: any) {
  const sourceIds = [...new Set((Array.isArray(body.bundleIds) ? body.bundleIds : [])
    .map((bundleId: unknown) => String(bundleId || '').trim())
    .filter(Boolean))] as string[];
  if (sourceIds.length < 2) throw new Error('Select at least two loot logs to merge.');
  if (sourceIds.length > 20) throw new Error('A maximum of 20 loot logs can be merged at once.');

  const { data: unorderedBundles, error: bundlesError } = await supabase
    .from('loot_log_bundles')
    .select('id,start_at,end_at,combined_loot_summary')
    .in('id', sourceIds);
  if (bundlesError) throw bundlesError;
  if ((unorderedBundles || []).length !== sourceIds.length) throw new Error('One or more selected loot logs could not be found.');

  const byId = new Map((unorderedBundles || []).map((bundle: any) => [bundle.id, bundle]));
  const sourceBundles = sourceIds.map((bundleId) => byId.get(bundleId));
  const startAt = new Date(Math.min(...sourceBundles.map((bundle: any) => new Date(bundle.start_at).getTime()))).toISOString();
  const endAt = new Date(Math.max(...sourceBundles.map((bundle: any) => new Date(bundle.end_at).getTime()))).toISOString();
  const mergedAt = new Date().toISOString();
  const mergedBy = String(body.username || '').trim() || 'manual-web-upload';
  const deathCheckRanges = normalizeDeathCheckRanges(sourceBundles.flatMap((bundle: any) => (
    bundle.combined_loot_summary?.deathCheckRanges || [{ endAt: bundle.end_at, startAt: bundle.start_at }]
  )));
  const firstTitle = getBundleDisplayLootFileName(sourceBundles[0]);
  const displayLootFileName = cleanDisplayLogName(`Merged - ${firstTitle}`) || 'Merged Loot Logs';
  const fileNames = buildSharedFileNames(displayLootFileName, buildBundleFileNames(startAt).baseName);
  const mergeMetadata = {
    deathCheckRanges,
    displayLootFileName,
    fileNames,
    isMerged: true,
    mergedAt,
    mergedBy: normalizeSubmitterName(mergedBy),
    mergedFromBundleIds: sourceIds,
  };

  const { data: targetBundle, error: targetError } = await supabase
    .from('loot_log_bundles')
    .insert({ combined_loot_summary: mergeMetadata, end_at: endAt, start_at: startAt })
    .select('id,start_at,end_at,combined_loot_summary')
    .single();
  if (targetError) throw targetError;

  try {
    const copiedEventsByHash = new Map<string, any>();
    const chestRows: any[] = [];

    for (const sourceBundle of sourceBundles) {
      const [submissionsResult, chestResult, sourceEvents] = await Promise.all([
        supabase.from('loot_log_submissions')
          .select('id,submitted_by,event_start_at,event_end_at,raw_log_text,skipped_rows')
          .eq('bundle_id', sourceBundle.id)
          .order('created_at'),
        supabase.from('chest_log_submissions')
          .select('submitted_by,raw_log_text,parsed_chest_summary')
          .eq('bundle_id', sourceBundle.id)
          .order('created_at'),
        fetchAllBundleEvents(supabase, sourceBundle.id),
      ]);
      if (submissionsResult.error) throw submissionsResult.error;
      if (chestResult.error) throw chestResult.error;

      const submissionIds = new Map<string, string>();
      for (const submission of submissionsResult.data || []) {
        const { data: copiedSubmission, error: submissionError } = await supabase
          .from('loot_log_submissions')
          .insert({
            bundle_id: targetBundle.id,
            event_end_at: submission.event_end_at,
            event_start_at: submission.event_start_at,
            raw_log_text: submission.raw_log_text,
            skipped_rows: submission.skipped_rows || [],
            submitted_by: submission.submitted_by,
          })
          .select('id')
          .single();
        if (submissionError) throw submissionError;
        submissionIds.set(submission.id, copiedSubmission.id);
      }

      const fallbackSubmissionId = submissionIds.values().next().value;
      sourceEvents.forEach((event: any) => {
        const current = copiedEventsByHash.get(event.event_hash);
        if (current && Number(current.quantity) >= Number(event.quantity)) return;
        copiedEventsByHash.set(event.event_hash, {
          alliance: event.alliance,
          bundle_id: targetBundle.id,
          dedupe_key: event.dedupe_key,
          emv_each: event.emv_each,
          emv_priced_at: event.emv_priced_at,
          emv_source_city: event.emv_source_city,
          emv_total: event.emv_total,
          enchantment: event.enchantment,
          event_hash: event.event_hash,
          event_type: event.event_type,
          guild: event.guild,
          item_id: event.item_id,
          item_name: event.item_name,
          lost_to: event.lost_to,
          player_name: event.player_name,
          quantity: event.quantity,
          submission_id: submissionIds.get(event.submission_id) || fallbackSubmissionId,
          timestamp_utc: event.timestamp_utc,
        });
      });

      (chestResult.data || []).forEach((submission: any) => chestRows.push({
        bundle_id: targetBundle.id,
        parsed_chest_summary: submission.parsed_chest_summary || {},
        raw_log_text: submission.raw_log_text,
        submitted_by: submission.submitted_by,
      }));
    }

    const copiedEvents = [...copiedEventsByHash.values()].filter((event) => event.submission_id);
    for (const eventBatch of chunkArray(copiedEvents, INSERT_BATCH_SIZE)) {
      const { error } = await supabase.from('loot_log_events').insert(eventBatch);
      if (error) throw error;
    }
    for (const chestBatch of chunkArray(chestRows, INSERT_BATCH_SIZE)) {
      const { error } = await supabase.from('chest_log_submissions').insert(chestBatch);
      if (error) throw error;
    }

    const summary = {
      ...aggregateLootLogEvents(copiedEvents.map(dbEventToMergeEvent)),
      ...mergeMetadata,
    };
    const { error: summaryError } = await supabase
      .from('loot_log_bundles')
      .update({ combined_loot_summary: summary, updated_at: mergedAt })
      .eq('id', targetBundle.id);
    if (summaryError) throw summaryError;

    return {
      bundleId: targetBundle.id,
      lootFileName: displayLootFileName,
      merged: true,
      sourceBundleIds: sourceIds,
      summary,
    };
  } catch (error) {
    await supabase.from('loot_log_bundles').delete().eq('id', targetBundle.id);
    throw error;
  }
}

async function runLootLogDeathChecks(supabase: any, { bundleId, checks }: any) {
  const cleanBundleId = String(bundleId || '').trim();
  if (!cleanBundleId) throw new Error('bundleId is required.');

  const requests = normalizeDeathCheckRequests(checks);
  const context = await loadDeathCheckContext(
    supabase,
    cleanBundleId,
    requests.map((request) => request.playerKey),
  );
  const rangeUpdatePromise = context.rangeNeedsUpdate
    ? (async () => {
      const { error } = await supabase
        .from('loot_log_bundles')
        .update({
          end_at: context.effectiveBundle.end_at,
          start_at: context.effectiveBundle.start_at,
          updated_at: new Date().toISOString(),
        })
        .eq('id', cleanBundleId);
      if (error) throw error;
    })()
    : null;

  const checkedAt = new Date().toISOString();
  const records: any[] = [];
  const errors: Array<{ message: string; player: string; playerKey: string }> = [];

  for (const request of requests) {
    try {
      const member = context.membersByPlayer.get(request.playerKey);
      const playerId = String(member?.player_id || '').trim();
      const deaths = playerId ? await fetchPlayerDeaths(playerId) : [];
      const possibleMatch = playerId
        ? pickMatchingDeath(deaths, context.effectiveBundle, playerId, request.keptItems)
        : null;
      const match = possibleMatch && await deathEventExists(possibleMatch.eventId)
        ? possibleMatch
        : null;
      records.push({
        bundle_id: cleanBundleId,
        checked_at: checkedAt,
        death_at: match ? deathTimestamp(match.death) : null,
        death_url: match ? deathEventUrl(match.eventId) : '',
        event_id: match?.eventId || '',
        matched_items: match?.matchedItems || [],
        player_id: playerId,
        player_key: request.playerKey,
        player_name: member?.player_name || request.player,
        status: match ? 'found' : 'not_found',
        updated_at: checkedAt,
      });
    } catch (error) {
      errors.push({
        message: error instanceof Error ? error.message : 'Could not load the player death log.',
        player: request.player,
        playerKey: request.playerKey,
      });
    }
  }

  let savedChecks: any[] = [];
  if (records.length > 0) {
    const playerKeys = records.map((record) => record.player_key);
    const { error: deleteError } = await supabase
      .from('loot_log_death_checks')
      .delete()
      .eq('bundle_id', cleanBundleId)
      .in('player_key', playerKeys);
    if (deleteError) throw deleteError;

    const { data, error } = await supabase
      .from('loot_log_death_checks')
      .insert(records)
      .select('player_key,player_name,player_id,status,event_id,death_url,death_at,matched_items,checked_at');
    if (error) {
      console.error('[loot death check] save failed', {
        bundleId: cleanBundleId,
        error,
        records: records.map((record) => ({
          event_id: record.event_id,
          player_id: record.player_id,
          player_key: record.player_key,
          player_name: record.player_name,
          status: record.status,
        })),
      });
      throw error;
    }
    savedChecks = data || [];
  }

  if (rangeUpdatePromise) await rangeUpdatePromise;

  return {
    deathChecks: savedChecks.map(mapDeathCheck),
    errors,
  };
}

async function checkLootLogDeath(supabase: any, body: any) {
  const result = await runLootLogDeathChecks(supabase, {
    bundleId: body.bundleId,
    checks: [{ keptItems: body.keptItems, player: body.player }],
  });
  if (result.errors.length > 0) throw new Error(result.errors[0].message);
  if (!result.deathChecks[0]) throw new Error('Could not save the player death check.');
  return { deathCheck: result.deathChecks[0] };
}

async function checkLootLogDeaths(supabase: any, body: any) {
  return runLootLogDeathChecks(supabase, {
    bundleId: body.bundleId,
    checks: body.checks,
  });
}

async function addLootLogDeathId(supabase: any, body: any) {
  const bundleId = String(body.bundleId || '').trim();
  const deathId = String(body.deathId || '').trim();
  if (!bundleId) throw new Error('bundleId is required.');
  if (!/^\d+$/.test(deathId)) throw new Error('Enter a valid numeric death ID.');

  const requests = normalizeDeathCheckRequests(body.checks);
  const death = await fetchDeathEvent(deathId);
  const victimName = String(death?.Victim?.Name || '').trim();
  const victimKey = normalizeDeathKey(victimName);
  const request = requests.find((entry) => entry.playerKey === victimKey);
  if (!victimName || !request) {
    throw new Error('The death victim does not match a player with kept items in this loot log.');
  }

  const matchedItems = matchDeathInventory(death, request.keptItems);
  if (matchedItems.length === 0) {
    throw new Error('None of the victim inventory matches this player\'s kept items.');
  }

  const checkedAt = new Date().toISOString();
  const record = {
    bundle_id: bundleId,
    checked_at: checkedAt,
    death_at: deathTimestamp(death) || null,
    death_url: deathEventUrl(deathId),
    event_id: deathId,
    matched_items: matchedItems,
    player_id: String(death?.Victim?.Id || '').trim(),
    player_key: victimKey,
    player_name: victimName,
    status: 'found',
    updated_at: checkedAt,
  };
  const { data: existing, error: existingError } = await supabase
    .from('loot_log_death_checks')
    .select('id')
    .eq('bundle_id', bundleId)
    .eq('event_id', deathId)
    .maybeSingle();
  if (existingError) throw existingError;

  const saveQuery = existing?.id
    ? supabase.from('loot_log_death_checks').update(record).eq('id', existing.id)
    : supabase.from('loot_log_death_checks').insert(record);
  const { data, error } = await saveQuery
    .select('player_key,player_name,player_id,status,event_id,death_url,death_at,matched_items,checked_at')
    .single();
  if (error) throw error;
  return { deathCheck: mapDeathCheck(data) };
}

async function clearLootLogDeath(supabase: any, body: any) {
  const bundleId = String(body.bundleId || '').trim();
  const playerName = String(body.player || '').trim();
  const playerKey = normalizeDeathKey(playerName);
  if (!bundleId) throw new Error('bundleId is required.');
  if (!playerKey) throw new Error('player is required.');

  const { error } = await supabase
    .from('loot_log_death_checks')
    .delete()
    .eq('bundle_id', bundleId)
    .eq('player_key', playerKey);

  if (error) throw error;
  return { playerKey, removed: true };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  if (request.method !== 'DELETE' && request.method !== 'GET' && request.method !== 'PATCH' && request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    if (request.method === 'PATCH') {
      const body = await request.json();
      const bundleId = String(body.bundleId || '').trim();
      if (!bundleId) throw new Error('bundleId is required.');

      if (body.action === 'set-player-hidden') {
        const player = String(body.player || '').trim();
        const playerKey = player.toLowerCase();
        if (!playerKey) throw new Error('player is required.');

        const { data: bundle, error: bundleError } = await supabase
          .from('loot_log_bundles')
          .select('combined_loot_summary')
          .eq('id', bundleId)
          .single();

        if (bundleError) throw bundleError;

        const hiddenPlayers = new Set((Array.isArray(bundle.combined_loot_summary?.hiddenPlayers)
          ? bundle.combined_loot_summary.hiddenPlayers
          : [])
          .map((name: unknown) => String(name || '').trim().toLowerCase())
          .filter(Boolean));
        if (body.hidden) hiddenPlayers.add(playerKey);
        else hiddenPlayers.delete(playerKey);

        const nextHiddenPlayers = [...hiddenPlayers].sort();
        const { error: updateError } = await supabase
          .from('loot_log_bundles')
          .update({
            combined_loot_summary: {
              ...(bundle.combined_loot_summary || {}),
              hiddenPlayers: nextHiddenPlayers,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', bundleId);

        if (updateError) throw updateError;
        return jsonResponse(200, {
          bundleId,
          hidden: Boolean(body.hidden),
          hiddenPlayers: nextHiddenPlayers,
          player,
        });
      }

      const { data: bundle, error: bundleError } = await supabase
        .from('loot_log_bundles')
        .select('id,start_at,end_at,combined_loot_summary')
        .eq('id', bundleId)
        .single();

      if (bundleError) throw bundleError;

      const range = buildEditedBundleRange(bundle, body.dateUtc, body.ctaHour);
      const fileNames = getEditedFileNames(body.fileNames, range.startAt);
      const lootSubmitter = cleanEditedSubmitterName(body.submitters?.loot);
      const chestSubmitter = cleanEditedSubmitterName(body.submitters?.chest);
      const displaySubmitters = {
        ...(bundle.combined_loot_summary?.displaySubmitters || {}),
        ...(lootSubmitter ? { loot: lootSubmitter } : {}),
        ...(chestSubmitter ? { chest: chestSubmitter } : {}),
      };
      const combinedSummary = {
        ...(bundle.combined_loot_summary || {}),
        displayLootFileName: fileNames.baseName,
        displaySubmitters,
        fileNames,
      };
      const { data: updatedBundle, error: updateError } = await supabase
        .from('loot_log_bundles')
        .update({
          combined_loot_summary: combinedSummary,
          end_at: range.endAt,
          start_at: range.startAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bundleId)
        .select('id,start_at,end_at,combined_loot_summary,updated_at')
        .single();

      if (updateError) throw updateError;

      const { data: chestLogs, error: chestError } = await supabase
        .from('chest_log_submissions')
        .select('id,parsed_chest_summary')
        .eq('bundle_id', bundleId);

      if (chestError) throw chestError;
      await Promise.all((chestLogs || []).map(async (chestLog: any) => {
        const { error } = await supabase
          .from('chest_log_submissions')
          .update({
            parsed_chest_summary: {
              ...(chestLog.parsed_chest_summary || {}),
              fileName: fileNames.chest,
            },
          })
          .eq('id', chestLog.id);

          if (error) throw error;
        }));

      if (lootSubmitter) {
        const { error } = await supabase
          .from('loot_log_submissions')
          .update({ submitted_by: lootSubmitter })
          .eq('bundle_id', bundleId);

        if (error) throw error;
      }

      if (chestSubmitter) {
        const { error } = await supabase
          .from('chest_log_submissions')
          .update({ submitted_by: chestSubmitter })
          .eq('bundle_id', bundleId);

        if (error) throw error;
      }

      await clearLootLogDeathChecks(supabase, bundleId);

      return jsonResponse(200, {
        bundle: updatedBundle,
        bundleId,
        ctaTimer: getCtaTimer(range.startAt),
        displayLootFileName: fileNames.baseName,
        fileNames,
      });
    }

    if (request.method === 'DELETE') {
      const body = await request.json();
      if (body.deleteExpired) {
        return jsonResponse(200, await deleteExpiredLootLogBundles(supabase));
      }

      const bundleId = String(body.bundleId || '').trim();
      if (!bundleId) throw new Error('bundleId is required.');

      if (body.deleteChestLogs) {
        const { data: bundle, error: bundleError } = await supabase
          .from('loot_log_bundles')
          .select('id,combined_loot_summary')
          .eq('id', bundleId)
          .single();

        if (bundleError) throw bundleError;

        const { data: deletedLogs, error: deleteError } = await supabase
          .from('chest_log_submissions')
          .delete()
          .eq('bundle_id', bundleId)
          .select('id');

        if (deleteError) throw deleteError;

        const displaySubmitters = { ...(bundle.combined_loot_summary?.displaySubmitters || {}) };
        delete displaySubmitters.chest;
        const { error: updateError } = await supabase
          .from('loot_log_bundles')
          .update({
            combined_loot_summary: {
              ...(bundle.combined_loot_summary || {}),
              displaySubmitters,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', bundleId);

        if (updateError) throw updateError;
        await clearLootLogDeathChecks(supabase, bundleId);

        return jsonResponse(200, {
          bundleId,
          deleted: true,
          deletedChestLogs: (deletedLogs || []).length,
        });
      }

      const { data, error } = await supabase
        .from('loot_log_bundles')
        .delete()
        .eq('id', bundleId)
        .select('id')
        .single();

      if (error) throw error;
      return jsonResponse(200, { bundleId: data.id, deleted: true });
    }

    if (request.method === 'GET') {
      const bundleId = new URL(request.url).searchParams.get('bundleId');

      if (bundleId) {
        const { data: bundle, error: bundleError } = await supabase
          .from('loot_log_bundles')
          .select('id,start_at,end_at,combined_loot_summary,created_at,updated_at')
          .eq('id', bundleId)
          .single();

        if (bundleError) throw bundleError;

        const [eventsResult, submissionsResult, chestResult, deathChecksResult] = await Promise.all([
          fetchAllBundleEvents(supabase, bundleId),
          supabase.from('loot_log_submissions')
            .select('id,submitted_by,raw_log_text,created_at')
            .eq('bundle_id', bundleId)
            .order('created_at'),
          supabase.from('chest_log_submissions')
            .select('id,submitted_by,raw_log_text,parsed_chest_summary,created_at')
            .eq('bundle_id', bundleId)
            .order('created_at', { ascending: true }),
          supabase.from('loot_log_death_checks')
            .select('player_name,player_id,status,event_id,death_url,death_at,matched_items,checked_at')
            .eq('bundle_id', bundleId)
            .order('checked_at'),
        ]);

        if (submissionsResult.error) throw submissionsResult.error;
        if (chestResult.error) throw chestResult.error;
        if (deathChecksResult.error) throw deathChecksResult.error;

        const summary = {
          ...aggregateLootLogEvents(eventsResult.map(dbEventToMergeEvent)),
          hiddenPlayers: Array.isArray(bundle.combined_loot_summary?.hiddenPlayers)
            ? bundle.combined_loot_summary.hiddenPlayers
            : [],
        };
        const chestLogs = (chestResult.data || []).map((log: any) => ({
          ...log,
          raw_log_text: filterChestLogTextByWindow(log.raw_log_text, {
            endAt: bundle.end_at,
            startAt: bundle.start_at,
          }),
        }));
        const chestLog = chestLogs[chestLogs.length - 1] || null;
        const rawLootLogTexts = (submissionsResult.data || [])
          .map((submission: any) => submission.raw_log_text || '')
          .filter(Boolean);
        const displaySubmitters = bundle.combined_loot_summary?.displaySubmitters || {};
        const submitters = displaySubmitters.loot
          ? [displaySubmitters.loot]
          : [...new Set((submissionsResult.data || [])
            .map((submission: any) => normalizeSubmitterName(submission.submitted_by))
            .filter(Boolean))];
        const chestSubmitters = displaySubmitters.chest
          ? [displaySubmitters.chest]
          : [...new Set(chestLogs.map((submission: any) => normalizeSubmitterName(submission.submitted_by)).filter(Boolean))];
        const fileNames = getBundleFileNames(bundle);

        return jsonResponse(200, {
          bundle: {
            chestFileName: getBundleDisplayChestFileName(bundle),
            chestLogText: chestLogs.map((log: any) => log.raw_log_text || '').filter(Boolean).join('\n'),
            ctaTimer: getCtaTimer(bundle.start_at),
            createdAt: bundle.created_at,
            deathChecks: (deathChecksResult.data || []).map(mapDeathCheck),
            endAt: bundle.end_at,
            events: eventsResult.map(dbEventToMergeEvent),
            hasChestLog: chestLogs.length > 0,
            id: bundle.id,
            lootFileName: getBundleDisplayLootFileName(bundle),
            lootLogText: rawLootLogTexts.join('\n'),
            startAt: bundle.start_at,
            submissions: (submissionsResult.data || []).map((submission: any) => ({
              createdAt: submission.created_at,
              id: submission.id,
              rawLogText: submission.raw_log_text || '',
              submittedBy: normalizeSubmitterName(submission.submitted_by),
            })),
            submitters,
            chestSubmissions: chestLogs.map((submission: any) => ({
              createdAt: submission.created_at,
              id: submission.id,
              rawLogText: submission.raw_log_text || '',
              submittedBy: normalizeSubmitterName(submission.submitted_by),
            })),
            chestSubmitters,
            summary,
            updatedAt: bundle.updated_at,
          },
        });
      }

      await deleteExpiredLootLogBundles(supabase);

      const { data, error } = await supabase
        .from('loot_log_bundles')
        .select(`
          id,
          start_at,
          end_at,
          combined_loot_summary,
          created_at,
          updated_at,
          loot_log_submissions (
            id,
            submitted_by,
            created_at
          ),
          chest_log_submissions (
            id,
            submitted_by,
            created_at
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const bundles = data || [];
      return jsonResponse(200, {
        bundles: bundles.map((bundle: any, index: number) => {
          const submissions = Array.isArray(bundle.loot_log_submissions) ? bundle.loot_log_submissions : [];
          const chestLogs = Array.isArray(bundle.chest_log_submissions) ? bundle.chest_log_submissions : [];
          const displaySubmitters = bundle.combined_loot_summary?.displaySubmitters || {};
          const submitters = displaySubmitters.loot
            ? [displaySubmitters.loot]
            : [...new Set(submissions.map((submission: any) => normalizeSubmitterName(submission.submitted_by)).filter(Boolean))];
          const chestSubmitters = displaySubmitters.chest
            ? [displaySubmitters.chest]
            : [...new Set(chestLogs.map((submission: any) => normalizeSubmitterName(submission.submitted_by)).filter(Boolean))];
          const fileNames = getBundleFileNames(bundle);

          return {
            chestLogCount: chestLogs.length,
            chestFileName: getBundleDisplayChestFileName(bundle),
            ctaTimer: getCtaTimer(bundle.start_at),
            createdAt: bundle.created_at,
            endAt: bundle.end_at,
            hasChestLog: chestLogs.length > 0,
            id: bundle.id,
            logNumber: bundles.length - index,
            lootFileName: getBundleDisplayLootFileName(bundle),
            startAt: bundle.start_at,
            submissions: submissions.map((submission: any) => ({
              createdAt: submission.created_at,
              id: submission.id,
              submittedBy: normalizeSubmitterName(submission.submitted_by),
            })),
            chestSubmissions: chestLogs.map((submission: any) => ({
              createdAt: submission.created_at,
              id: submission.id,
              submittedBy: normalizeSubmitterName(submission.submitted_by),
            })),
            chestSubmitters,
            submitters,
            summary: bundle.combined_loot_summary,
            updatedAt: bundle.updated_at,
          };
        }),
        ctaTimers: CTA_UTC_HOURS.map(formatCtaTimer),
      });
    }

    const body = await request.json();
    const submittedBy = String(body.username || '').trim() || 'manual-web-upload';

    if (body.action === 'merge') {
      return jsonResponse(200, await mergeLootLogBundles(supabase, body));
    }
    if (body.action === 'death-check') {
      return jsonResponse(200, await checkLootLogDeath(supabase, body));
    }
    if (body.action === 'death-check-batch') {
      return jsonResponse(200, await checkLootLogDeaths(supabase, body));
    }
    if (body.action === 'add-death-id') {
      return jsonResponse(200, await addLootLogDeathId(supabase, body));
    }
    if (body.action === 'clear-death-check') {
      return jsonResponse(200, await clearLootLogDeath(supabase, body));
    }

    if (body.action === 'chest') {
      const bundleId = String(body.bundleId || '').trim();
      const chestLogText = body.chestLogText || body.chestText || body.text;

      if (!bundleId) throw new Error('bundleId is required.');
      if (!chestLogText || typeof chestLogText !== 'string') throw new Error('chestLogText is required.');

      const { data: chestBundle, error: chestBundleError } = await supabase
        .from('loot_log_bundles')
        .select('id,start_at,end_at,combined_loot_summary')
        .eq('id', bundleId)
        .single();

      if (chestBundleError) throw chestBundleError;

      const filteredChestLogText = filterChestLogTextByWindow(chestLogText, {
        endAt: chestBundle.end_at,
        startAt: chestBundle.start_at,
      });
      const parsedChest = parseChestLog(filteredChestLogText);
      if (parsedChest.rows.length === 0 && parsedChest.withdrawals.length === 0) {
        throw new Error('The chest log does not contain any item rows within the loot log time window.');
      }

      const fileNames = getBundleFileNames(chestBundle);
      const parsedSummary = {
        fileName: fileNames.chest,
        skippedRows: parsedChest.skippedRows,
        totals: {
          depositedQuantity: parsedChest.rows.reduce((sum, row: any) => sum + Number(row.amount || 0), 0),
          depositRows: parsedChest.rows.length,
          withdrawalRows: parsedChest.withdrawals.length,
        },
      };

      const { data: chestSubmission, error: chestSubmissionError } = await supabase
        .from('chest_log_submissions')
        .insert({
          bundle_id: bundleId,
          parsed_chest_summary: parsedSummary,
          raw_log_text: filteredChestLogText,
          submitted_by: submittedBy,
        })
        .select('id,created_at')
        .single();

      if (chestSubmissionError) throw chestSubmissionError;

      const { error: chestUpdateError } = await supabase
        .from('loot_log_bundles')
        .update({
          combined_loot_summary: {
            ...(chestBundle.combined_loot_summary || {}),
            fileNames,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', bundleId);

      if (chestUpdateError) throw chestUpdateError;
      await clearLootLogDeathChecks(supabase, bundleId);

      return jsonResponse(200, {
        bundleId,
        fileName: fileNames.chest,
        submissionId: chestSubmission.id,
        summary: parsedSummary,
      });
    }

    const lootLogText = body.lootLogText || body.lootText || body.text;
    const requestedBundleId = String(body.bundleId || '').trim();
    const originalFileName = body.originalFileName
      || body.original_filename
      || body.lootFileName
      || body.logFileName
      || body.fileName
      || body.filename
      || body.file_name
      || request.headers.get('x-file-name')
      || request.headers.get('x-filename');

    if (!lootLogText || typeof lootLogText !== 'string') {
      throw new Error('lootLogText is required.');
    }
    const parsed = parseLootEvents(lootLogText);
    const events = await Promise.all(parsed.events.map(async (event) => ({
      ...event,
      eventHash: await sha256Hex(event.dedupeKey),
    })));
    const range = getLootLogTimeRange(events);

    if (!range) {
      throw new Error('The loot log does not contain any valid timestamp_utc values.');
    }

    let matchedExistingBundle = Boolean(requestedBundleId);
    let bundle;

    if (requestedBundleId) {
      const { data, error } = await supabase
        .from('loot_log_bundles')
        .select('id,start_at,end_at,combined_loot_summary')
        .eq('id', requestedBundleId)
        .single();

      if (error) throw error;
      bundle = data;
    } else {
      const { data: matchingBundles, error: matchError } = await supabase
        .from('loot_log_bundles')
        .select('id,start_at,end_at,combined_loot_summary')
        .lte('start_at', range.matchEndAt)
        .gte('end_at', range.matchStartAt);

      if (matchError) throw matchError;
      matchedExistingBundle = Boolean(matchingBundles?.length);
      bundle = matchingBundles?.[0];
    }

    if (!bundle) {
      const { data, error } = await supabase
        .from('loot_log_bundles')
        .insert({ end_at: range.endAt, start_at: range.startAt })
        .select('id,start_at,end_at,combined_loot_summary')
        .single();

      if (error) throw error;
      bundle = data;
      matchedExistingBundle = false;
    }

    const { data: submission, error: submissionError } = await supabase
      .from('loot_log_submissions')
      .insert({
        bundle_id: bundle.id,
        event_end_at: range.endAt,
        event_start_at: range.startAt,
        raw_log_text: lootLogText,
        skipped_rows: parsed.skippedRows,
        submitted_by: submittedBy,
      })
      .select('id')
      .single();

    if (submissionError) throw submissionError;

    const eventsByHash = new Map<string, any>();
    events.forEach((event) => {
      const current = eventsByHash.get(event.eventHash);
      if (!current || event.quantity > current.quantity) eventsByHash.set(event.eventHash, event);
    });
    const collapsedEvents = [...eventsByHash.values()];
    const existingEventBatches = await Promise.all(
      chunkArray(collapsedEvents.map((event) => event.eventHash), HASH_LOOKUP_BATCH_SIZE)
        .map(async (hashBatch) => {
          const { data, error } = await supabase
            .from('loot_log_events')
            .select('id,event_hash,quantity')
            .eq('bundle_id', bundle.id)
            .in('event_hash', hashBatch);

          if (error) throw error;
          return data || [];
        }),
    );
    const existingEvents = existingEventBatches.flat();
    const existingByHash = new Map(existingEvents.map((event: any) => [event.event_hash, event]));
    const insertRows: any[] = [];
    const updateRows: any[] = [];
    let duplicateEvents = 0;

    for (const event of collapsedEvents) {
      const existing = existingByHash.get(event.eventHash);
      const row = {
        alliance: event.alliance,
        bundle_id: bundle.id,
        dedupe_key: event.dedupeKey,
        enchantment: event.enchantment,
        event_hash: event.eventHash,
        event_type: event.eventType,
        guild: event.guild,
        item_id: event.itemId,
        item_name: event.item,
        lost_to: event.lostTo,
        player_name: event.player,
        quantity: event.quantity,
        submission_id: submission.id,
        timestamp_utc: event.timestamp,
      };

      if (!existing) {
        insertRows.push(row);
      } else if (event.quantity > existing.quantity) {
        updateRows.push({ id: existing.id, ...row });
      } else {
        duplicateEvents += 1;
      }
    }

    for (const insertBatch of chunkArray(insertRows, INSERT_BATCH_SIZE)) {
      const { error } = await supabase.from('loot_log_events').insert(insertBatch);
      if (error) throw error;
    }

    for (const updateBatch of chunkArray(updateRows, UPDATE_BATCH_SIZE)) {
      await Promise.all(updateBatch.map(async (row) => {
        const { id, ...updates } = row;
        const { error } = await supabase.from('loot_log_events').update(updates).eq('id', id);
        if (error) throw error;
      }));
    }

    const insertedEvents = insertRows.length;
    const updatedEvents = updateRows.length;

    const savedEvents = await fetchAllBundleEvents(supabase, bundle.id);

    const mergeEvents = (savedEvents || []).map(dbEventToMergeEvent);
    const summary = aggregateLootLogEvents(mergeEvents);
    const refreshedRange = getLootLogTimeRange(mergeEvents);
    const summaryWithFileNames = {
      ...summary,
      hiddenPlayers: Array.isArray(bundle.combined_loot_summary?.hiddenPlayers)
        ? bundle.combined_loot_summary.hiddenPlayers
        : [],
      ...(bundle.combined_loot_summary?.isMerged ? {
        deathCheckRanges: bundle.combined_loot_summary.deathCheckRanges,
        isMerged: true,
        mergedAt: bundle.combined_loot_summary.mergedAt,
        mergedBy: bundle.combined_loot_summary.mergedBy,
        mergedFromBundleIds: bundle.combined_loot_summary.mergedFromBundleIds,
      } : {}),
      displayLootFileName: getBundleDisplayLootFileName(
        bundle,
        originalFileName,
        refreshedRange?.startAt || bundle.start_at,
      ),
      fileNames: getBundleFileNames(bundle, refreshedRange?.startAt || bundle.start_at),
    };
    const { data: refreshedBundle, error: updateError } = await supabase
      .from('loot_log_bundles')
      .update({
        combined_loot_summary: summaryWithFileNames,
        end_at: refreshedRange?.endAt,
        start_at: refreshedRange?.startAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bundle.id)
      .select('id,start_at,end_at,combined_loot_summary')
      .single();

    if (updateError) throw updateError;
    await clearLootLogDeathChecks(supabase, bundle.id);

    return jsonResponse(200, {
      bundle: refreshedBundle,
      bundleId: bundle.id,
      duplicateEvents,
      eventCount: mergeEvents.length,
      insertedEvents,
      matchedExistingBundle,
      skippedRows: parsed.skippedRows,
      submissionId: submission.id,
      summary: summaryWithFileNames,
      updatedEvents,
    });
  } catch (error) {
    return jsonResponse(400, { error: error?.message || 'Could not submit loot log.' });
  }
});

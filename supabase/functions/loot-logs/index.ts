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
  const fileName = String(value || '').trim().split(/[\\/]/).pop() || '';
  return stripLogTypeSuffixes(
    fileName.replace(/[\r\n]/g, '').replace(/\.(?:csv|log|tsv|txt)$/i, ''),
  ).slice(0, 151);
}

function getBundleDisplayLootFileName(bundle: any, originalFileName?: unknown, startAt = bundle?.start_at) {
  const summary = bundle?.combined_loot_summary || {};
  return cleanDisplayLogName(summary.displayLootFileName)
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

function nearbyDuplicateKey(event: LootEvent) {
  return [
    event.eventType,
    normalize(event.player),
    normalize(event.guild),
    normalize(event.itemId),
    normalize(event.item),
    String(event.enchantment || 0),
  ].join('|');
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

  (events || []).forEach((event, index) => {
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
      deduped.push({
        ...first.event,
        alliance: bestDuplicateValue(cluster.entries, 'alliance'),
        guild: bestDuplicateValue(cluster.entries, 'guild'),
        lostTo: bestDuplicateValue(cluster.entries, 'lostTo'),
        quantity: duplicateQuantity(cluster.entries),
      });
    });
  });

  return deduped.sort((left, right) => (
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

function parseChestLog(text: string) {
  const records = rowsToObjects(parseDelimited(text, '\t'));
  const rows: Array<Record<string, unknown>> = [];
  const withdrawals: Array<Record<string, unknown>> = [];
  const skippedRows: number[] = [];

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
          .select('id,start_at,end_at,combined_loot_summary,updated_at')
          .eq('id', bundleId)
          .single();

        if (bundleError) throw bundleError;

        const [eventsResult, submissionsResult, chestResult] = await Promise.all([
          fetchAllBundleEvents(supabase, bundleId),
          supabase.from('loot_log_submissions')
            .select('id,submitted_by,raw_log_text,created_at')
            .eq('bundle_id', bundleId)
            .order('created_at'),
          supabase.from('chest_log_submissions')
            .select('id,submitted_by,raw_log_text,parsed_chest_summary,created_at')
            .eq('bundle_id', bundleId)
            .order('created_at', { ascending: true }),
        ]);

        if (submissionsResult.error) throw submissionsResult.error;
        if (chestResult.error) throw chestResult.error;

        const summary = aggregateLootLogEvents(eventsResult.map(dbEventToMergeEvent));
        const chestLogs = chestResult.data || [];
        const chestLog = chestLogs[chestLogs.length - 1] || null;
        const primaryLootLog = submissionsResult.data?.[0] || null;
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
            endAt: bundle.end_at,
            events: eventsResult.map(dbEventToMergeEvent),
            hasChestLog: chestLogs.length > 0,
            id: bundle.id,
            lootFileName: getBundleDisplayLootFileName(bundle),
            lootLogText: primaryLootLog?.raw_log_text || '',
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
        .order('start_at', { ascending: false });

      if (error) throw error;

      return jsonResponse(200, {
        bundles: (data || []).map((bundle: any) => {
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
            endAt: bundle.end_at,
            hasChestLog: chestLogs.length > 0,
            id: bundle.id,
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

    if (body.action === 'chest') {
      const bundleId = String(body.bundleId || '').trim();
      const chestLogText = body.chestLogText || body.chestText || body.text;

      if (!bundleId) throw new Error('bundleId is required.');
      if (!chestLogText || typeof chestLogText !== 'string') throw new Error('chestLogText is required.');

      const parsedChest = parseChestLog(chestLogText);
      if (parsedChest.rows.length === 0 && parsedChest.withdrawals.length === 0) {
        throw new Error('The chest log does not contain any valid item rows.');
      }

      const { data: chestBundle, error: chestBundleError } = await supabase
        .from('loot_log_bundles')
        .select('id,start_at,combined_loot_summary')
        .eq('id', bundleId)
        .single();

      if (chestBundleError) throw chestBundleError;

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
          raw_log_text: chestLogText,
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

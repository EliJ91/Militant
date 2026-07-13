import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  aggregateLootLogEvents,
  buildLootLogEvents,
  getLootLogTimeRange,
} from '../utils/lootLogMerge.js';
import { combineChestLogTexts, parseChestLog } from '../utils/lootMonitor.js';

function requireConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  return { serviceRoleKey, supabaseUrl };
}

function createSupabaseAdmin() {
  const { serviceRoleKey, supabaseUrl } = requireConfig();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

const CTA_UTC_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
const HASH_LOOKUP_BATCH_SIZE = 40;
const INSERT_BATCH_SIZE = 250;
const UPDATE_BATCH_SIZE = 25;
const DATABASE_PAGE_SIZE = 1000;
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const MILITANT_GUILD_ID = 'HNWzt1KSQMSQ855Q9rLvSA';
const ALBION_DEATHS_URL = 'https://gameinfo.albiononline.com/api/gameinfo/players';
const KILLBOARD_EVENT_URL = 'https://killboard-1.com/us/event';
const DEATH_CHECK_BATCH_SIZE = 1;
const DEATH_REQUEST_TIMEOUT_MS = 12000;
const DEATH_EVENT_REQUEST_TIMEOUT_MS = 8000;

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function fetchAllBundleEvents(supabase, bundleId) {
  const events = [];

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

function formatCtaTimer(hour) {
  return `${String(hour).padStart(2, '0')} UTC`;
}

function getCtaTimer(timestamp) {
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

function buildBundleFileNames(startAt) {
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

function stripLogTypeSuffixes(value) {
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

function buildSharedFileNames(value, fallback) {
  const baseName = stripLogTypeSuffixes(value || fallback);
  return {
    baseName,
    chest: baseName ? `${baseName} Chest Log` : '',
    loot: baseName ? `${baseName} Loot Log` : '',
  };
}

export function getBundleFileNames(bundle, startAt = bundle?.start_at) {
  const generated = buildBundleFileNames(startAt);
  const stored = bundle?.combined_loot_summary?.fileNames || {};

  return buildSharedFileNames(
    stored.loot || stored.chest || stored.baseName,
    generated.baseName,
  );
}

function cleanDisplayLogName(value) {
  const fileName = String(value || '').trim().split(/[\\/]/).pop() || '';
  return stripLogTypeSuffixes(
    fileName.replace(/[\r\n]/g, '').replace(/\.(?:csv|log|tsv|txt)$/i, ''),
  ).slice(0, 151);
}

export function getBundleDisplayLootFileName(bundle, originalFileName, startAt = bundle?.start_at) {
  const summary = bundle?.combined_loot_summary || {};
  return cleanDisplayLogName(summary.displayLootFileName)
    || cleanDisplayLogName(summary.fileNames?.loot)
    || cleanDisplayLogName(originalFileName)
    || getBundleFileNames(bundle, startAt).baseName;
}

export function getBundleDisplayChestFileName(bundle, startAt = bundle?.start_at) {
  return getBundleDisplayLootFileName(bundle, '', startAt);
}

function getEditedFileNames(fileNames, startAt) {
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

function buildEditedBundleRange(bundle, dateUtc, ctaHour) {
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
  const [year, month, day] = dateUtc.split('-').map(Number);
  const newAnchor = Date.UTC(year, month - 1, day, hour);
  const duration = Math.max(0, currentEnd.getTime() - currentStart.getTime());
  const startAt = new Date(newAnchor + offsetFromCta).toISOString();

  return {
    endAt: new Date(newAnchor + offsetFromCta + duration).toISOString(),
    startAt,
  };
}

function normalizeSubmitterName(name) {
  const clean = String(name || '').trim();
  return clean === 'manual-web-upload' ? 'Manual' : clean;
}

function cleanEditedSubmitterName(name) {
  const clean = String(name || '').trim();
  if (!clean || clean.length > 80 || /[\r\n]/.test(clean)) return '';
  return clean;
}

function mapBundleListRow(bundle) {
  const submissions = Array.isArray(bundle.loot_log_submissions) ? bundle.loot_log_submissions : [];
  const chestLogs = Array.isArray(bundle.chest_log_submissions) ? bundle.chest_log_submissions : [];
  const displaySubmitters = bundle.combined_loot_summary?.displaySubmitters || {};
  const submitters = displaySubmitters.loot
    ? [displaySubmitters.loot]
    : [...new Set(submissions.map((submission) => normalizeSubmitterName(submission.submitted_by)).filter(Boolean))];
  const chestSubmitters = displaySubmitters.chest
    ? [displaySubmitters.chest]
    : [...new Set(chestLogs.map((submission) => normalizeSubmitterName(submission.submitted_by)).filter(Boolean))];
  const startAt = bundle.start_at;
  const endAt = bundle.end_at;
  const fileNames = getBundleFileNames(bundle, startAt);

  return {
    chestLogCount: chestLogs.length,
    chestFileName: getBundleDisplayChestFileName(bundle, startAt),
    ctaTimer: getCtaTimer(startAt),
    createdAt: bundle.created_at,
    endAt,
    hasChestLog: chestLogs.length > 0,
    id: bundle.id,
    lootFileName: getBundleDisplayLootFileName(bundle, '', startAt),
    startAt,
    submissions: submissions.map((submission) => ({
      createdAt: submission.created_at,
      id: submission.id,
      submittedBy: normalizeSubmitterName(submission.submitted_by),
    })),
    chestSubmissions: chestLogs.map((submission) => ({
      createdAt: submission.created_at,
      id: submission.id,
      submittedBy: normalizeSubmitterName(submission.submitted_by),
    })),
    chestSubmitters,
    submitters,
    summary: bundle.combined_loot_summary,
    updatedAt: bundle.updated_at,
  };
}

function hashDedupeKey(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function dbEventToMergeEvent(event) {
  return {
    alliance: event.alliance,
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

export function normalizeDeathCheckRanges(ranges, fallbackBundle = null) {
  const sourceRanges = Array.isArray(ranges) && ranges.length > 0
    ? ranges
    : fallbackBundle
      ? [{ endAt: fallbackBundle.end_at, startAt: fallbackBundle.start_at }]
      : [];
  const validRanges = sourceRanges
    .map((range) => {
      const start = new Date(range?.startAt || range?.start_at || '').getTime();
      const end = new Date(range?.endAt || range?.end_at || '').getTime();
      return Number.isFinite(start) && Number.isFinite(end) && start <= end ? { end, start } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);

  return validRanges.reduce((merged, range) => {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      return merged;
    }
    merged.push({ ...range });
    return merged;
  }, []).map((range) => ({
    endAt: new Date(range.end).toISOString(),
    startAt: new Date(range.start).toISOString(),
  }));
}

function normalizeDeathKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeKeptItems(items) {
  const quantities = new Map();

  function addItem(itemId, quantity, lootDateKey = '', lootTimestamps = []) {
    if (!itemId || quantity <= 0) return;
    const key = `${itemId}::${lootDateKey}`;
    const current = quantities.get(key) || {
      itemId,
      lootDateKey,
      lootTimestamps: new Set(),
      quantity: 0,
    };
    current.quantity += quantity;
    lootTimestamps.forEach((timestamp) => {
      const value = String(timestamp || '').trim();
      if (value) current.lootTimestamps.add(value);
    });
    quantities.set(key, current);
  }

  (Array.isArray(items) ? items : []).forEach((item) => {
    const itemId = String(item?.itemId || '').trim().toUpperCase();
    const quantity = Math.max(0, Math.trunc(Number(item?.quantity) || 0));
    if (!itemId || quantity <= 0) return;
    const lootTimestamps = (Array.isArray(item?.lootTimestamps) ? item.lootTimestamps : [])
      .map((timestamp) => String(timestamp || '').trim())
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

function deathTimestamp(death) {
  const timestamp = new Date(death?.TimeStamp || death?.timestamp || '');
  return Number.isNaN(timestamp.getTime()) ? '' : timestamp.toISOString();
}

function deathEventUrl(eventId) {
  const cleanEventId = String(eventId || '').trim();
  return cleanEventId ? `${KILLBOARD_EVENT_URL}/${encodeURIComponent(cleanEventId)}` : '';
}

async function deathEventExists(eventId) {
  const url = deathEventUrl(eventId);
  if (!url) return false;

  const requestOptions = {};
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

export function deathMatchesBundle(death, bundle) {
  const timestamp = new Date(deathTimestamp(death)).getTime();
  const deathCheckRanges = normalizeDeathCheckRanges(
    bundle?.combined_loot_summary?.deathCheckRanges,
    bundle,
  );
  if (deathCheckRanges.length > 0) {
    return Number.isFinite(timestamp) && deathCheckRanges.some((range) => (
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

function timestampDateKey(value) {
  const rawValue = String(value || '').trim();
  const isoDate = rawValue.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  const timestamp = new Date(rawValue);
  return Number.isNaN(timestamp.getTime()) ? '' : timestamp.toISOString().slice(0, 10);
}

function matchDeathInventory(death, keptItems) {
  const inventory = Array.isArray(death?.Victim?.Inventory) ? death.Victim.Inventory : [];
  const inventoryQuantities = new Map();
  const keptQuantities = new Map();

  inventory.forEach((item) => {
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

function pickMatchingDeath(deaths, bundle, playerId, keptItems) {
  let bestMatch = null;
  let bestScore = -1;
  let bestTimestamp = -1;

  (Array.isArray(deaths) ? deaths : []).forEach((death) => {
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

async function fetchPlayerDeaths(playerId) {
  const deathApiUrl = `${ALBION_DEATHS_URL}/${encodeURIComponent(playerId)}/deaths`;
  const requestOptions = {};
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

function summarizeDeathCandidate(death, bundle, playerId, keptItems) {
  const timestamp = deathTimestamp(death);
  const timestampMs = new Date(timestamp).getTime();
  const startMs = new Date(bundle.start_at).getTime();
  const endMs = new Date(bundle.end_at).getTime();
  const eventId = String(death?.EventId || '').trim();
  const victimId = String(death?.Victim?.Id || '').trim();
  const matchedItems = matchDeathInventory(death, keptItems);

  return {
    eventId,
    inDateTimeRange: Number.isFinite(timestampMs)
      && Number.isFinite(startMs)
      && Number.isFinite(endMs)
      && timestampMs >= startMs
      && timestampMs <= endMs,
    matchedItems,
    matchedQuantity: matchedItems.reduce((total, item) => total + item.quantity, 0),
    timestamp,
    victimId,
    victimMatchesPlayer: victimId === playerId,
  };
}

function normalizeDeathCheckRequests(checks) {
  const requestsByPlayer = new Map();

  (Array.isArray(checks) ? checks : []).forEach((check) => {
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

async function loadDeathCheckContext(supabase, bundleId, playerKeys) {
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
    membersByPlayer: new Map((membersResult.data || []).map((member) => [member.player_key, member])),
    rangeNeedsUpdate: hasValidRange && (bundle.start_at !== exactStartAt || bundle.end_at !== exactEndAt),
  };
}

function mapDeathCheck(row) {
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

async function clearLootLogDeathChecks(supabase, bundleId) {
  const { error } = await supabase
    .from('loot_log_death_checks')
    .delete()
    .eq('bundle_id', bundleId);

  if (error) throw error;
}

async function runLootLogDeathChecks(supabase, { bundleId, checks }) {
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
  const records = [];
  const errors = [];

  for (const request of requests) {
    try {
      const member = context.membersByPlayer.get(request.playerKey);
      const playerId = String(member?.player_id || '').trim();
      const deathApiUrl = playerId ? `${ALBION_DEATHS_URL}/${encodeURIComponent(playerId)}/deaths` : '';
      console.info('[loot death check] player lookup', {
        bundleId: cleanBundleId,
        deathApiUrl,
        player: request.player,
        playerId,
        playerKey: request.playerKey,
        rangeEnd: context.effectiveBundle.end_at,
        rangeStart: context.effectiveBundle.start_at,
        storedMemberFound: Boolean(member),
      });

      const deaths = playerId ? await fetchPlayerDeaths(playerId) : [];
      const possibleMatch = playerId
        ? pickMatchingDeath(deaths, context.effectiveBundle, playerId, request.keptItems)
        : null;
      const match = possibleMatch && await deathEventExists(possibleMatch.eventId)
        ? possibleMatch
        : null;
      console.info('[loot death check] player result', {
        bundleId: cleanBundleId,
        checkedDeaths: Array.isArray(deaths) ? deaths.length : 0,
        eventId: match?.eventId || '',
        rejectedEventId: possibleMatch && !match ? possibleMatch.eventId : '',
        matchedItems: match?.matchedItems || [],
        player: request.player,
        playerId,
        playerKey: request.playerKey,
        status: match ? 'found' : 'not_found',
        candidates: (Array.isArray(deaths) ? deaths : []).map((death) => summarizeDeathCandidate(
          death,
          context.effectiveBundle,
          playerId,
          request.keptItems,
        )),
      });
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

  let savedChecks = [];
  if (records.length > 0) {
    const { data, error } = await supabase
      .from('loot_log_death_checks')
      .upsert(records, { onConflict: 'bundle_id,player_key' })
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

export async function checkLootLogDeath({ bundleId, keptItems, player }) {
  const result = await runLootLogDeathChecks(createSupabaseAdmin(), {
    bundleId,
    checks: [{ keptItems, player }],
  });
  if (result.errors.length > 0) throw new Error(result.errors[0].message);
  if (!result.deathChecks[0]) throw new Error('Could not save the player death check.');
  return { deathCheck: result.deathChecks[0] };
}

export async function checkLootLogDeaths({ bundleId, checks }) {
  return runLootLogDeathChecks(createSupabaseAdmin(), { bundleId, checks });
}

export async function clearLootLogDeath({ bundleId, player }) {
  const cleanBundleId = String(bundleId || '').trim();
  const playerKey = normalizeDeathKey(player);
  if (!cleanBundleId) throw new Error('bundleId is required.');
  if (!playerKey) throw new Error('player is required.');

  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from('loot_log_death_checks')
    .delete()
    .eq('bundle_id', cleanBundleId)
    .eq('player_key', playerKey);

  if (error) throw error;
  return { playerKey, removed: true };
}

function collapseEventsByHash(events) {
  const byHash = new Map();

  events.forEach((event) => {
    const eventHash = hashDedupeKey(event.dedupeKey);
    const current = byHash.get(eventHash);

    if (!current || event.quantity > current.quantity) {
      byHash.set(eventHash, {
        ...event,
        eventHash,
      });
    }
  });

  return [...byHash.values()];
}

async function findMatchingBundle(supabase, range) {
  const { data, error } = await supabase
    .from('loot_log_bundles')
    .select('id,start_at,end_at,combined_loot_summary')
    .lte('start_at', range.matchEndAt)
    .gte('end_at', range.matchStartAt);

  if (error) throw error;
  if (!data?.length) return null;

  const incomingCenter = (new Date(range.startAt).getTime() + new Date(range.endAt).getTime()) / 2;
  return data.sort((left, right) => {
    const leftCenter = (new Date(left.start_at).getTime() + new Date(left.end_at).getTime()) / 2;
    const rightCenter = (new Date(right.start_at).getTime() + new Date(right.end_at).getTime()) / 2;
    return Math.abs(leftCenter - incomingCenter) - Math.abs(rightCenter - incomingCenter);
  })[0];
}

async function getOrCreateBundle(supabase, { bundleId, range }) {
  if (bundleId) {
    const { data, error } = await supabase
      .from('loot_log_bundles')
      .select('id,start_at,end_at,combined_loot_summary')
      .eq('id', bundleId)
      .single();

    if (error) throw error;
    return { bundle: data, matchedExistingBundle: true };
  }

  const existing = await findMatchingBundle(supabase, range);
  if (existing) return { bundle: existing, matchedExistingBundle: true };

  const { data, error } = await supabase
    .from('loot_log_bundles')
    .insert({
      end_at: range.endAt,
      start_at: range.startAt,
    })
    .select('id,start_at,end_at,combined_loot_summary')
    .single();

  if (error) throw error;
  return { bundle: data, matchedExistingBundle: false };
}

async function refreshBundleSummary(supabase, bundle, originalFileName) {
  const events = await fetchAllBundleEvents(supabase, bundle.id);

  const mergeEvents = (events || []).map(dbEventToMergeEvent);
  const summary = aggregateLootLogEvents(mergeEvents);
  const range = getLootLogTimeRange(mergeEvents);
  const summaryWithFileNames = {
    ...summary,
    ...(bundle.combined_loot_summary?.isMerged ? {
      deathCheckRanges: bundle.combined_loot_summary.deathCheckRanges,
      isMerged: true,
      mergedAt: bundle.combined_loot_summary.mergedAt,
      mergedBy: bundle.combined_loot_summary.mergedBy,
      mergedFromBundleIds: bundle.combined_loot_summary.mergedFromBundleIds,
    } : {}),
    displayLootFileName: getBundleDisplayLootFileName(bundle, originalFileName, range?.startAt),
    fileNames: getBundleFileNames(bundle, range?.startAt),
  };

  const { data: refreshedBundle, error: updateError } = await supabase
    .from('loot_log_bundles')
    .update({
      combined_loot_summary: summaryWithFileNames,
      end_at: range?.endAt,
      start_at: range?.startAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bundle.id)
    .select('id,start_at,end_at,combined_loot_summary')
    .single();

  if (updateError) throw updateError;

  return { bundle: refreshedBundle, eventCount: mergeEvents.length, summary: summaryWithFileNames };
}

async function mergeLootLogEvents(supabase, { bundleId, events, submissionId }) {
  const collapsedEvents = collapseEventsByHash(events);
  const eventHashes = collapsedEvents.map((event) => event.eventHash);
  const existingEventBatches = await Promise.all(
    chunkArray(eventHashes, HASH_LOOKUP_BATCH_SIZE).map(async (hashBatch) => {
      const { data, error } = await supabase
        .from('loot_log_events')
        .select('id,event_hash,quantity')
        .eq('bundle_id', bundleId)
        .in('event_hash', hashBatch);

      if (error) throw error;
      return data || [];
    }),
  );
  const existingEvents = existingEventBatches.flat();

  const existingByHash = new Map((existingEvents || []).map((event) => [event.event_hash, event]));
  const insertRows = [];
  const updateRows = [];
  let duplicateEvents = 0;

  collapsedEvents.forEach((event) => {
    const existing = existingByHash.get(event.eventHash);
    const row = {
      alliance: event.alliance,
      bundle_id: bundleId,
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
      submission_id: submissionId,
      timestamp_utc: event.timestamp,
    };

    if (!existing) {
      insertRows.push(row);
      return;
    }

    if (event.quantity > existing.quantity) {
      updateRows.push({
        id: existing.id,
        ...row,
      });
      return;
    }

    duplicateEvents += 1;
  });

  for (const insertBatch of chunkArray(insertRows, INSERT_BATCH_SIZE)) {
    const { error } = await supabase
      .from('loot_log_events')
      .insert(insertBatch);

    if (error) throw error;
  }

  for (const updateBatch of chunkArray(updateRows, UPDATE_BATCH_SIZE)) {
    await Promise.all(updateBatch.map(async (row) => {
      const { id, ...updates } = row;
      const { error } = await supabase
        .from('loot_log_events')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    }));
  }

  return {
    duplicateEvents,
    insertedEvents: insertRows.length,
    submittedEvents: events.length,
    updatedEvents: updateRows.length,
  };
}

export async function submitLootLog({ bundleId = null, lootLogText, originalFileName, username }) {
  const cleanUsername = String(username || '').trim() || 'manual-web-upload';
  if (!lootLogText || typeof lootLogText !== 'string') throw new Error('lootLogText is required.');

  const { events, parsed } = buildLootLogEvents(lootLogText);
  const range = getLootLogTimeRange(events);
  if (!range) throw new Error('The loot log does not contain any valid timestamp_utc values.');

  const supabase = createSupabaseAdmin();
  const { bundle, matchedExistingBundle } = await getOrCreateBundle(supabase, { bundleId, range });

  const { data: submission, error: submissionError } = await supabase
    .from('loot_log_submissions')
    .insert({
      bundle_id: bundle.id,
      event_end_at: range.endAt,
      event_start_at: range.startAt,
      raw_log_text: lootLogText,
      skipped_rows: parsed.skippedRows,
      submitted_by: cleanUsername,
    })
    .select('id')
    .single();

  if (submissionError) throw submissionError;

  const mergeResult = await mergeLootLogEvents(supabase, {
    bundleId: bundle.id,
    events,
    submissionId: submission.id,
  });

  const refreshed = await refreshBundleSummary(supabase, bundle, originalFileName);
  await clearLootLogDeathChecks(supabase, bundle.id);

  return {
    bundle: refreshed.bundle,
    bundleId: bundle.id,
    duplicateEvents: mergeResult.duplicateEvents,
    eventCount: refreshed.eventCount,
    insertedEvents: mergeResult.insertedEvents,
    matchedExistingBundle,
    skippedRows: parsed.skippedRows,
    submissionId: submission.id,
    summary: refreshed.summary,
    updatedEvents: mergeResult.updatedEvents,
  };
}

export async function submitChestLog({ bundleId, chestLogText, username }) {
  const cleanUsername = String(username || '').trim() || 'manual-web-upload';
  if (!bundleId) throw new Error('bundleId is required.');
  if (!chestLogText || typeof chestLogText !== 'string') throw new Error('chestLogText is required.');

  const parsed = parseChestLog(chestLogText);
  if (parsed.rows.length === 0 && parsed.withdrawals.length === 0) {
    throw new Error('The chest log does not contain any valid item rows.');
  }

  const supabase = createSupabaseAdmin();
  const { data: bundle, error: bundleError } = await supabase
    .from('loot_log_bundles')
    .select('id,start_at,combined_loot_summary')
    .eq('id', bundleId)
    .single();

  if (bundleError) throw bundleError;

  const fileNames = getBundleFileNames(bundle);
  const parsedSummary = {
    fileName: fileNames.chest,
    skippedRows: parsed.skippedRows,
    totals: {
      depositedQuantity: parsed.rows.reduce((sum, row) => sum + row.amount, 0),
      depositRows: parsed.rows.length,
      withdrawalRows: parsed.withdrawals.length,
    },
  };

  const { data: submission, error: submissionError } = await supabase
    .from('chest_log_submissions')
    .insert({
      bundle_id: bundleId,
      parsed_chest_summary: parsedSummary,
      raw_log_text: chestLogText,
      submitted_by: cleanUsername,
    })
    .select('id,created_at')
    .single();

  if (submissionError) throw submissionError;

  const combinedSummary = {
    ...(bundle.combined_loot_summary || {}),
    fileNames,
  };
  const { error: updateError } = await supabase
    .from('loot_log_bundles')
    .update({
      combined_loot_summary: combinedSummary,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bundleId);

  if (updateError) throw updateError;
  await clearLootLogDeathChecks(supabase, bundleId);

  return {
    bundleId,
    fileName: fileNames.chest,
    submissionId: submission.id,
    summary: parsedSummary,
  };
}

export async function mergeLootLogBundles({ bundleIds, username }) {
  const sourceIds = [...new Set((Array.isArray(bundleIds) ? bundleIds : [])
    .map((bundleId) => String(bundleId || '').trim())
    .filter(Boolean))];
  if (sourceIds.length < 2) throw new Error('Select at least two loot logs to merge.');
  if (sourceIds.length > 20) throw new Error('A maximum of 20 loot logs can be merged at once.');

  const supabase = createSupabaseAdmin();
  const { data: unorderedBundles, error: bundlesError } = await supabase
    .from('loot_log_bundles')
    .select('id,start_at,end_at,combined_loot_summary')
    .in('id', sourceIds);
  if (bundlesError) throw bundlesError;
  if ((unorderedBundles || []).length !== sourceIds.length) throw new Error('One or more selected loot logs could not be found.');

  const byId = new Map(unorderedBundles.map((bundle) => [bundle.id, bundle]));
  const sourceBundles = sourceIds.map((bundleId) => byId.get(bundleId));
  const startAt = new Date(Math.min(...sourceBundles.map((bundle) => new Date(bundle.start_at).getTime()))).toISOString();
  const endAt = new Date(Math.max(...sourceBundles.map((bundle) => new Date(bundle.end_at).getTime()))).toISOString();
  const mergedAt = new Date().toISOString();
  const mergedBy = String(username || '').trim() || 'manual-web-upload';
  const deathCheckRanges = normalizeDeathCheckRanges(sourceBundles.flatMap((bundle) => (
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
    .insert({
      combined_loot_summary: mergeMetadata,
      end_at: endAt,
      start_at: startAt,
    })
    .select('id,start_at,end_at,combined_loot_summary')
    .single();
  if (targetError) throw targetError;

  try {
    const copiedEventsByHash = new Map();
    const chestRows = [];

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

      const submissionIds = new Map();
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
      sourceEvents.forEach((event) => {
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

      (chestResult.data || []).forEach((submission) => chestRows.push({
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

export async function deleteLootLogBundle(bundleId) {
  if (!bundleId) throw new Error('bundleId is required.');

  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from('loot_log_bundles')
    .delete()
    .eq('id', bundleId)
    .select('id')
    .single();

  if (error) throw error;

  return { bundleId: data.id, deleted: true };
}

export async function deleteExpiredLootLogBundles() {
  const supabase = createSupabaseAdmin();
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
    deletedBundleIds: (data || []).map((bundle) => bundle.id),
  };
}

export async function updateLootLogBundle({ bundleId, ctaHour, dateUtc, fileNames: editedFileNames, submitters = {} }) {
  if (!bundleId) throw new Error('bundleId is required.');

  const supabase = createSupabaseAdmin();
  const { data: bundle, error: bundleError } = await supabase
    .from('loot_log_bundles')
    .select('id,start_at,end_at,combined_loot_summary')
    .eq('id', bundleId)
    .single();

  if (bundleError) throw bundleError;

  const range = buildEditedBundleRange(bundle, dateUtc, ctaHour);
  const fileNames = getEditedFileNames(editedFileNames, range.startAt);
  const lootSubmitter = cleanEditedSubmitterName(submitters.loot);
  const chestSubmitter = cleanEditedSubmitterName(submitters.chest);
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
    .select('id,start_at,end_at,combined_loot_summary,created_at,updated_at')
    .single();

  if (updateError) throw updateError;

  const { data: chestLogs, error: chestError } = await supabase
    .from('chest_log_submissions')
    .select('id,parsed_chest_summary')
    .eq('bundle_id', bundleId);

  if (chestError) throw chestError;
  await Promise.all((chestLogs || []).map(async (chestLog) => {
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

  return {
    bundle: updatedBundle,
    bundleId,
    ctaTimer: getCtaTimer(range.startAt),
    displayLootFileName: fileNames.baseName,
    fileNames,
  };
}

export async function getLootLogBundle(bundleId) {
  if (!bundleId) throw new Error('bundleId is required.');

  const supabase = createSupabaseAdmin();
  const { data: bundle, error: bundleError } = await supabase
    .from('loot_log_bundles')
    .select('id,start_at,end_at,combined_loot_summary,created_at,updated_at')
    .eq('id', bundleId)
    .single();

  if (bundleError) throw bundleError;

  const [eventsResult, lootSubmissionsResult, chestResult, deathChecksResult] = await Promise.all([
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

  if (lootSubmissionsResult.error) throw lootSubmissionsResult.error;
  if (chestResult.error) throw chestResult.error;
  if (deathChecksResult.error) throw deathChecksResult.error;

  const summary = aggregateLootLogEvents(eventsResult.map(dbEventToMergeEvent));
  const chestLogs = chestResult.data || [];
  const rawChestLogTexts = chestLogs.map((log) => log.raw_log_text || '').filter(Boolean);
  const rawLootLogTexts = (lootSubmissionsResult.data || [])
    .map((submission) => submission.raw_log_text || '')
    .filter(Boolean);
  const displaySubmitters = bundle.combined_loot_summary?.displaySubmitters || {};
  const submitters = displaySubmitters.loot
    ? [displaySubmitters.loot]
    : [...new Set((lootSubmissionsResult.data || [])
      .map((submission) => normalizeSubmitterName(submission.submitted_by))
      .filter(Boolean))];
  const chestSubmitters = displaySubmitters.chest
    ? [displaySubmitters.chest]
    : [...new Set(chestLogs.map((submission) => normalizeSubmitterName(submission.submitted_by)).filter(Boolean))];
  const fileNames = getBundleFileNames(bundle);

  return {
    bundle: {
      chestFileName: getBundleDisplayChestFileName(bundle),
      chestLogReportText: rawChestLogTexts.join('\n'),
      chestLogText: combineChestLogTexts(rawChestLogTexts),
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
      submissions: (lootSubmissionsResult.data || []).map((submission) => ({
        createdAt: submission.created_at,
        id: submission.id,
        rawLogText: submission.raw_log_text || '',
        submittedBy: normalizeSubmitterName(submission.submitted_by),
      })),
      submitters,
      chestSubmissions: chestLogs.map((submission) => ({
        createdAt: submission.created_at,
        id: submission.id,
        rawLogText: submission.raw_log_text || '',
        submittedBy: normalizeSubmitterName(submission.submitted_by),
      })),
      chestSubmitters,
      summary,
      updatedAt: bundle.updated_at,
    },
  };
}

export async function listLootLogBundles() {
  await deleteExpiredLootLogBundles();
  const supabase = createSupabaseAdmin();
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

  return {
    bundles: (data || []).map(mapBundleListRow),
    ctaTimers: CTA_UTC_HOURS.map(formatCtaTimer),
  };
}

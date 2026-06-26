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

function mapBundleListRow(bundle) {
  const submissions = Array.isArray(bundle.loot_log_submissions) ? bundle.loot_log_submissions : [];
  const chestLogs = Array.isArray(bundle.chest_log_submissions) ? bundle.chest_log_submissions : [];
  const submitters = [...new Set(submissions.map((submission) => normalizeSubmitterName(submission.submitted_by)).filter(Boolean))];
  const startAt = bundle.start_at;
  const endAt = bundle.end_at;
  const fileNames = getBundleFileNames(bundle, startAt);

  return {
    chestLogCount: chestLogs.length,
    chestFileName: getBundleDisplayChestFileName(bundle, startAt),
    ctaTimer: getCtaTimer(startAt),
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

  return {
    bundleId,
    fileName: fileNames.chest,
    submissionId: submission.id,
    summary: parsedSummary,
  };
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

export async function updateLootLogBundle({ bundleId, ctaHour, dateUtc, fileNames: editedFileNames }) {
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
  const combinedSummary = {
    ...(bundle.combined_loot_summary || {}),
    displayLootFileName: fileNames.baseName,
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
    .select('id,start_at,end_at,combined_loot_summary,updated_at')
    .eq('id', bundleId)
    .single();

  if (bundleError) throw bundleError;

  const [eventsResult, lootSubmissionsResult, chestResult] = await Promise.all([
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

  if (lootSubmissionsResult.error) throw lootSubmissionsResult.error;
  if (chestResult.error) throw chestResult.error;

  const summary = aggregateLootLogEvents(eventsResult.map(dbEventToMergeEvent));
  const chestLogs = chestResult.data || [];
  const rawChestLogTexts = chestLogs.map((log) => log.raw_log_text || '').filter(Boolean);
  const primaryLootLog = lootSubmissionsResult.data?.[0] || null;
  const fileNames = getBundleFileNames(bundle);

  return {
    bundle: {
      chestFileName: getBundleDisplayChestFileName(bundle),
      chestLogReportText: rawChestLogTexts.join('\n'),
      chestLogText: combineChestLogTexts(rawChestLogTexts),
      ctaTimer: getCtaTimer(bundle.start_at),
      endAt: bundle.end_at,
      events: eventsResult.map(dbEventToMergeEvent),
      hasChestLog: chestLogs.length > 0,
      id: bundle.id,
      lootFileName: getBundleDisplayLootFileName(bundle),
      lootLogText: primaryLootLog?.raw_log_text || '',
      startAt: bundle.start_at,
      submissions: (lootSubmissionsResult.data || []).map((submission) => ({
        createdAt: submission.created_at,
        id: submission.id,
        submittedBy: normalizeSubmitterName(submission.submitted_by),
      })),
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
      updated_at,
      loot_log_submissions (
        id,
        submitted_by,
        created_at
      ),
      chest_log_submissions (
        id
      )
    `)
    .order('start_at', { ascending: false });

  if (error) throw error;

  return {
    bundles: (data || []).map(mapBundleListRow),
    ctaTimers: CTA_UTC_HOURS.map(formatCtaTimer),
  };
}

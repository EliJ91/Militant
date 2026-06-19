import { createClient } from '@supabase/supabase-js';
import { aggregateLootLogEvents } from '../src/utils/lootLogMerge.js';

const TARGET_ITEM_ID = 'QUESTITEM_TOKEN_SMUGGLER';
const PAGE_SIZE = 1000;
const applyChanges = process.argv.includes('--apply');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

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

function removeItemLines(text) {
  const pattern = /^.*QUESTITEM_TOKEN_SMUGGLER.*(?:\r\n|\n|\r|$)/gim;
  const matches = String(text || '').match(pattern) || [];
  return {
    removedLines: matches.length,
    text: String(text || '').replace(pattern, ''),
  };
}

async function fetchAllBundleEvents(bundleId) {
  const events = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('loot_log_events')
      .select('*')
      .eq('bundle_id', bundleId)
      .order('timestamp_utc')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    events.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return events;
}

const [eventResult, lootSubmissionResult, chestSubmissionResult, bundleResult] = await Promise.all([
  supabase
    .from('loot_log_events')
    .select('id,bundle_id,item_id,item_name,quantity')
    .eq('item_id', TARGET_ITEM_ID),
  supabase
    .from('loot_log_submissions')
    .select('id,bundle_id,raw_log_text')
    .ilike('raw_log_text', `%${TARGET_ITEM_ID}%`),
  supabase
    .from('chest_log_submissions')
    .select('id')
    .ilike('raw_log_text', `%${TARGET_ITEM_ID}%`),
  supabase
    .from('loot_log_bundles')
    .select('id,combined_loot_summary'),
]);

if (eventResult.error) throw eventResult.error;
if (lootSubmissionResult.error) throw lootSubmissionResult.error;
if (chestSubmissionResult.error) throw chestSubmissionResult.error;
if (bundleResult.error) throw bundleResult.error;

const eventRows = eventResult.data || [];
const lootSubmissions = lootSubmissionResult.data || [];
const chestSubmissions = chestSubmissionResult.data || [];
const staleSummaryBundleIds = (bundleResult.data || [])
  .filter((bundle) => {
    const summary = JSON.stringify(bundle.combined_loot_summary || {}).toLowerCase();
    return summary.includes('questitem_token_smuggler') || summary.includes("smuggler's coin");
  })
  .map((bundle) => bundle.id);
const affectedBundleIds = [...new Set([
  ...eventRows.map((event) => event.bundle_id),
  ...staleSummaryBundleIds,
])];
const preview = {
  affectedBundles: affectedBundleIds.length,
  chestSubmissions: chestSubmissions.length,
  eventQuantity: eventRows.reduce((total, event) => total + Number(event.quantity || 0), 0),
  eventRows: eventRows.length,
  lootSubmissions: lootSubmissions.length,
  staleSummaryBundles: staleSummaryBundleIds.length,
};

if (!applyChanges) {
  console.log(JSON.stringify({ applied: false, preview }, null, 2));
  process.exit(0);
}

if (chestSubmissions.length > 0) {
  throw new Error('Smuggler coin data was found in a chest submission; aborting instead of altering chest history.');
}

let removedRawLines = 0;
for (const submission of lootSubmissions) {
  const cleaned = removeItemLines(submission.raw_log_text);
  removedRawLines += cleaned.removedLines;

  const { error } = await supabase
    .from('loot_log_submissions')
    .update({ raw_log_text: cleaned.text })
    .eq('id', submission.id);

  if (error) throw error;
}

if (eventRows.length > 0) {
  const { error } = await supabase
    .from('loot_log_events')
    .delete()
    .eq('item_id', TARGET_ITEM_ID);

  if (error) throw error;
}

for (const bundleId of affectedBundleIds) {
  const [events, bundleResult] = await Promise.all([
    fetchAllBundleEvents(bundleId),
    supabase
      .from('loot_log_bundles')
      .select('combined_loot_summary')
      .eq('id', bundleId)
      .single(),
  ]);

  if (bundleResult.error) throw bundleResult.error;

  const summary = aggregateLootLogEvents(events.map(dbEventToMergeEvent));
  const fileNames = bundleResult.data?.combined_loot_summary?.fileNames;
  const { error } = await supabase
    .from('loot_log_bundles')
    .update({
      combined_loot_summary: fileNames ? { ...summary, fileNames } : summary,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bundleId);

  if (error) throw error;
}

const [remainingEvents, remainingLootSubmissions] = await Promise.all([
  supabase
    .from('loot_log_events')
    .select('id', { count: 'exact', head: true })
    .eq('item_id', TARGET_ITEM_ID),
  supabase
    .from('loot_log_submissions')
    .select('id', { count: 'exact', head: true })
    .ilike('raw_log_text', `%${TARGET_ITEM_ID}%`),
]);

if (remainingEvents.error) throw remainingEvents.error;
if (remainingLootSubmissions.error) throw remainingLootSubmissions.error;

console.log(JSON.stringify({
  applied: true,
  preview,
  removedRawLines,
  remainingEventRows: remainingEvents.count || 0,
  remainingRawLootSubmissions: remainingLootSubmissions.count || 0,
}, null, 2));

import { createClient } from '@supabase/supabase-js';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;

function createSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase server credentials.');
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function clean(value, fallback = '') {
  return String(value || '').trim() || fallback;
}

function bundleTitle(bundle) {
  const summary = bundle?.combined_loot_summary || {};
  const fileNames = summary.fileNames || {};
  return clean(summary.discordThreadName || summary.displayLootFileName || fileNames.baseName || fileNames.loot)
    .replace(/\s+(?:Loot|Chest) Log$/i, '');
}

async function enrichActionRows(admin, rows) {
  const bundleIds = [...new Set(rows
    .map((row) => clean(row.target_id))
    .filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))];
  if (bundleIds.length === 0) return rows;

  const [{ data: bundles, error: bundleError }, { data: deathChecks, error: deathError }] = await Promise.all([
    admin
      .from('loot_log_bundles')
      .select('id,combined_loot_summary,created_at')
      .order('created_at', { ascending: true }),
    admin
      .from('loot_log_death_checks')
      .select('bundle_id,player_name,checked_at')
      .in('bundle_id', bundleIds)
      .order('checked_at', { ascending: true }),
  ]);

  if (bundleError) throw bundleError;
  if (deathError) throw deathError;

  const bundleById = new Map((bundles || []).map((bundle, index) => [String(bundle.id), {
    logNumber: index + 1,
    lootLogName: bundleTitle(bundle),
  }]));
  const deathsByBundle = new Map();
  (deathChecks || []).forEach((deathCheck) => {
    const bundleId = String(deathCheck.bundle_id || '');
    if (!deathsByBundle.has(bundleId)) deathsByBundle.set(bundleId, []);
    deathsByBundle.get(bundleId).push(deathCheck);
  });

  return rows.map((row) => {
    const bundleId = clean(row.target_id);
    const bundle = bundleById.get(bundleId);
    const details = { ...(row.details || {}) };
    if (bundle) {
      details.lootLogNumber ||= bundle.logNumber;
      details.lootLogName ||= bundle.lootLogName;
    }

    if (/^Death checks? completed$/i.test(clean(row.action)) && !details.player && !details.players?.length) {
      const actionTime = new Date(row.created_at).getTime();
      const nearest = (deathsByBundle.get(bundleId) || []).reduce((best, candidate) => {
        const distance = Math.abs(new Date(candidate.checked_at).getTime() - actionTime);
        return !best || distance < best.distance ? { candidate, distance } : best;
      }, null);
      if (nearest?.candidate?.player_name) details.players = [nearest.candidate.player_name];
    }

    return { ...row, details };
  });
}

export async function recordActionLog({
  action,
  actorName = 'System',
  details = {},
  supabase = null,
  targetId = '',
  targetName = '',
  targetType = 'webapp',
}) {
  const cleanAction = clean(action);
  if (!cleanAction) throw new Error('Action log action is required.');

  const admin = supabase || createSupabaseAdmin();
  const { data, error } = await admin
    .from('webapp_action_logs')
    .insert({
      action: cleanAction.slice(0, 160),
      actor_name: clean(actorName, 'System').slice(0, 120),
      details: details && typeof details === 'object' ? details : {},
      target_id: clean(targetId).slice(0, 160) || null,
      target_name: clean(targetName).slice(0, 240) || null,
      target_type: clean(targetType, 'webapp').slice(0, 80),
    })
    .select('id,created_at')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteActionLog(actionLogId) {
  const id = Number(actionLogId);
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid action log entry.');
  const admin = createSupabaseAdmin();
  const { error } = await admin.from('webapp_action_logs').delete().eq('id', id);
  if (error) throw error;
  return { deleted: true, id };
}

export async function listActionLogs({ before = '', limit = DEFAULT_PAGE_SIZE } = {}) {
  const admin = createSupabaseAdmin();
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE));
  let query = admin
    .from('webapp_action_logs')
    .select('id,actor_name,action,target_type,target_id,target_name,details,created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1);

  const beforeDate = new Date(before);
  if (before && !Number.isNaN(beforeDate.getTime())) {
    query = query.lt('created_at', beforeDate.toISOString());
  }

  const { count, data, error } = await query;
  if (error) throw error;

  const rows = await enrichActionRows(admin, data || []);
  const hasMore = rows.length > pageSize;
  const visibleRows = rows.slice(0, pageSize);
  return {
    actionLogs: visibleRows.map((row) => ({
      action: row.action,
      actorName: row.actor_name,
      createdAt: row.created_at,
      details: row.details || {},
      id: row.id,
      targetId: row.target_id || '',
      targetName: row.target_name || '',
      targetType: row.target_type,
    })),
    hasMore,
    nextCursor: hasMore ? visibleRows[visibleRows.length - 1]?.created_at || '' : '',
    total: count || 0,
  };
}

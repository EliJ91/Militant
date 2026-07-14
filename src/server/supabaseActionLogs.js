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

  const rows = data || [];
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


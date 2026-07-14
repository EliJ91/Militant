import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

function clean(value: unknown, fallback = '') {
  return String(value || '').trim() || fallback;
}

function bundleTitle(bundle: any) {
  const summary = bundle?.combined_loot_summary || {};
  const fileNames = summary.fileNames || {};
  return clean(summary.discordThreadName || summary.displayLootFileName || fileNames.baseName || fileNames.loot)
    .replace(/\s+(?:Loot|Chest) Log$/i, '');
}

async function enrichActionRows(supabase: any, rows: any[]) {
  const bundleIds = [...new Set(rows
    .map((row) => clean(row.target_id))
    .filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))];
  if (bundleIds.length === 0) return rows;

  const [bundleResult, deathResult] = await Promise.all([
    supabase
      .from('loot_log_bundles')
      .select('id,combined_loot_summary,created_at')
      .order('created_at', { ascending: true }),
    supabase
      .from('loot_log_death_checks')
      .select('bundle_id,player_name,checked_at')
      .in('bundle_id', bundleIds)
      .order('checked_at', { ascending: true }),
  ]);

  if (bundleResult.error) throw bundleResult.error;
  if (deathResult.error) throw deathResult.error;

  const bundleById = new Map((bundleResult.data || []).map((bundle: any, index: number) => [String(bundle.id), {
    logNumber: index + 1,
    lootLogName: bundleTitle(bundle),
  }]));
  const deathsByBundle = new Map<string, any[]>();
  (deathResult.data || []).forEach((deathCheck: any) => {
    const bundleId = String(deathCheck.bundle_id || '');
    if (!deathsByBundle.has(bundleId)) deathsByBundle.set(bundleId, []);
    deathsByBundle.get(bundleId)?.push(deathCheck);
  });

  return rows.map((row: any) => {
    const bundleId = clean(row.target_id);
    const bundle: any = bundleById.get(bundleId);
    const details = { ...(row.details || {}) };
    if (bundle) {
      details.lootLogNumber ||= bundle.logNumber;
      details.lootLogName ||= bundle.lootLogName;
    }

    if (/^Death checks? completed$/i.test(clean(row.action)) && !details.player && !details.players?.length) {
      const actionTime = new Date(row.created_at).getTime();
      const nearest = (deathsByBundle.get(bundleId) || []).reduce((best: any, candidate: any) => {
        const distance = Math.abs(new Date(candidate.checked_at).getTime() - actionTime);
        return !best || distance < best.distance ? { candidate, distance } : best;
      }, null);
      if (nearest?.candidate?.player_name) details.players = [nearest.candidate.player_name];
    }

    return { ...row, details };
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders, status: 204 });
  if (!['GET', 'POST'].includes(request.method)) return jsonResponse(405, { error: 'Method not allowed.' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase server credentials.');
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    if (request.method === 'POST') {
      const body = await request.json();
      const action = String(body.action || '').trim();
      if (!action) throw new Error('Action is required.');
      const { data, error } = await supabase
        .from('webapp_action_logs')
        .insert({
          action: action.slice(0, 160),
          actor_name: String(body.actorName || '').trim().slice(0, 120) || 'Unknown User',
          details: body.details && typeof body.details === 'object' ? body.details : {},
          target_id: String(body.targetId || '').trim().slice(0, 160) || null,
          target_name: String(body.targetName || '').trim().slice(0, 240) || null,
          target_type: String(body.targetType || '').trim().slice(0, 80) || 'webapp',
        })
        .select('id,created_at')
        .single();
      if (error) throw error;
      return jsonResponse(201, { actionLog: data });
    }

    const requestUrl = new URL(request.url);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(requestUrl.searchParams.get('limit')) || DEFAULT_PAGE_SIZE));
    const before = requestUrl.searchParams.get('before') || '';
    let query = supabase
      .from('webapp_action_logs')
      .select('id,actor_name,action,target_type,target_id,target_name,details,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(pageSize + 1);

    const beforeDate = new Date(before);
    if (before && !Number.isNaN(beforeDate.getTime())) query = query.lt('created_at', beforeDate.toISOString());

    const { count, data, error } = await query;
    if (error) throw error;
    const rows = await enrichActionRows(supabase, data || []);
    const hasMore = rows.length > pageSize;
    const visibleRows = rows.slice(0, pageSize);

    return jsonResponse(200, {
      actionLogs: visibleRows.map((row: any) => ({
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
    });
  } catch (error) {
    return jsonResponse(400, { error: error?.message || 'Could not load action logs.' });
  }
});

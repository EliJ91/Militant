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
    const rows = data || [];
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

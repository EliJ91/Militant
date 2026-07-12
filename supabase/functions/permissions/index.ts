import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SETTINGS_ID = 'default';
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

function normalizeSettings(settings: any) {
  return {
    roles: Array.isArray(settings?.roles) ? settings.roles : [],
  };
}

function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase credentials.');
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

async function getPermissionSettings(supabase: any) {
  const { data, error } = await supabase
    .from('webapp_permission_settings')
    .select('settings,updated_at')
    .eq('id', SETTINGS_ID)
    .maybeSingle();

  if (error) throw error;
  if (data) {
    return {
      settings: normalizeSettings(data.settings),
      updatedAt: data.updated_at,
    };
  }

  return updatePermissionSettings(supabase, { roles: [] });
}

async function updatePermissionSettings(supabase: any, settings: any) {
  const normalized = normalizeSettings(settings);
  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('webapp_permission_settings')
    .upsert({
      id: SETTINGS_ID,
      settings: normalized,
      updated_at: updatedAt,
    }, { onConflict: 'id' })
    .select('settings,updated_at')
    .single();

  if (error) throw error;

  return {
    settings: normalizeSettings(data.settings),
    updatedAt: data.updated_at,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders,
      status: 204,
    });
  }

  try {
    const supabase = createSupabaseAdmin();

    if (request.method === 'GET') {
      return jsonResponse(200, await getPermissionSettings(supabase));
    }

    if (request.method === 'PUT') {
      const body = await request.json();
      return jsonResponse(200, await updatePermissionSettings(supabase, body.settings || body));
    }

    return jsonResponse(405, { error: 'Method not allowed.' });
  } catch (error) {
    return jsonResponse(400, { error: error.message || 'Could not update permissions.' });
  }
});

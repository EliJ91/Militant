import { createClient } from '@supabase/supabase-js';

const SETTINGS_ID = 'default';

function createSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase server credentials.');
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function normalizeSettings(settings) {
  return {
    roles: Array.isArray(settings?.roles) ? settings.roles : [],
  };
}

export async function getPermissionSettings() {
  const supabase = createSupabaseAdmin();
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

  const created = await updatePermissionSettings({ roles: [] });
  return created;
}

export async function updatePermissionSettings(settings) {
  const supabase = createSupabaseAdmin();
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

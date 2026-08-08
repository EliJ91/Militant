import { createClient } from '@supabase/supabase-js';

const MAX_BUILDS = 500;
const MASTER_LAYOUT_KEY = 'master';
const SELECT = 'id,title,builds,source_file_name,uploaded_by,created_at,updated_at';

function createSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase server credentials.');
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function clean(value, fallback = '') {
  return String(value || '').trim() || fallback;
}

function normalizePayload(payload = {}) {
  const title = clean(payload.title);
  const uploadedBy = clean(payload.uploadedBy, 'Unknown Server Member');
  const builds = Array.isArray(payload.builds) ? payload.builds : [];
  if (!title) throw new Error('A build title is required.');
  if (title.length > 120) throw new Error('Build titles cannot exceed 120 characters.');
  if (builds.length === 0) throw new Error('A build layout is required.');
  if (builds.length > MAX_BUILDS) throw new Error(`A build layout cannot exceed ${MAX_BUILDS} builds.`);
  return {
    builds,
    source_file_name: clean(payload.sourceFileName).slice(0, 240),
    title,
    uploaded_by: uploadedBy.slice(0, 120),
    updated_at: new Date().toISOString(),
  };
}

function mapLayout(row) {
  return {
    builds: Array.isArray(row.builds) ? row.builds : [],
    createdAt: row.created_at,
    id: row.id,
    sourceFileName: row.source_file_name || '',
    title: row.title,
    updatedAt: row.updated_at,
    uploadedBy: row.uploaded_by,
  };
}

export async function listZvZBuildLayouts() {
  const { data, error } = await createSupabaseAdmin()
    .from('zvz_build_layouts')
    .select(SELECT)
    .eq('singleton_key', MASTER_LAYOUT_KEY)
    .maybeSingle();
  if (error) throw error;
  const layout = data ? mapLayout(data) : null;
  return { layout, layouts: layout ? [layout] : [] };
}

export async function createZvZBuildLayout(payload) {
  const { data, error } = await createSupabaseAdmin()
    .from('zvz_build_layouts')
    .upsert({ ...normalizePayload(payload), singleton_key: MASTER_LAYOUT_KEY }, { onConflict: 'singleton_key' })
    .select(SELECT)
    .single();
  if (error) throw error;
  return { layout: mapLayout(data) };
}

export async function updateZvZBuildLayout(payload) {
  const { data, error } = await createSupabaseAdmin()
    .from('zvz_build_layouts')
    .upsert({ ...normalizePayload(payload), singleton_key: MASTER_LAYOUT_KEY }, { onConflict: 'singleton_key' })
    .select(SELECT)
    .single();
  if (error) throw error;
  return { layout: mapLayout(data) };
}

export async function deleteZvZBuildLayout(id) {
  const layoutId = clean(id);
  if (!layoutId) throw new Error('A saved build is required.');
  const { error } = await createSupabaseAdmin().from('zvz_build_layouts').delete().eq('id', layoutId);
  if (error) throw error;
  return { deleted: true, id: layoutId };
}

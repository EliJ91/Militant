import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_BUILDS = 500;
const DISCORD_GUILD_ID = '805908199541702666';
const MASTER_LAYOUT_KEY = 'master';
const SUPERUSER_DISCORD_USER_IDS = new Set(['264193431830528006']);
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-discord-access-token',
  'Access-Control-Allow-Methods': 'DELETE, GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase server credentials.');
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function clean(value: unknown, fallback = '') {
  return String(value || '').trim() || fallback;
}

function normalizePayload(payload: any = {}) {
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

function mapLayout(row: any) {
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

const SELECT = 'id,title,builds,source_file_name,uploaded_by,created_at,updated_at';

function discordUserIdFromUser(user: any) {
  const metadata = user?.user_metadata || {};
  const identity = Array.isArray(user?.identities)
    ? user.identities.find((entry: any) => entry.provider === 'discord') || user.identities[0]
    : null;
  return clean(
    metadata.discordUserId
      || metadata.discord_user_id
      || metadata.provider_id
      || metadata.sub
      || identity?.identity_data?.sub
      || identity?.identity_data?.provider_id
      || identity?.id,
  );
}

async function getDiscordIdentity(admin: any, request: Request) {
  const accessToken = clean(request.headers.get('authorization')).replace(/^Bearer\s+/i, '');
  const discordAccessToken = clean(request.headers.get('x-discord-access-token'));
  if (!accessToken) throw new Error('Missing authorization token.');

  const { data, error } = await admin.auth.getUser(accessToken);
  let discordUserId = !error ? discordUserIdFromUser(data?.user) : '';
  if (!discordUserId) {
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse.ok) throw new Error('Could not verify Discord user.');
    discordUserId = clean((await userResponse.json())?.id);
  }

  let member: any = null;
  if (discordAccessToken) {
    const oauthResponse = await fetch(`https://discord.com/api/v10/users/@me/guilds/${DISCORD_GUILD_ID}/member`, {
      headers: { Authorization: `Bearer ${discordAccessToken}` },
    });
    if (oauthResponse.ok) {
      const oauthMember = await oauthResponse.json();
      if (!oauthMember?.user?.id || clean(oauthMember.user.id) === discordUserId) member = oauthMember;
    }
  }

  const botToken = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!member && botToken) {
    const botResponse = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (botResponse.ok) member = await botResponse.json();
  }

  if (!member) {
    const memberLookupUrl = clean(Deno.env.get('MEMBER_LOOKUP_URL'));
    const memberLookupSecret = clean(Deno.env.get('MEMBER_LOOKUP_SECRET'));
    if (memberLookupUrl && memberLookupSecret) {
      const workerResponse = await fetch(memberLookupUrl, {
        body: JSON.stringify({ guildId: DISCORD_GUILD_ID, userId: discordUserId }),
        headers: {
          Authorization: `Bearer ${memberLookupSecret}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      if (workerResponse.ok) {
        const workerMember = await workerResponse.json();
        member = {
          nick: clean(workerMember?.guildNickname || workerMember?.serverNickname),
          roles: Array.isArray(workerMember?.roleIds) ? workerMember.roleIds : [],
          user: { id: clean(workerMember?.discordUserId, discordUserId) },
        };
      }
    }
  }

  if (!member && SUPERUSER_DISCORD_USER_IDS.has(discordUserId)) {
    member = { nick: 'Onslawht', roles: [], user: { id: discordUserId } };
  }
  if (!member) throw new Error('Could not load Discord member roles.');
  if (member?.user?.id && clean(member.user.id) !== discordUserId) throw new Error('Discord user mismatch.');
  return {
    discordUserId,
    guildNickname: clean(member?.nick, 'Unknown Server Member'),
    roleIds: Array.isArray(member?.roles) ? member.roles.map(String) : [],
  };
}

async function hasPermission(admin: any, identity: any, permission: string) {
  if (SUPERUSER_DISCORD_USER_IDS.has(identity.discordUserId)) return true;
  const { data, error } = await admin
    .from('webapp_permission_settings')
    .select('settings')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throw error;
  const assignedRoleIds = new Set(identity.roleIds);
  return (data?.settings?.roles || []).some((role: any) => (
    assignedRoleIds.has(clean(role.roleId))
      && Boolean(role.permissions?.[permission]
        || (permission === 'viewZvZBuilds' && role.permissions?.editZvZBuilds))
  ));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders, status: 204 });

  try {
    const admin = createSupabaseAdmin();
    const identity = await getDiscordIdentity(admin, request);
    const requiredPermission = request.method === 'GET' ? 'viewZvZBuilds' : 'editZvZBuilds';
    if (!await hasPermission(admin, identity, requiredPermission)) {
      return jsonResponse(403, { error: 'You do not have permission to access ZvZ builds.' });
    }
    if (request.method === 'GET') {
      const { data, error } = await admin
        .from('zvz_build_layouts')
        .select(SELECT)
        .eq('singleton_key', MASTER_LAYOUT_KEY)
        .maybeSingle();
      if (error) throw error;
      const layout = data ? mapLayout(data) : null;
      return jsonResponse(200, { layout, layouts: layout ? [layout] : [] });
    }

    const body = await request.json();
    body.uploadedBy = identity.guildNickname;
    if (request.method === 'POST' || request.method === 'PUT') {
      const { data, error } = await admin
        .from('zvz_build_layouts')
        .upsert({ ...normalizePayload(body), singleton_key: MASTER_LAYOUT_KEY }, { onConflict: 'singleton_key' })
        .select(SELECT)
        .single();
      if (error) throw error;
      return jsonResponse(request.method === 'POST' ? 201 : 200, { layout: mapLayout(data) });
    }
    if (request.method === 'DELETE') {
      const id = clean(body.id);
      if (!id) throw new Error('A saved build is required.');
      const { error } = await admin.from('zvz_build_layouts').delete().eq('id', id);
      if (error) throw error;
      return jsonResponse(200, { deleted: true, id });
    }
    return jsonResponse(405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('ZvZ builds request failed:', error?.message || String(error));
    return jsonResponse(400, { error: error?.message || 'Could not update ZvZ builds.' });
  }
});

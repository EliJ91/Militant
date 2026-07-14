import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SETTINGS_ID = 'default';
const DISCORD_GUILD_ID = '805908199541702666';
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-discord-access-token',
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

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function getDiscordUserId(user: any) {
  const metadata = user?.user_metadata || {};
  const identity = Array.isArray(user?.identities)
    ? user.identities.find((currentIdentity: any) => currentIdentity.provider === 'discord') || user.identities[0]
    : null;
  const identityData = identity?.identity_data || {};

  return String(
    metadata.discordUserId
      || metadata.discord_user_id
      || metadata.provider_id
      || metadata.providerId
      || metadata.sub
      || identityData.sub
      || identityData.provider_id
      || identity?.id
      || '',
  );
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

async function getDiscordMemberRoles(supabase: any, request: Request) {
  const accessToken = getBearerToken(request);
  if (!accessToken) throw new Error('Missing authorization token.');

  const discordUserId = await getDiscordUserIdFromToken(supabase, accessToken);
  if (!discordUserId) throw new Error('Discord user ID not found.');

  const discordAccessToken = request.headers.get('x-discord-access-token') || '';
  if (discordAccessToken) {
    const oauthMember = await getDiscordMemberFromOAuth(discordAccessToken, discordUserId);
    if (oauthMember) return formatDiscordMember(discordUserId, oauthMember);
  }

  const botToken = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!botToken) throw new Error('Discord bot token is not configured.');

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}`,
    { headers: { Authorization: `Bot ${botToken}` } },
  );

  if (response.status === 404) {
    return { discordGuildId: DISCORD_GUILD_ID, discordUserId, roleIds: [] };
  }

  if (!response.ok) throw new Error('Could not load Discord member roles.');

  return formatDiscordMember(discordUserId, await response.json());
}

async function getDiscordMemberFromOAuth(accessToken: string, expectedUserId: string) {
  const response = await fetch(
    `https://discord.com/api/v10/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) return null;

  const member = await response.json();
  return String(member?.user?.id || '') === expectedUserId ? member : null;
}

function formatDiscordMember(discordUserId: string, member: any) {
  const guildNickname = String(member?.nick || '').trim();
  return {
    discordGuildId: DISCORD_GUILD_ID,
    discordUserId,
    guildNickname,
    serverNickname: guildNickname,
    roleIds: Array.isArray(member?.roles) ? member.roles.map(String) : [],
  };
}

async function getDiscordUserIdFromToken(supabase: any, accessToken: string) {
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (!error) {
    const supabaseDiscordUserId = getDiscordUserId(data?.user);
    if (supabaseDiscordUserId) return supabaseDiscordUserId;
  }

  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    if (error) throw error;
    throw new Error('Could not verify Discord user.');
  }

  const discordUser = await response.json();
  return String(discordUser?.id || '');
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
      const requestUrl = new URL(request.url);
      if (requestUrl.searchParams.get('resource') === 'discord-member-roles') {
        return jsonResponse(200, await getDiscordMemberRoles(supabase, request));
      }

      return jsonResponse(200, await getPermissionSettings(supabase));
    }

    if (request.method === 'PUT') {
      const body = await request.json();
      return jsonResponse(200, await updatePermissionSettings(supabase, body.settings || body));
    }

    return jsonResponse(405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('Permissions request failed:', error?.message || String(error));
    return jsonResponse(400, { error: error.message || 'Could not update permissions.' });
  }
});

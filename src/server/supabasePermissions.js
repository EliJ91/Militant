import { createClient } from '@supabase/supabase-js';

const SETTINGS_ID = 'default';
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '805908199541702666';

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

function getDiscordUserId(user = {}) {
  const metadata = user.user_metadata || user.userMetadata || {};
  const identity = Array.isArray(user.identities)
    ? user.identities.find((currentIdentity) => currentIdentity.provider === 'discord') || user.identities[0]
    : null;
  const identityData = identity?.identity_data || identity?.identityData || {};

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

export async function getDiscordMemberRoles(accessToken) {
  if (!accessToken) throw new Error('Missing authorization token.');

  const supabase = createSupabaseAdmin();
  const discordUserId = await getDiscordUserIdFromToken(supabase, accessToken);
  if (!discordUserId) throw new Error('Discord user ID not found.');

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error('Discord bot token is not configured.');

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}`,
    { headers: { Authorization: `Bot ${botToken}` } },
  );

  if (response.status === 404) {
    return { discordGuildId: DISCORD_GUILD_ID, discordUserId, roleIds: [] };
  }

  if (!response.ok) throw new Error('Could not load Discord member roles.');

  const member = await response.json();
  return {
    discordGuildId: DISCORD_GUILD_ID,
    discordUserId,
    roleIds: Array.isArray(member?.roles) ? member.roles.map(String) : [],
  };
}

async function getDiscordUserIdFromToken(supabase, accessToken) {
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

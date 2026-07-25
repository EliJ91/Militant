import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;
const IGNORED_ACTION_PATTERNS = [
  /^death id add(?:ed|ing)$/i,
  /^death checks? completed$/i,
];
const IGNORED_ACTION_DATABASE_PATTERNS = ['death id add%', 'death check% completed'];
const DISCORD_GUILD_ID = '805908199541702666';
const SUPERUSER_DISCORD_USER_ID = '264193431830528006';
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-discord-access-token',
  'Access-Control-Allow-Methods': 'DELETE, GET, POST, OPTIONS',
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
  return clean(
    metadata.discordUserId
      || metadata.discord_user_id
      || metadata.provider_id
      || metadata.providerId
      || metadata.sub
      || identityData.sub
      || identityData.provider_id
      || identity?.id,
  );
}

async function getDiscordUserIdFromToken(supabase: any, accessToken: string) {
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (!error) {
    const discordUserId = getDiscordUserId(data?.user);
    if (discordUserId) return discordUserId;
  }

  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return '';
  return clean((await response.json())?.id);
}

async function getDiscordUserIdFromOAuth(accessToken: string) {
  if (!accessToken) return '';
  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return '';
  return clean((await response.json())?.id);
}

function discordMemberDisplayName(member: any) {
  return clean(member?.nick || member?.user?.global_name || member?.user?.username);
}

async function getDiscordMemberFromWorker(discordUserId: string) {
  const memberLookupUrl = clean(Deno.env.get('MEMBER_LOOKUP_URL'));
  const memberLookupSecret = clean(Deno.env.get('MEMBER_LOOKUP_SECRET'));
  if (!memberLookupUrl || !memberLookupSecret) return null;

  const response = await fetch(memberLookupUrl, {
    body: JSON.stringify({ guildId: DISCORD_GUILD_ID, userId: discordUserId }),
    headers: {
      Authorization: `Bearer ${memberLookupSecret}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  return response.ok ? await response.json() : null;
}

function fallbackActorName(value: unknown) {
  const actorName = clean(value);
  return !actorName || /^unknown(?:\s+server)?\s+(?:member|user)$/i.test(actorName) ? 'System' : actorName;
}

async function resolveActionActorName(
  supabase: any,
  request: Request,
  requestedActorName: unknown,
  requestedDiscordUserId: unknown,
) {
  const accessToken = getBearerToken(request);
  const discordAccessToken = request.headers.get('x-discord-access-token') || '';
  const authenticatedDiscordUserId = accessToken
    ? await getDiscordUserIdFromToken(supabase, accessToken)
    : await getDiscordUserIdFromOAuth(discordAccessToken);
  const claimedDiscordUserId = clean(requestedDiscordUserId);
  const discordUserId = authenticatedDiscordUserId
    || (/^\d{15,25}$/.test(claimedDiscordUserId) ? claimedDiscordUserId : '');
  if (!discordUserId) return fallbackActorName(requestedActorName);

  if (discordAccessToken) {
    const oauthResponse = await fetch(
      `https://discord.com/api/v10/users/@me/guilds/${DISCORD_GUILD_ID}/member`,
      { headers: { Authorization: `Bearer ${discordAccessToken}` } },
    );
    if (oauthResponse.ok) {
      const oauthName = discordMemberDisplayName(await oauthResponse.json());
      if (oauthName) return oauthName;
    }
  }

  const botToken = Deno.env.get('DISCORD_BOT_TOKEN');
  if (botToken) {
    const memberResponse = await fetch(
      `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    );
    if (memberResponse.ok) {
      const botName = discordMemberDisplayName(await memberResponse.json());
      if (botName) return botName;
    }
  }

  const workerMember = await getDiscordMemberFromWorker(discordUserId).catch(() => null);
  return clean(workerMember?.guildNickname || workerMember?.serverNickname)
    || fallbackActorName(requestedActorName);
}

async function getAuthenticatedDiscordUserId(supabase: any, request: Request) {
  const accessToken = getBearerToken(request);
  const discordAccessToken = request.headers.get('x-discord-access-token') || '';
  const supabaseUserId = accessToken ? await getDiscordUserIdFromToken(supabase, accessToken) : '';
  return supabaseUserId || await getDiscordUserIdFromOAuth(discordAccessToken);
}

function isIgnoredAction(action: unknown) {
  const cleanAction = clean(action);
  return IGNORED_ACTION_PATTERNS.some((pattern) => pattern.test(cleanAction));
}

async function purgeIgnoredActionLogs(supabase: any) {
  const results = await Promise.all(IGNORED_ACTION_DATABASE_PATTERNS.map((pattern) => (
    supabase.from('webapp_action_logs').delete().ilike('action', pattern)
  )));
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders, status: 204 });
  if (!['DELETE', 'GET', 'POST'].includes(request.method)) return jsonResponse(405, { error: 'Method not allowed.' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase server credentials.');
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    if (request.method === 'DELETE') {
      const discordUserId = await getAuthenticatedDiscordUserId(supabase, request);
      if (discordUserId !== SUPERUSER_DISCORD_USER_ID) return jsonResponse(403, { error: 'SuperUser access required.' });
      const body = await request.json();
      const id = Number(body.id);
      if (!Number.isInteger(id) || id < 1) return jsonResponse(400, { error: 'Invalid action log entry.' });
      const { error } = await supabase.from('webapp_action_logs').delete().eq('id', id);
      if (error) throw error;
      return jsonResponse(200, { deleted: true, id });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const action = String(body.action || '').trim();
      if (!action) throw new Error('Action is required.');
      if (isIgnoredAction(action)) return jsonResponse(202, { ignored: true });
      const actorName = await resolveActionActorName(supabase, request, body.actorName, body.discordUserId);
      const { data, error } = await supabase
        .from('webapp_action_logs')
        .insert({
          action: action.slice(0, 160),
          actor_name: actorName.slice(0, 120),
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
    await purgeIgnoredActionLogs(supabase);
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

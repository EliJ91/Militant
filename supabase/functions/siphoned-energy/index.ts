import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAGE_SIZE = 1000;
const INSERT_SIZE = 500;
const MILITANT_GUILD_ID = 'HNWzt1KSQMSQ855Q9rLvSA';
const GUILD_REFRESH_MS = 72 * 60 * 60 * 1000;
const GUILD_MEMBERS_URL = `https://gameinfo.albiononline.com/api/gameinfo/guilds/${MILITANT_GUILD_ID}/members`;
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

function parseDelimited(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (character === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === '\t') {
      row.push(value);
      value = '';
    } else if (character === '\n' || character === '\r') {
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = '';
      if (character === '\r' && next === '\n') index += 1;
    } else {
      value += character;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function normalizeDate(value: unknown) {
  const match = String(value || '').trim().match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) return '';

  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second),
  ));
  const valid = date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
    && date.getUTCHours() === Number(hour)
    && date.getUTCMinutes() === Number(minute)
    && date.getUTCSeconds() === Number(second);
  return valid ? `${year}-${month}-${day}T${hour}:${minute}:${second}` : '';
}

function parseLog(text: string) {
  const rows = parseDelimited(String(text || '').trim());
  if (rows.length === 0) throw new Error('Paste a Siphoned Energy log before updating.');

  const expected = ['Date', 'Player', 'Reason', 'Amount'];
  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, '').trim());
  if (expected.some((header, index) => headers[index] !== header)) {
    throw new Error('The log must contain Date, Player, Reason, and Amount columns.');
  }

  const transactions: any[] = [];
  const skippedRows: number[] = [];
  rows.slice(1).forEach((row, index) => {
    const occurredAt = normalizeDate(row[0]);
    const player = String(row[1] || '').trim();
    const rawReason = String(row[2] || '').trim().toLowerCase();
    const reason = rawReason === 'deposit' ? 'Deposit'
      : rawReason === 'withdrawal' ? 'Withdrawal'
        : '';
    const rawAmount = String(row[3] || '').trim();
    const amount = /^-?\d+$/.test(rawAmount) ? Number(rawAmount) : 0;
    const signedAmount = reason === 'Withdrawal' ? -Math.abs(amount) : Math.abs(amount);

    if (!occurredAt || !player || !reason || !Number.isSafeInteger(amount) || amount === 0) {
      skippedRows.push(index + 2);
      return;
    }
    transactions.push({ amount: signedAmount, occurredAt, player, reason });
  });

  if (transactions.length === 0) {
    throw new Error('The pasted log does not contain any valid Siphoned Energy transactions.');
  }
  return { skippedRows, transactions };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function mapTransaction(row: any) {
  return {
    amount: row.amount,
    id: row.id,
    occurredAt: row.occurred_at,
    player: row.player_name,
    reason: row.reason,
  };
}

function normalizePlayerName(value: unknown) {
  return String(value || '').trim();
}

async function listStarredPlayers(supabase: any) {
  const { data, error } = await supabase
    .from('siphoned_energy_starred_players')
    .select('player_name')
    .eq('starred', true)
    .order('player_name');

  if (error) throw error;
  return (data || []).map((row: any) => row.player_name);
}

async function fetchGuildMemberNames() {
  const response = await fetch(GUILD_MEMBERS_URL);
  if (!response.ok) throw new Error('Could not load Militant guild members.');
  const members = await response.json();
  return [...new Map((Array.isArray(members) ? members : [])
    .map((member: any) => normalizePlayerName(member.Name))
    .filter(Boolean)
    .map((name: string) => [name.toLowerCase(), name])).values()];
}

async function listGuildMemberPlayers(supabase: any) {
  const { data: cachedRows, error: cacheError } = await supabase
    .from('siphoned_energy_guild_members')
    .select('player_name,refreshed_at')
    .eq('guild_id', MILITANT_GUILD_ID)
    .order('player_name');

  if (cacheError) throw cacheError;

  const latestRefresh = (cachedRows || []).reduce((latest: number, row: any) => {
    const refreshedAt = new Date(row.refreshed_at).getTime();
    return Number.isFinite(refreshedAt) && refreshedAt > latest ? refreshedAt : latest;
  }, 0);
  if (cachedRows?.length && Date.now() - latestRefresh < GUILD_REFRESH_MS) {
    return cachedRows.map((row: any) => row.player_name);
  }

  let names: string[] = [];
  try {
    names = await fetchGuildMemberNames();
  } catch (error) {
    if (cachedRows?.length) return cachedRows.map((row: any) => row.player_name);
    throw error;
  }
  const refreshedAt = new Date().toISOString();

  const { error: deleteError } = await supabase
    .from('siphoned_energy_guild_members')
    .delete()
    .eq('guild_id', MILITANT_GUILD_ID);
  if (deleteError) throw deleteError;

  if (names.length > 0) {
    const { error: insertError } = await supabase
      .from('siphoned_energy_guild_members')
      .insert(names.map((name: string) => ({
        guild_id: MILITANT_GUILD_ID,
        player_key: name.toLowerCase(),
        player_name: name,
        refreshed_at: refreshedAt,
      })));
    if (insertError) throw insertError;
  }

  return names;
}

async function listTransactions(supabase: any) {
  const transactions: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('siphoned_energy_transactions')
      .select('id,occurred_at,player_name,reason,amount')
      .order('occurred_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    transactions.push(...(data || []).map(mapTransaction));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return transactions;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders, status: 204 });
  if (!['GET', 'POST', 'PATCH'].includes(request.method)) {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase server credentials.');
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    if (request.method === 'GET') {
      return jsonResponse(200, {
        guildMemberPlayers: await listGuildMemberPlayers(supabase),
        starredPlayers: await listStarredPlayers(supabase),
        transactions: await listTransactions(supabase),
      });
    }

    if (request.method === 'PATCH') {
      const body = await request.json();
      const playerName = normalizePlayerName(body.player);
      if (!playerName) throw new Error('player is required.');

      const { error } = await supabase
        .from('siphoned_energy_starred_players')
        .upsert({
          player_name: playerName,
          player_key: playerName.toLowerCase(),
          starred: Boolean(body.starred),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'player_key' });

      if (error) throw error;

      return jsonResponse(200, {
        guildMemberPlayers: await listGuildMemberPlayers(supabase),
        player: playerName,
        starred: Boolean(body.starred),
        starredPlayers: await listStarredPlayers(supabase),
      });
    }

    const body = await request.json();
    const parsed = parseLog(body.logText);
    const hashedRows = await Promise.all(parsed.transactions.map(async (transaction) => {
      const key = [
        transaction.occurredAt,
        transaction.player.trim().toLowerCase(),
        transaction.reason,
        transaction.amount,
      ].join('|');
      return {
        amount: transaction.amount,
        event_hash: await sha256(key),
        occurred_at: transaction.occurredAt,
        player_name: transaction.player,
        reason: transaction.reason,
      };
    }));
    const uniqueRows = [...new Map(hashedRows.map((row) => [row.event_hash, row])).values()];
    let insertedRows = 0;

    for (let index = 0; index < uniqueRows.length; index += INSERT_SIZE) {
      const { data, error } = await supabase
        .from('siphoned_energy_transactions')
        .upsert(uniqueRows.slice(index, index + INSERT_SIZE), {
          ignoreDuplicates: true,
          onConflict: 'event_hash',
        })
        .select('id');
      if (error) throw error;
      insertedRows += data?.length || 0;
    }

    return jsonResponse(200, {
      duplicateRows: uniqueRows.length - insertedRows,
      guildMemberPlayers: await listGuildMemberPlayers(supabase),
      insertedRows,
      skippedRows: parsed.skippedRows,
      starredPlayers: await listStarredPlayers(supabase),
      transactions: await listTransactions(supabase),
    });
  } catch (error) {
    return jsonResponse(400, { error: error?.message || 'Could not update Siphoned Energy transactions.' });
  }
});

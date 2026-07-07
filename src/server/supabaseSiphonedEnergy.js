import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { parseSiphonedEnergyLog } from '../utils/siphonedEnergy.js';

const PAGE_SIZE = 1000;
const INSERT_SIZE = 500;
const MILITANT_GUILD_ID = 'HNWzt1KSQMSQ855Q9rLvSA';
const GUILD_REFRESH_MS = 72 * 60 * 60 * 1000;
const GUILD_MEMBERS_URL = `https://gameinfo.albiononline.com/api/gameinfo/guilds/${MILITANT_GUILD_ID}/members`;

function createSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase server credentials.');
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function eventHash(transaction) {
  const key = [
    transaction.occurredAt,
    transaction.player.trim().toLowerCase(),
    transaction.reason,
    transaction.amount,
  ].join('|');
  return crypto.createHash('sha256').update(key).digest('hex');
}

function mapTransaction(row) {
  return {
    amount: row.amount,
    id: row.id,
    occurredAt: row.occurred_at,
    player: row.player_name,
    reason: row.reason,
  };
}

function normalizePlayerName(value) {
  return String(value || '').trim();
}

function parsePurgeDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('A valid purge date is required.');

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const valid = date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day);
  if (!valid) throw new Error('A valid purge date is required.');

  const cutoff = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1));
  return cutoff.toISOString().slice(0, 19);
}

async function listStarredPlayers(supabase) {
  const { data, error } = await supabase
    .from('siphoned_energy_starred_players')
    .select('player_name')
    .eq('starred', true)
    .order('player_name');

  if (error) throw error;
  return (data || []).map((row) => row.player_name);
}

async function fetchGuildMemberNames() {
  const response = await fetch(GUILD_MEMBERS_URL);
  if (!response.ok) throw new Error('Could not load Militant guild members.');
  const members = await response.json();
  return [...new Map((Array.isArray(members) ? members : [])
    .map((member) => normalizePlayerName(member.Name))
    .filter(Boolean)
    .map((name) => [name.toLowerCase(), name])).values()];
}

async function listGuildMemberPlayers(supabase) {
  const { data: cachedRows, error: cacheError } = await supabase
    .from('siphoned_energy_guild_members')
    .select('player_name,refreshed_at')
    .eq('guild_id', MILITANT_GUILD_ID)
    .order('player_name');

  if (cacheError) throw cacheError;

  const latestRefresh = (cachedRows || []).reduce((latest, row) => {
    const refreshedAt = new Date(row.refreshed_at).getTime();
    return Number.isFinite(refreshedAt) && refreshedAt > latest ? refreshedAt : latest;
  }, 0);
  if (cachedRows?.length && Date.now() - latestRefresh < GUILD_REFRESH_MS) {
    return cachedRows.map((row) => row.player_name);
  }

  let names = [];
  try {
    names = await fetchGuildMemberNames();
  } catch (error) {
    if (cachedRows?.length) return cachedRows.map((row) => row.player_name);
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
      .insert(names.map((name) => ({
        guild_id: MILITANT_GUILD_ID,
        player_key: name.toLowerCase(),
        player_name: name,
        refreshed_at: refreshedAt,
      })));
    if (insertError) throw insertError;
  }

  return names;
}

export async function listSiphonedEnergyTransactions() {
  const supabase = createSupabaseAdmin();
  const transactions = [];

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

  return {
    guildMemberPlayers: await listGuildMemberPlayers(supabase),
    starredPlayers: await listStarredPlayers(supabase),
    transactions,
  };
}

export async function updateSiphonedEnergyPlayerStar({ player, starred }) {
  const playerName = normalizePlayerName(player);
  if (!playerName) throw new Error('player is required.');

  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from('siphoned_energy_starred_players')
    .upsert({
      player_name: playerName,
      player_key: playerName.toLowerCase(),
      starred: Boolean(starred),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'player_key' });

  if (error) throw error;

  return {
    player: playerName,
    starred: Boolean(starred),
    guildMemberPlayers: await listGuildMemberPlayers(supabase),
    starredPlayers: await listStarredPlayers(supabase),
  };
}

export async function purgeSiphonedEnergyTransactions(date) {
  const cutoff = parsePurgeDate(date);
  const supabase = createSupabaseAdmin();
  const { count, data, error } = await supabase
    .from('siphoned_energy_transactions')
    .delete({ count: 'exact' })
    .lt('occurred_at', cutoff)
    .select('id');

  if (error) throw error;

  return {
    ...(await listSiphonedEnergyTransactions()),
    deletedRows: count ?? data?.length ?? 0,
    purgeDate: String(date || ''),
  };
}

export async function importSiphonedEnergyTransactions(logText) {
  const parsed = parseSiphonedEnergyLog(logText);
  const uniqueRows = [...new Map(parsed.transactions.map((transaction) => {
    const hash = eventHash(transaction);
    return [hash, {
      amount: transaction.amount,
      event_hash: hash,
      occurred_at: transaction.occurredAt,
      player_name: transaction.player,
      reason: transaction.reason,
    }];
  })).values()];
  const supabase = createSupabaseAdmin();
  let inserted = 0;

  for (let index = 0; index < uniqueRows.length; index += INSERT_SIZE) {
    const { data, error } = await supabase
      .from('siphoned_energy_transactions')
      .upsert(uniqueRows.slice(index, index + INSERT_SIZE), {
        ignoreDuplicates: true,
        onConflict: 'event_hash',
      })
      .select('id');
    if (error) throw error;
    inserted += data?.length || 0;
  }

  return {
    ...(await listSiphonedEnergyTransactions()),
    duplicateRows: uniqueRows.length - inserted,
    insertedRows: inserted,
    skippedRows: parsed.skippedRows,
  };
}

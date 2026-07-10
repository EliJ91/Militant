import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { parseSiphonedEnergyLog } from '../utils/siphonedEnergy.js';

const PAGE_SIZE = 1000;
const INSERT_SIZE = 500;
const MILITANT_GUILD_ID = 'HNWzt1KSQMSQ855Q9rLvSA';
const GUILD_REFRESH_MS = 72 * 60 * 60 * 1000;
const GUILD_MEMBERS_URL = `https://gameinfo.albiononline.com/api/gameinfo/guilds/${MILITANT_GUILD_ID}/members`;
const GUILD_MEMBER_SELECT = 'id,player_name,player_key,player_id,pvp_kill_fame,pve_kill_fame,death_fame,pvp_death_fame_ratio,refreshed_at,created_at';

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

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function fameRatio(pvpKillFame, deathFame) {
  if (deathFame <= 0) return null;
  return Number((pvpKillFame / deathFame).toFixed(2));
}

function mapGuildApiMember(member) {
  const playerName = normalizePlayerName(member?.Name);
  const pvpKillFame = numberValue(member?.KillFame);
  const deathFame = numberValue(member?.DeathFame);

  return {
    deathFame,
    playerId: String(member?.Id || '').trim(),
    playerKey: playerName.toLowerCase(),
    playerName,
    pveKillFame: numberValue(member?.LifetimeStatistics?.PvE?.Total),
    pvpDeathFameRatio: fameRatio(pvpKillFame, deathFame),
    pvpKillFame,
  };
}

function mapGuildMemberRow(row) {
  return {
    dateAdded: row.created_at,
    deathFame: numberValue(row.death_fame),
    id: row.id,
    playerId: row.player_id || '',
    playerKey: row.player_key || normalizePlayerName(row.player_name).toLowerCase(),
    playerName: row.player_name,
    pveKillFame: numberValue(row.pve_kill_fame),
    pvpDeathFameRatio: row.pvp_death_fame_ratio === null || row.pvp_death_fame_ratio === undefined
      ? null
      : Number(row.pvp_death_fame_ratio),
    pvpKillFame: numberValue(row.pvp_kill_fame),
    refreshedAt: row.refreshed_at,
  };
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

async function fetchGuildMembers() {
  const response = await fetch(GUILD_MEMBERS_URL);
  if (!response.ok) throw new Error('Could not load Militant guild members.');
  const members = await response.json();
  return [...new Map((Array.isArray(members) ? members : [])
    .map(mapGuildApiMember)
    .filter((member) => member.playerName)
    .map((member) => [member.playerKey, member])).values()]
    .sort((left, right) => left.playerName.localeCompare(right.playerName));
}

async function readCachedGuildMembers(supabase) {
  const { data: cachedRows, error: cacheError } = await supabase
    .from('siphoned_energy_guild_members')
    .select(GUILD_MEMBER_SELECT)
    .eq('guild_id', MILITANT_GUILD_ID)
    .order('player_name');

  if (cacheError) throw cacheError;
  return (cachedRows || []).map(mapGuildMemberRow);
}

async function listGuildMembers(supabase) {
  const cachedMembers = await readCachedGuildMembers(supabase);

  const latestRefresh = cachedMembers.reduce((latest, row) => {
    const refreshedAt = new Date(row.refreshedAt).getTime();
    return Number.isFinite(refreshedAt) && refreshedAt > latest ? refreshedAt : latest;
  }, 0);
  if (cachedMembers.length && Date.now() - latestRefresh < GUILD_REFRESH_MS) {
    return cachedMembers;
  }

  let members = [];
  try {
    members = await fetchGuildMembers();
  } catch (error) {
    if (cachedMembers.length) return cachedMembers;
    throw error;
  }
  if (members.length === 0 && cachedMembers.length) return cachedMembers;
  const refreshedAt = new Date().toISOString();
  const memberKeys = new Set(members.map((member) => member.playerKey));
  const staleIds = cachedMembers
    .filter((member) => member.id && !memberKeys.has(member.playerKey))
    .map((member) => member.id);

  if (members.length > 0) {
    const { error: upsertError } = await supabase
      .from('siphoned_energy_guild_members')
      .upsert(members.map((member) => ({
        death_fame: member.deathFame,
        guild_id: MILITANT_GUILD_ID,
        player_id: member.playerId,
        player_key: member.playerKey,
        player_name: member.playerName,
        pve_kill_fame: member.pveKillFame,
        pvp_death_fame_ratio: member.pvpDeathFameRatio,
        pvp_kill_fame: member.pvpKillFame,
        refreshed_at: refreshedAt,
        updated_at: refreshedAt,
      })), { onConflict: 'guild_id,player_key' });
    if (upsertError) throw upsertError;
  }

  if (staleIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('siphoned_energy_guild_members')
      .delete()
      .in('id', staleIds);
    if (deleteError) throw deleteError;
  }

  return readCachedGuildMembers(supabase);
}

async function listGuildMemberPlayers(supabase) {
  const members = await listGuildMembers(supabase);
  return members.map((member) => member.playerName);
}

export async function listSiphonedEnergyGuildMembers() {
  const supabase = createSupabaseAdmin();
  return {
    members: await listGuildMembers(supabase),
  };
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

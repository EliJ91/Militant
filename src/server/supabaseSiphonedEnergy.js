import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { parseSiphonedEnergyLog } from '../utils/siphonedEnergy.js';

const PAGE_SIZE = 1000;
const INSERT_SIZE = 500;

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

async function listStarredPlayers(supabase) {
  const { data, error } = await supabase
    .from('siphoned_energy_starred_players')
    .select('player_name')
    .eq('starred', true)
    .order('player_name');

  if (error) throw error;
  return (data || []).map((row) => row.player_name);
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
    starredPlayers: await listStarredPlayers(supabase),
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

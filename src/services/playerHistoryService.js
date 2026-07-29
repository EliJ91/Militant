import { fetchLootLogPlayerHistory } from './lootLogApi';
import { fetchSiphonedEnergyMembers } from './siphonedEnergyApi';
import { buildPlayerHistory, createPlayerHistoryRecord } from '../utils/playerHistory';

export { buildPlayerHistory } from '../utils/playerHistory';

export async function fetchPlayerHistory() {
  const [memberResult, historyResult] = await Promise.all([
    fetchSiphonedEnergyMembers(),
    fetchLootLogPlayerHistory(),
  ]);

  const members = Array.isArray(memberResult?.members) ? memberResult.members : [];
  const players = Array.isArray(historyResult?.players) ? [...historyResult.players] : [];
  const playersByKey = new Map(players.map((player) => [String(player.playerKey || '').toLowerCase(), player]));
  members.forEach((member) => {
    const playerName = String(member?.playerName || '').trim();
    const playerKey = playerName.toLowerCase();
    if (!playerKey || playersByKey.has(playerKey)) return;
    const player = createPlayerHistoryRecord({ playerId: member.playerId || '', playerName });
    players.push(player);
    playersByKey.set(playerKey, player);
  });
  return {
    players,
    updatedAt: historyResult?.updatedAt || new Date().toISOString(),
  };
}

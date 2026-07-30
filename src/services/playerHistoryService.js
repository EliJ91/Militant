import { fetchLootLogPlayerHistory } from './lootLogApi';
import { buildPlayerHistory } from '../utils/playerHistory';

export { buildPlayerHistory } from '../utils/playerHistory';

export async function fetchPlayerHistory() {
  const historyResult = await fetchLootLogPlayerHistory();
  return {
    players: Array.isArray(historyResult?.players) ? historyResult.players : [],
    updatedAt: historyResult?.updatedAt || new Date().toISOString(),
  };
}

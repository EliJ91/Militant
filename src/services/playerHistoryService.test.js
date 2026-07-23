import { describe, expect, it } from 'vitest';
import { buildPlayerHistory } from './playerHistoryService';

describe('player history service', () => {
  it('aggregates loot statistics and excludes non-members', () => {
    const players = buildPlayerHistory([
      { playerId: 'member-1', playerName: 'MilitantOne' },
      { playerId: 'member-2', playerName: 'MilitantTwo' },
    ], [
      {
        startAt: '2026-07-01T20:00:00.000Z',
        summary: { rows: [
          { itemId: 'T6_SWORD', kept: 3, looted: 5, lost: 2, player: 'militantone' },
          { itemId: 'T7_ARMOR', kept: 4, looted: 4, lost: 0, player: 'FormerMember' },
        ] },
      },
      {
        startAt: '2026-07-03T20:00:00.000Z',
        summary: { rows: [
          { itemId: 'T6_SWORD', kept: 1, looted: 1, lost: 0, player: 'MilitantOne' },
          { itemId: 'T8_BAG', kept: 2, looted: 2, lost: 0, player: 'MilitantOne' },
        ] },
      },
    ]);

    expect(players).toHaveLength(2);
    expect(players.find((player) => player.playerName === 'MilitantOne')).toMatchObject({
      averageItemsKeptPerCta: 3,
      averageItemsLootedPerCta: 4,
      ctaCount: 2,
      itemsKept: 6,
      itemsLooted: 8,
      itemsLost: 2,
      uniqueItemsLooted: 2,
    });
    expect(players.some((player) => player.playerName === 'FormerMember')).toBe(false);
  });
});

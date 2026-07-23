import { describe, expect, it } from 'vitest';
import { buildPlayerHistory } from './playerHistoryService';

describe('player history service', () => {
  it('aggregates loot statistics for current and former Militant members', () => {
    const players = buildPlayerHistory([
      { playerId: 'member-1', playerName: 'MilitantOne' },
      { playerId: 'member-2', playerName: 'MilitantTwo' },
    ], [
      {
        id: 'cta-one',
        hasChestLog: true,
        lootFileName: '20UTC-JUL-01',
        startAt: '2026-07-01T20:00:00.000Z',
        summary: { rows: [
          { itemId: 'T6_SWORD', kept: 3, looted: 5, lost: 2, player: 'militantone' },
          { guild: 'Militant', itemId: 'T7_ARMOR', kept: 4, looted: 4, lost: 0, player: 'FormerMember' },
          { guild: 'Other Guild', itemId: 'T8_CAPE', kept: 9, looted: 9, lost: 0, player: 'NeverAMember' },
        ] },
      },
      {
        id: 'cta-two',
        hasChestLog: true,
        lootFileName: '20UTC-JUL-03',
        startAt: '2026-07-03T20:00:00.000Z',
        summary: { rows: [
          { itemId: 'T6_SWORD', kept: 1, looted: 1, lost: 0, player: 'MilitantOne' },
          { itemId: 'T8_BAG', kept: 2, looted: 2, lost: 0, player: 'MilitantOne' },
        ] },
      },
      {
        id: 'cta-without-chest',
        hasChestLog: false,
        lootFileName: '20UTC-JUL-05',
        startAt: '2026-07-05T20:00:00.000Z',
        summary: { rows: [
          { itemId: 'T8_MAIN_SWORD', kept: 10, looted: 10, lost: 0, player: 'MilitantOne' },
        ] },
      },
    ]);

    expect(players).toHaveLength(3);
    expect(players.find((player) => player.playerName === 'MilitantOne')).toMatchObject({
      averageItemsKeptPerCta: 3,
      averageItemsLootedPerCta: 6,
      ctaCount: 3,
      ctaCountWithChestLog: 2,
      itemsKept: 6,
      itemsLooted: 18,
      itemsLost: 2,
    });
    expect(players.find((player) => player.playerName === 'MilitantOne').ctas).toEqual([
      expect.objectContaining({
        bundleId: 'cta-two',
        lootLogTitle: '20UTC-JUL-03',
        itemsKept: [
          expect.objectContaining({ itemId: 'T8_BAG', quantity: 2 }),
          expect.objectContaining({ itemId: 'T6_SWORD', quantity: 1 }),
        ],
      }),
      expect.objectContaining({
        bundleId: 'cta-one',
        lootLogTitle: '20UTC-JUL-01',
        itemsKept: [expect.objectContaining({ itemId: 'T6_SWORD', quantity: 3 })],
      }),
    ]);
    expect(players.find((player) => player.playerName === 'FormerMember')).toMatchObject({
      ctaCount: 1,
      itemsKept: 4,
      itemsLooted: 4,
    });
    expect(players.some((player) => player.playerName === 'NeverAMember')).toBe(false);
  });
});

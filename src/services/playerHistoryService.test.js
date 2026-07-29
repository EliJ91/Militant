import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLootLogPlayerHistory } from './lootLogApi';
import { buildPlayerHistory, fetchPlayerHistory } from './playerHistoryService';
import { fetchSiphonedEnergyMembers } from './siphonedEnergyApi';

vi.mock('./lootLogApi', () => ({
  fetchLootLogPlayerHistory: vi.fn(),
}));

vi.mock('./siphonedEnergyApi', () => ({
  fetchSiphonedEnergyMembers: vi.fn(),
}));

describe('player history service', () => {
  beforeEach(() => vi.clearAllMocks());

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
        finalizedRows: [
          { enchantment: 0, item: 'Sword', itemId: 'T6_SWORD', kept: 1, player: 'MilitantOne' },
          { enchantment: 0, guild: 'Militant', item: 'Armor', itemId: 'T7_ARMOR', kept: 4, player: 'FormerMember' },
        ],
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
        finalizedRows: [
          { enchantment: 0, item: 'Bag', itemId: 'T8_BAG', kept: 2, player: 'MilitantOne' },
        ],
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
      averageItemsLootedPerCta: 6,
      ctaCount: 3,
      itemsKept: 3,
      itemsLooted: 18,
      itemsLost: 2,
    });
    expect(players.find((player) => player.playerName === 'MilitantOne').ctas).toEqual([
      expect.objectContaining({
        bundleId: 'cta-two',
        lootLogTitle: '20UTC-JUL-03',
        itemsKept: [
          expect.objectContaining({ itemId: 'T8_BAG', quantity: 2 }),
        ],
      }),
      expect.objectContaining({
        bundleId: 'cta-one',
        lootLogTitle: '20UTC-JUL-01',
        itemsKept: [expect.objectContaining({ itemId: 'T6_SWORD', quantity: 1 })],
      }),
    ]);
    expect(players.find((player) => player.playerName === 'FormerMember')).toMatchObject({
      ctaCount: 1,
      itemsKept: 4,
      itemsLooted: 4,
    });
    expect(players.some((player) => player.playerName === 'NeverAMember')).toBe(false);
  });

  it('uses the finalized rows stored with the bundle summary', async () => {
    fetchSiphonedEnergyMembers.mockResolvedValue({
      members: [{ playerId: 'member-1', playerName: 'MilitantOne' }],
    });
    fetchLootLogPlayerHistory.mockResolvedValue({
      players: [{
        averageItemsLootedPerCta: 2,
        ctaCount: 1,
        ctas: [{ itemsKept: [{ itemId: 'T4_CAPE', quantity: 1 }] }],
        itemsKept: 1,
        itemsLooted: 2,
        itemsLost: 0,
        playerKey: 'militantone',
        playerName: 'MilitantOne',
      }],
      updatedAt: '2026-07-20T21:00:00.000Z',
    });

    const result = await fetchPlayerHistory();

    expect(fetchLootLogPlayerHistory).toHaveBeenCalledTimes(1);
    expect(result.players[0]).toMatchObject({
      averageItemsLootedPerCta: 2,
      ctaCount: 1,
      itemsKept: 1,
      itemsLooted: 2,
      itemsLost: 0,
    });
    expect(result.players[0].ctas[0].itemsKept).toEqual([
      expect.objectContaining({ itemId: 'T4_CAPE', quantity: 1 }),
    ]);
  });

  it('does not count kept items when a linked chest log has no comparable chest entries', async () => {
    fetchSiphonedEnergyMembers.mockResolvedValue({
      members: [{ playerId: 'member-1', playerName: 'MilitantOne' }],
    });
    fetchLootLogPlayerHistory.mockResolvedValue({
      players: [{
        averageItemsLootedPerCta: 2,
        ctaCount: 1,
        ctas: [],
        itemsKept: 0,
        itemsLooted: 2,
        itemsLost: 0,
        playerKey: 'militantone',
        playerName: 'MilitantOne',
      }],
    });
    const result = await fetchPlayerHistory();

    expect(result.players[0]).toMatchObject({
      itemsKept: 0,
      itemsLooted: 2,
    });
    expect(result.players[0].ctas).toEqual([]);
  });
});

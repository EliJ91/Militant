import { describe, expect, it } from 'vitest';
import {
  collectGlobalHiddenPlayers,
  deathMatchesBundle,
  getBundleDisplayChestFileName,
  getBundleDisplayLootFileName,
  getBundleFileNames,
  mergeLootLogDeathChecks,
  normalizeDeathCheckRanges,
  sortLootLogBundlesChronologically,
  validateDeathForPlayerAndBundle,
} from './supabaseLootLogs.js';

describe('collectGlobalHiddenPlayers', () => {
  it('combines hidden players from every loot log into one normalized global list', () => {
    expect(collectGlobalHiddenPlayers([
      { combined_loot_summary: { hiddenPlayers: ['PlayerOne', ' playerTwo '] } },
      { combined_loot_summary: { hiddenPlayers: ['PLAYERONE', 'PlayerThree'] } },
      { combined_loot_summary: {} },
    ])).toEqual(['playerone', 'playerthree', 'playertwo']);
  });
});

describe('getBundleFileNames', () => {
  it('keeps the original bundle title when merged events change the time range', () => {
    const bundle = {
      start_at: '2026-06-18T18:00:00.000Z',
      combined_loot_summary: {
        fileNames: {
          baseName: 'Original CTA Title',
          chest: 'Original CTA Title Chest Log',
          loot: 'Original CTA Title Loot Log',
        },
      },
    };

    expect(getBundleFileNames(bundle, '2026-06-18T16:30:00.000Z')).toEqual({
      baseName: 'Original CTA Title',
      chest: 'Original CTA Title Chest Log',
      loot: 'Original CTA Title Loot Log',
    });
  });

  it('generates a UTC title for a new bundle without a stored title', () => {
    expect(getBundleFileNames({}, '2026-06-18T18:00:00.000Z')).toEqual({
      baseName: '18UTC-JUN-18',
      chest: '18UTC-JUN-18 Chest Log',
      loot: '18UTC-JUN-18 Loot Log',
    });
  });

  it('uses the original uploaded filename and keeps it through later merges', () => {
    const newBundle = { start_at: '2026-06-18T18:00:00.000Z' };
    expect(getBundleDisplayLootFileName(newBundle, 'C:\\logs\\loot-events-original.txt'))
      .toBe('loot-events-original');

    const mergedBundle = {
      ...newBundle,
      combined_loot_summary: { displayLootFileName: 'loot-events-original' },
    };
    expect(getBundleDisplayLootFileName(mergedBundle, 'later-merged-file.txt'))
      .toBe('loot-events-original');
  });

  it('uses an edited display title instead of later uploaded filenames', () => {
    const bundle = {
      combined_loot_summary: {
        displayLootFileName: 'Custom Raid Loot Log',
        fileNames: { loot: 'Custom Raid Loot Log' },
      },
    };

    expect(getBundleDisplayLootFileName(bundle, 'later-merged-file.txt'))
      .toBe('Custom Raid');
    expect(getBundleDisplayChestFileName(bundle)).toBe('Custom Raid');
  });
});

describe('merged bundle death ranges', () => {
  const bundle = {
    combined_loot_summary: {
      deathCheckRanges: [
        { startAt: '2026-06-18T13:00:00.000Z', endAt: '2026-06-18T15:00:00.000Z' },
        { startAt: '2026-06-18T17:00:00.000Z', endAt: '2026-06-18T19:00:00.000Z' },
      ],
    },
    end_at: '2026-06-18T19:00:00.000Z',
    start_at: '2026-06-18T13:00:00.000Z',
  };

  it('checks deaths inside either source log window', () => {
    expect(deathMatchesBundle({ TimeStamp: '2026-06-18T14:00:00.000Z' }, bundle)).toBe(true);
    expect(deathMatchesBundle({ TimeStamp: '2026-06-18T18:00:00.000Z' }, bundle)).toBe(true);
  });

  it('does not check deaths in a gap between source logs', () => {
    expect(deathMatchesBundle({ TimeStamp: '2026-06-18T16:00:00.000Z' }, bundle)).toBe(false);
  });

  it('merges overlapping windows while preserving gaps', () => {
    expect(normalizeDeathCheckRanges([
      { startAt: '2026-06-18T13:00:00.000Z', endAt: '2026-06-18T15:00:00.000Z' },
      { startAt: '2026-06-18T14:30:00.000Z', endAt: '2026-06-18T16:00:00.000Z' },
      { startAt: '2026-06-18T17:00:00.000Z', endAt: '2026-06-18T19:00:00.000Z' },
    ])).toEqual([
      { startAt: '2026-06-18T13:00:00.000Z', endAt: '2026-06-18T16:00:00.000Z' },
      { startAt: '2026-06-18T17:00:00.000Z', endAt: '2026-06-18T19:00:00.000Z' },
    ]);
  });
});

describe('merged loot log ordering', () => {
  it('orders selected loot logs by their actual event ranges before copying them', () => {
    expect(sortLootLogBundlesChronologically([
      { id: 'latest', start_at: '2026-07-24T04:00:00.000Z', end_at: '2026-07-24T05:00:00.000Z' },
      { id: 'earliest', start_at: '2026-07-22T23:00:00.000Z', end_at: '2026-07-23T04:00:00.000Z' },
      { id: 'middle', start_at: '2026-07-24T01:00:00.000Z', end_at: '2026-07-24T03:00:00.000Z' },
    ]).map((bundle) => bundle.id)).toEqual(['earliest', 'middle', 'latest']);
  });
});

describe('merged loot log death markings', () => {
  it('keeps each death ID unique while retaining its accounted item markings', () => {
    expect(mergeLootLogDeathChecks([
      {
        checked_at: '2026-07-23T04:00:00.000Z',
        event_id: '123456',
        matched_items: [{ itemId: 'T6_MAIN_SWORD', quantity: 1 }],
        player_key: 'playerone',
        player_name: 'PlayerOne',
        status: 'found',
      },
      {
        checked_at: '2026-07-23T05:00:00.000Z',
        event_id: '123456',
        matched_items: [
          { itemId: 'T6_MAIN_SWORD', quantity: 1 },
          { itemId: 'T7_HEAD_PLATE_SET1', quantity: 2 },
        ],
        player_key: 'playerone',
        player_name: 'PlayerOne',
        status: 'found',
      },
    ])).toEqual([
      expect.objectContaining({
        event_id: '123456',
        matched_items: [
          { itemId: 'T6_MAIN_SWORD', quantity: 1 },
          { itemId: 'T7_HEAD_PLATE_SET1', quantity: 2 },
        ],
        player_key: 'playerone',
        status: 'found',
      }),
    ]);
  });

  it('does not copy a no-death marker when that player has an accounted death', () => {
    expect(mergeLootLogDeathChecks([
      {
        checked_at: '2026-07-23T03:00:00.000Z',
        event_id: '',
        matched_items: [],
        player_key: 'playerone',
        player_name: 'PlayerOne',
        status: 'not_found',
      },
      {
        checked_at: '2026-07-23T05:00:00.000Z',
        event_id: '123456',
        matched_items: [{ itemId: 'T6_MAIN_SWORD', quantity: 1 }],
        player_key: 'playerone',
        player_name: 'PlayerOne',
        status: 'found',
      },
    ])).toHaveLength(1);
  });
});

describe('manual death ID validation', () => {
  const bundle = {
    combined_loot_summary: {},
    end_at: '2026-06-18T19:00:00.000Z',
    start_at: '2026-06-18T17:00:00.000Z',
  };

  it('accepts a matching player death inside the loot log range', () => {
    expect(validateDeathForPlayerAndBundle({
      TimeStamp: '2026-06-18T18:00:00.000Z',
      Victim: { Name: 'Windyyyzz' },
    }, bundle, 'windyyyzz')).toEqual({
      victimKey: 'windyyyzz',
      victimName: 'Windyyyzz',
    });
  });

  it('rejects a death belonging to another player', () => {
    expect(() => validateDeathForPlayerAndBundle({
      TimeStamp: '2026-06-18T18:00:00.000Z',
      Victim: { Name: 'DifferentPlayer' },
    }, bundle, 'Windyyyzz')).toThrow('The death victim does not match Windyyyzz.');
  });

  it('rejects a death outside the loot log range', () => {
    expect(() => validateDeathForPlayerAndBundle({
      TimeStamp: '2026-06-18T20:00:00.000Z',
      Victim: { Name: 'Windyyyzz' },
    }, bundle, 'Windyyyzz')).toThrow('The death date and time are outside this loot log time range.');
  });
});

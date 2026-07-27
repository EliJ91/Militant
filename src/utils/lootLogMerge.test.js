import { describe, expect, it } from 'vitest';
import { validateLootLogStartWindow } from './lootLogMerge.js';

function lootLog(rows) {
  return [
    'looted_by__name;item_name;item_id;quantity;timestamp_utc',
    ...rows.map(([timestamp, player]) => `${player};Adept's Rune;T4_RUNE;1;${timestamp}`),
  ].join('\n');
}

describe('loot log merge window', () => {
  it('uses three independent starts to remove stale events before the likely timer', () => {
    const logs = validateLootLogStartWindow([
      {
        fileName: 'noisy.csv',
        logText: lootLog([
          ['2026-07-25T09:00:00.000Z', 'Stale'],
          ['2026-07-25T11:29:59.000Z', 'TooEarly'],
          ['2026-07-25T11:30:00.000Z', 'Relevant'],
        ]),
      },
      { fileName: 'timer.csv', logText: lootLog([['2026-07-25T12:00:00.000Z', 'Timer']]) },
      { fileName: 'second.csv', logText: lootLog([['2026-07-25T12:15:00.000Z', 'Second']]) },
    ]);

    expect(logs[0].startAt).toBe('2026-07-25T11:30:00.000Z');
    expect(logs[0].logText).not.toMatch(/09:00:00|11:29:59/);
    expect(logs[0].logText).toMatch(/11:30:00/);
  });

  it('does not infer a timer when fewer than three logs are supplied', () => {
    const logs = validateLootLogStartWindow([
      { fileName: 'old.csv', logText: lootLog([['2026-07-25T09:00:00.000Z', 'Old']]) },
      { fileName: 'timer.csv', logText: lootLog([['2026-07-25T12:00:00.000Z', 'Timer']]) },
    ]);

    expect(logs[0].startAt).toBe('2026-07-25T09:00:00.000Z');
  });
});

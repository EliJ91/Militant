import { describe, expect, it } from 'vitest';
import { getBundleFileNames } from './supabaseLootLogs.js';

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
});

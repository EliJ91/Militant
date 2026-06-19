import { describe, expect, it } from 'vitest';
import {
  buildLootLogExport,
  buildLootMonitorReport,
  extractEnchantment,
  parseChestLog,
  parseLootEvents,
} from './lootMonitor';

describe('loot monitor parsing', () => {
  it('extracts enchantment from Albion item ids', () => {
    expect(extractEnchantment('T4_CAPEITEM_FW_LYMHURST@3')).toBe(3);
    expect(extractEnchantment('T7_POTION_REVIVE')).toBe(0);
  });

  it('ignores repeated chest headers and separates withdrawals', () => {
    const chestText = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:42:31"\t"Dyathix"\t"Battle Memento"\t"0"\t"1"\t"-1"',
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:41:56"\t"Windyyyzz"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
    ].join('\n');

    const parsed = parseChestLog(chestText);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      amount: 1,
      enchantment: 3,
      item: "Adept's Lymhurst Cape",
      player: 'Windyyyzz',
    });
    expect(parsed.withdrawals).toHaveLength(1);
  });
});

describe('loot monitor report', () => {
  it('exports deduplicated events in the original loot-log format', () => {
    const events = [
      {
        alliance: 'CHAIR',
        enchantment: 3,
        eventType: 'looted',
        guild: 'Militant',
        item: "Adept's Lymhurst Cape",
        itemId: 'T4_CAPEITEM_FW_LYMHURST@3',
        lostTo: '',
        player: 'Winner',
        quantity: 2,
        timestamp: '2026-06-18T18:33:00.000Z',
      },
      {
        alliance: 'ENEMY',
        enchantment: 3,
        eventType: 'lost',
        guild: 'Enemy Guild',
        item: "Adept's Lymhurst Cape",
        itemId: 'T4_CAPEITEM_FW_LYMHURST@3',
        lostTo: 'Winner',
        player: 'Loser',
        quantity: 2,
        timestamp: '2026-06-18T18:33:00.000Z',
      },
    ];

    const exported = buildLootLogExport(events);
    const parsed = parseLootEvents(exported);

    expect(exported).toContain('timestamp_utc;looted_by__alliance');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ player: 'Winner', quantity: 2 });
    expect(parsed.lostRows[0]).toMatchObject({ lostTo: 'Winner', player: 'Loser', quantity: 2 });
  });

  it('marks kept, resolved, donated, and lost quantities', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
      "2026-06-17T00:08:30.420Z;CHAIR;Militant;Windyyyzz;T4_CAPEITEM_FW_LYMHURST@3;Adept's Lymhurst Cape;2;FURIX;EnemyGuild;Enemy",
      "2026-06-17T00:10:30.420Z;FURIX;EnemyGuild;Enemy;T4_CAPEITEM_FW_LYMHURST@3;Adept's Lymhurst Cape;1;CHAIR;Militant;Windyyyzz",
      "2026-06-17T00:11:30.420Z;CHAIR;Militant;Windyyyzz;T7_POTION_REVIVE;Major Gigantify Potion;5;;;@MOB_T5",
    ].join('\n');
    const chestText = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:41:56"\t"Windyyyzz"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
      '"06/17/2026 00:41:56"\t"Windyyyzz"\t"Major Gigantify Potion"\t"0"\t"1"\t"3"',
      '"06/17/2026 00:41:56"\t"Donor"\t"Expert\'s Bag"\t"1"\t"2"\t"4"',
    ].join('\n');

    const report = buildLootMonitorReport(lootText, chestText);
    const cape = report.rows.find((row) => row.player === 'Windyyyzz' && row.item === "Adept's Lymhurst Cape");
    const potion = report.rows.find((row) => row.player === 'Windyyyzz' && row.item === 'Major Gigantify Potion');
    const donation = report.rows.find((row) => row.player === 'Donor' && row.item === "Expert's Bag");

    expect(cape).toMatchObject({
      deposited: 1,
      donated: 0,
      kept: 0,
      lost: 1,
      status: 'lost',
    });
    expect(potion).toMatchObject({
      deposited: 3,
      donated: 0,
      kept: 2,
      lost: 0,
      status: 'kept',
    });
    expect(donation).toMatchObject({
      deposited: 4,
      donated: 4,
      kept: 0,
      lost: 0,
      looted: 0,
      status: 'donated',
    });
    expect(report.totals.lostQuantity).toBe(3);
    expect(report.totals.donatedQuantity).toBe(4);
    expect(report.totals.donatedRows).toBe(1);
  });

  it('builds loot rows when the chest log is omitted', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
      "2026-06-17T00:08:30.420Z;CHAIR;Militant;Windyyyzz;T4_CAPEITEM_FW_LYMHURST@3;Adept's Lymhurst Cape;2;;;@MOB_T5",
    ].join('\n');

    const report = buildLootMonitorReport(lootText, '');
    const cape = report.rows.find((row) => row.player === 'Windyyyzz');

    expect(cape).toMatchObject({
      accounted: 0,
      deposited: 0,
      donated: 0,
      kept: 2,
      status: 'kept',
    });
    expect(report.totals.lootedQuantity).toBe(2);
    expect(report.totals.depositedQuantity).toBe(0);
  });

  it('recovers donated item ids by unique item name when chest enchantment does not match', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
      "2026-06-17T00:08:30.420Z;CHAIR;Militant;Windyyyzz;T4_CAPEITEM_FW_LYMHURST@3;Adept's Lymhurst Cape;1;;;@MOB_T5",
    ].join('\n');
    const chestText = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:41:56"\t"Donor"\t"Adept\'s Lymhurst Cape"\t"0"\t"4"\t"1"',
    ].join('\n');

    const report = buildLootMonitorReport(lootText, chestText);
    const donation = report.rows.find((row) => row.player === 'Donor');

    expect(donation).toMatchObject({
      donated: 1,
      itemId: 'T4_CAPEITEM_FW_LYMHURST@3',
      status: 'donated',
    });
  });
});

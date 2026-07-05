import { describe, expect, it } from 'vitest';
import {
  buildLootLogExport,
  buildLootMonitorReport,
  combineChestLogTexts,
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
      isFinalChest: true,
      player: 'Windyyyzz',
    });
    expect(parsed.withdrawals).toHaveLength(1);
    expect(parsed.withdrawals[0].isFinalChest).toBe(false);
  });

  it('combines chest logs with one header in chronological order', () => {
    const firstChest = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:42:31"\t"Late"\t"Battle Memento"\t"0"\t"1"\t"1"',
    ].join('\n');
    const secondChest = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:41:56"\t"Early"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
    ].join('\n');

    expect(combineChestLogTexts([firstChest, secondChest])).toBe([
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:41:56"\t"Early"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
      '"06/17/2026 00:42:31"\t"Late"\t"Battle Memento"\t"0"\t"1"\t"1"',
    ].join('\n'));
  });

  it('removes duplicate chest headers inside a single combined log', () => {
    const chestText = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:42:31"\t"Late"\t"Battle Memento"\t"0"\t"1"\t"1"',
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:41:56"\t"Early"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
    ].join('\n');

    expect(combineChestLogTexts([chestText])).toBe([
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:41:56"\t"Early"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
      '"06/17/2026 00:42:31"\t"Late"\t"Battle Memento"\t"0"\t"1"\t"1"',
    ].join('\n'));
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
    expect(cape.custodyChains).toContain('Looted by Windyyyzz');
    expect(report.totals.lootedQuantity).toBe(2);
    expect(report.totals.depositedQuantity).toBe(0);
  });

  it('deduplicates identical loot events within five seconds', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
      "2026-07-05T01:23:41.0038688Z;;Militant;Onslawht;T5_HEAD_LEATHER_SET1@3;Expert's Mercenary Hood;1;;Militant;Frankisrmt",
      "2026-07-05T01:23:37.5307431Z;CHAIR;Militant;Onslawht;T5_HEAD_LEATHER_SET1@3;Expert's Mercenary Hood;1;;Militant;Frankisrmt",
      "2026-07-05T01:23:39.923Z;CHAIR;Militant;Onslawht;T5_HEAD_LEATHER_SET1@3;Expert's Mercenary Hood;1;;;@MOB_T5",
    ].join('\n');

    const report = buildLootMonitorReport(lootText, '');
    const hood = report.rows.find((row) => row.player === 'Onslawht');

    expect(hood).toMatchObject({
      alliance: 'CHAIR',
      kept: 1,
      looted: 1,
    });
    expect(report.totals.lootedQuantity).toBe(1);
  });

  it('resolves donated chest item ids with the chest enchantment', () => {
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
      itemId: 'T4_CAPEITEM_FW_LYMHURST',
      status: 'donated',
    });
  });

  it('keeps untracked chest deposits donated instead of resolved', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
    ].join('\n');
    const firstChest = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:05:00"\t"Donor"\t"Expert\'s Bag"\t"1"\t"2"\t"1"',
    ].join('\n');
    const finalChest = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:10:00"\t"Banker"\t"Major Gigantify Potion"\t"0"\t"1"\t"1"',
    ].join('\n');

    const report = buildLootMonitorReport(lootText, `${firstChest}\n${finalChest}`);
    const donor = report.rows.find((row) => row.player === 'Donor' && row.item === "Expert's Bag");

    expect(donor).toMatchObject({
      accounted: 0,
      donated: 1,
      looted: 0,
      status: 'donated',
    });
    expect(report.totals.accountedQuantity).toBe(0);
    expect(report.totals.donatedQuantity).toBe(2);
  });

  it('prefers tracked looted custody over untracked chest inventory', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
      "2026-06-17T00:02:00.000Z;CHAIR;Militant;PlayerA;T4_CAPEITEM_FW_LYMHURST@3;Adept's Lymhurst Cape;1;;;@MOB_T5",
    ].join('\n');
    const firstChest = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:01:00"\t"PlayerA"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"-1"',
    ].join('\n');
    const finalChest = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:10:00"\t"PlayerA"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
    ].join('\n');

    const report = buildLootMonitorReport(lootText, `${firstChest}\n${finalChest}`);
    const player = report.rows.find((row) => row.player === 'PlayerA');

    expect(player).toMatchObject({
      accounted: 1,
      donated: 0,
      kept: 0,
      looted: 1,
      status: 'resolved',
    });
    expect(report.totals.accountedQuantity).toBe(1);
    expect(report.totals.keptQuantity).toBe(0);
  });

  it('tracks custody across multiple chest logs and uses the final chest as accounted', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
      "2026-06-17T00:01:00.000Z;CHAIR;Militant;Looter;T4_CAPEITEM_FW_LYMHURST@3;Adept's Lymhurst Cape;2;;;@MOB_T5",
    ].join('\n');
    const firstChest = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:05:00"\t"Looter"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
      '"06/17/2026 00:06:00"\t"Courier"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"-1"',
    ].join('\n');
    const finalChest = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:10:00"\t"Courier"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
      '"06/17/2026 00:11:00"\t"Donor"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
    ].join('\n');

    const report = buildLootMonitorReport(lootText, `${firstChest}\n${finalChest}`);
    const looter = report.rows.find((row) => row.player === 'Looter');
    const courier = report.rows.find((row) => row.player === 'Courier');
    const donor = report.rows.find((row) => row.player === 'Donor');

    expect(looter).toMatchObject({ accounted: 1, kept: 0, looted: 2, status: 'resolved' });
    expect(courier).toMatchObject({ accounted: 1, kept: 0, itemId: 'T4_CAPEITEM_FW_LYMHURST@3', status: 'resolved' });
    expect(donor).toBeUndefined();
    expect(report.totals.depositedQuantity).toBe(2);
  });

  it('uses the latest deposit-only chest as final and keeps items with the latest holder', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
      "2026-06-17T00:01:00.000Z;CHAIR;Militant;Looter;T4_CAPEITEM_FW_LYMHURST@3;Adept's Lymhurst Cape;2;;;@MOB_T5",
    ].join('\n');
    const finalChest = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:10:00"\t"Looter"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
    ].join('\n');
    const laterNonFinalChest = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:12:00"\t"Looter"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
      '"06/17/2026 00:13:00"\t"Courier"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"-1"',
    ].join('\n');

    const report = buildLootMonitorReport(lootText, `${finalChest}\n${laterNonFinalChest}`);
    const looter = report.rows.find((row) => row.player === 'Looter');
    const courier = report.rows.find((row) => row.player === 'Courier');

    expect(looter).toMatchObject({ accounted: 1, kept: 0 });
    expect(courier).toMatchObject({ kept: 1, status: 'kept' });
    expect(report.totals.depositedQuantity).toBe(1);
  });

  it('resolves items deposited by another player as traded custody', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
      "2026-06-17T00:01:00.000Z;CHAIR;Militant;PlayerA;T4_CAPEITEM_FW_LYMHURST@3;Adept's Lymhurst Cape;1;;;@MOB_T5",
      "2026-06-17T00:02:00.000Z;CHAIR;Militant;PlayerB;T7_POTION_REVIVE;Major Gigantify Potion;1;;;@MOB_T5",
    ].join('\n');
    const chestText = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:10:00"\t"PlayerB"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
    ].join('\n');

    const report = buildLootMonitorReport(lootText, chestText);
    const playerA = report.rows.find((row) => row.player === 'PlayerA');
    const playerB = report.rows.find((row) => row.player === 'PlayerB' && row.item === "Adept's Lymhurst Cape");

    expect(playerA).toMatchObject({
      accounted: 1,
      donated: 0,
      kept: 0,
      looted: 1,
      status: 'resolved',
    });
    expect(playerB).toBeUndefined();
  });

  it('does not resolve traded custody across guilds', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
      "2026-06-17T00:01:00.000Z;CHAIR;Militant;PlayerA;T4_CAPEITEM_FW_LYMHURST@3;Adept's Lymhurst Cape;1;;;@MOB_T5",
      "2026-06-17T00:02:00.000Z;CHAIR;Other Guild;PlayerB;T7_POTION_REVIVE;Major Gigantify Potion;1;;;@MOB_T5",
    ].join('\n');
    const chestText = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/17/2026 00:10:00"\t"PlayerB"\t"Adept\'s Lymhurst Cape"\t"3"\t"4"\t"1"',
    ].join('\n');

    const report = buildLootMonitorReport(lootText, chestText);
    const playerA = report.rows.find((row) => row.player === 'PlayerA' && row.item === "Adept's Lymhurst Cape");
    const playerB = report.rows.find((row) => row.player === 'PlayerB' && row.item === "Adept's Lymhurst Cape");

    expect(playerA).toMatchObject({
      accounted: 0,
      kept: 1,
      status: 'kept',
    });
    expect(playerB).toMatchObject({
      donated: 1,
      guild: 'Other Guild',
      status: 'donated',
    });
  });

  it('uses the final chest count to resolve custody even when the chest timestamp is earlier', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
      "2026-06-24T04:20:00.000Z;CHAIR;Militant;A1;T6_2H_AXE_AVALON@3;Master's Realmbreaker;1;;;@MOB_T5",
      "2026-06-24T04:21:00.000Z;CHAIR;Militant;PlayerB;T7_POTION_REVIVE;Major Gigantify Potion;1;;;@MOB_T5",
    ].join('\n');
    const chestText = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/24/2026 04:10:00"\t"PlayerB"\t"Master\'s Realmbreaker"\t"3"\t"4"\t"1"',
    ].join('\n');

    const report = buildLootMonitorReport(lootText, chestText);
    const looter = report.rows.find((row) => row.player === 'A1');
    const depositor = report.rows.find((row) => row.player === 'PlayerB' && row.item === "Master's Realmbreaker");

    expect(looter).toMatchObject({
      accounted: 1,
      itemId: 'T6_2H_AXE_AVALON@3',
      kept: 0,
      looted: 1,
      status: 'resolved',
    });
    expect(depositor).toBeUndefined();
  });

  it('matches a final realmbreaker deposit to a looter in the depositor guild', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
      "2026-06-24T04:15:47.902Z;H1VE;A N X X I E T Y;CuraQueVouCagar;T6_2H_AXE_AVALON@3;Master's Realmbreaker;1;;;@MOB_T5",
      "2026-06-24T04:16:23.714Z;CHAIR;Militant;Onslawht;T6_2H_AXE_AVALON@3;Master's Realmbreaker;1;;;@MOB_T5",
      "2026-06-24T04:16:25.013Z;CHAIR;Nirvana Calling;huanghui1020;T6_2H_AXE_AVALON@3;Master's Realmbreaker;1;;;@MOB_T5",
      "2026-06-24T04:16:35.055Z;CHAIR;The Lonely Men;PixelPecs;T6_2H_AXE_AVALON@3;Master's Realmbreaker;1;;;@MOB_T5",
      "2026-06-24T04:17:00.000Z;CHAIR;Militant;Zikeman;T7_POTION_REVIVE;Major Gigantify Potion;1;;;@MOB_T5",
    ].join('\n');
    const chestText = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/24/2026 04:48:11"\t"Zikeman"\t"Master\'s Realmbreaker"\t"3"\t"4"\t"1"',
    ].join('\n');

    const report = buildLootMonitorReport(lootText, chestText);
    const cura = report.rows.find((row) => row.player === 'CuraQueVouCagar' && row.item === "Master's Realmbreaker");
    const onslawht = report.rows.find((row) => row.player === 'Onslawht' && row.item === "Master's Realmbreaker");
    const huanghui = report.rows.find((row) => row.player === 'huanghui1020' && row.item === "Master's Realmbreaker");
    const pixelPecs = report.rows.find((row) => row.player === 'PixelPecs' && row.item === "Master's Realmbreaker");

    expect(cura).toMatchObject({ accounted: 0, kept: 1, status: 'kept' });
    expect(onslawht).toMatchObject({ accounted: 1, kept: 0, status: 'resolved' });
    expect(huanghui).toMatchObject({ accounted: 0, kept: 1, status: 'kept' });
    expect(pixelPecs).toMatchObject({ accounted: 0, kept: 1, status: 'kept' });
  });

  it('resolves traded items that remain in any uploaded chest log', () => {
    const lootText = [
      'timestamp_utc;looted_by__alliance;looted_by__guild;looted_by__name;item_id;item_name;quantity;looted_from__alliance;looted_from__guild;looted_from__name',
      "2026-06-24T04:01:00.000Z;CHAIR;Militant;Onslawht;T6_2H_AXE_AVALON@3;Master's Realmbreaker;1;;;@MOB_T5",
      "2026-06-24T04:02:00.000Z;CHAIR;Militant;Zikeman;T7_POTION_REVIVE;Major Gigantify Potion;1;;;@MOB_T5",
    ].join('\n');
    const firstChest = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/24/2026 04:10:00"\t"Zikeman"\t"Master\'s Realmbreaker"\t"3"\t"4"\t"1"',
    ].join('\n');
    const laterFinalChest = [
      '"Date"\t"Player"\t"Item"\t"Enchantment"\t"Quality"\t"Amount"',
      '"06/24/2026 04:20:00"\t"Donor"\t"Adept\'s Bag"\t"0"\t"1"\t"1"',
    ].join('\n');

    const report = buildLootMonitorReport(lootText, `${firstChest}\n${laterFinalChest}`);
    const looter = report.rows.find((row) => row.player === 'Onslawht');
    const depositor = report.rows.find((row) => row.player === 'Zikeman' && row.item === "Master's Realmbreaker");

    expect(looter).toMatchObject({
      accounted: 1,
      itemId: 'T6_2H_AXE_AVALON@3',
      kept: 0,
      looted: 1,
      status: 'resolved',
    });
    expect(depositor).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  filterZvZBuilds,
  groupDuplicateZvZBuilds,
  parseZvZCell,
  resolveZvZItem,
  rowsToZvZBuilds,
  sortIncompleteZvZBuildsLast,
} from './zvzInfographic';

describe('ZvZ infographic parsing', () => {
  it('turns spreadsheet rows into builds and ignores N/A cells', () => {
    const builds = rowsToZvZBuilds([
      ['', 'ROLE', 'MAIN HAND', 'OFF HAND', 'HELM', 'ARMOR', 'BOOTS', 'CAPE', 'FOOD/POTS'],
      ['1', 'Engage', 'Oathkeepers\n(Q1/W3/P2)', 'N/A', 'Assassin Hood (D3/P3)', 'Demon Armor (R3/P1)', 'Royal Shoes (F3/P2)\nGraveguard (F3/P2)', 'Smuggler Cape\nMartlock Cape', '7.1+ Ava Omelette\n7.0 Gigantify'],
    ]);

    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({ number: '1', role: 'Engage' });
    expect(builds[0].slots.mainHand[0]).toMatchObject({
      annotation: 'Q1/W3/P2',
      itemId: 'T8_2H_DUALMACE_AVALON',
      name: 'Oathkeepers',
    });
    expect(builds[0].slots.offHand).toEqual([]);
    expect(builds[0].slots.boots).toHaveLength(2);
    expect(builds[0].slots.foodPots.map((item) => item.itemId)).toEqual([
      'T7_MEAL_OMELETTE_AVALON@1',
      'T7_POTION_REVIVE',
    ]);
    expect(builds[0].slots.foodPots.map((item) => item.quantity)).toEqual([2, 10]);
  });

  it('keeps build annotations separate from item names', () => {
    const items = parseZvZCell('Jacket of Tenacity (R2/P1)\nRoyal Armor (R3/P1)\n(Royal If No Chariot)', 'armor');

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: 'Jacket of Tenacity', annotation: 'R2/P1' });
    expect(items[1]).toMatchObject({ name: 'Royal Armor', annotation: 'R3/P1' });
  });

  it('attaches alternative annotations to the preceding item instead of creating an or item', () => {
    const items = parseZvZCell('Heavy Mace\n(Q3/W2/P4)\nor\n(Q1/W2/P4)', 'mainHand');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      annotation: 'Q3/W2/P4 or Q1/W2/P4',
      name: 'Heavy Mace',
    });
  });

  it('uses slot-aware aliases and tier-eight equipment images', () => {
    expect(resolveZvZItem('Censor', 'offHand').itemId).toBe('T8_OFF_CENSER_AVALON');
    expect(resolveZvZItem('Mistwalker', 'helm').itemId).toBe('T8_HEAD_LEATHER_FEY');
    expect(resolveZvZItem('Graveguard', 'boots').itemId).toBe('T8_SHOES_PLATE_UNDEAD');
    expect(resolveZvZItem('Martiock Cape', 'cape').itemId).toBe('T8_CAPEITEM_FW_MARTLOCK');
    expect(parseZvZCell('Judicator Armor (R3/P 1}', 'armor')[0]).toMatchObject({
      annotation: 'R3/P1',
      itemId: 'T8_ARMOR_PLATE_KEEPER',
      name: 'Judicator Armor',
    });
  });

  it('searches build numbers, roles, items, and annotations without quantities', () => {
    const builds = rowsToZvZBuilds([
      ['', 'ROLE', 'MAIN HAND', 'OFF HAND', 'HELM', 'ARMOR', 'BOOTS', 'CAPE', 'FOOD/POTS'],
      ['1', 'Engage', 'Oathkeepers (Q1/W3/P2)', 'N/A', 'Assassin Hood', 'Demon Armor', 'Royal Shoes', 'Martlock Cape', 'Gigantify'],
      ['2', 'Healer', 'Hallowfall', 'Censor', 'Hood of Tenacity', 'Judicator Armor', 'Mercenary Shoes', 'Lymhurst Cape', 'Ava Omelette'],
    ]);

    expect(filterZvZBuilds(builds, 'engage')).toEqual([builds[0]]);
    expect(filterZvZBuilds(builds, 'hallowfall')).toEqual([builds[1]]);
    expect(filterZvZBuilds(builds, 'Q1/W3')).toEqual([builds[0]]);
    expect(filterZvZBuilds([{ number: '42', role: 'Caller', slots: { mainHand: [] } }], '42')).toHaveLength(1);
    expect(filterZvZBuilds(builds, '10')).toEqual([]);
  });

  it('groups identical builds and preserves every source row number', () => {
    const builds = rowsToZvZBuilds([
      ['', 'ROLE', 'MAIN HAND', 'OFF HAND', 'HELM', 'ARMOR', 'BOOTS', 'CAPE', 'FOOD/POTS'],
      ['16', 'DPS', 'Realmbreaker (Q2/W2/P3)', 'N/A', 'Soldier Helm', 'Mistwalker Jacket', 'Boots of Valor', 'Smuggler Cape', 'Eel Stew'],
      ['17', 'DPS', 'Realmbreaker (Q2/W2/P3)', 'N/A', 'Soldier Helm', 'Mistwalker Jacket', 'Boots of Valor', 'Smuggler Cape', 'Eel Stew'],
      ['18', 'DPS', 'Realmbreaker (Q2/W2/P3)', 'N/A', 'Knight Helm', 'Mistwalker Jacket', 'Boots of Valor', 'Smuggler Cape', 'Eel Stew'],
    ]);

    const grouped = groupDuplicateZvZBuilds(builds);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ number: '16, 17', buildNumbers: ['16', '17'] });
    expect(grouped[1]).toMatchObject({ number: '18', buildNumbers: ['18'] });
  });

  it('moves builds missing a weapon or armor behind complete builds', () => {
    const builds = rowsToZvZBuilds([
      ['', 'ROLE', 'MAIN HAND', 'OFF HAND', 'HELM', 'ARMOR', 'BOOTS', 'CAPE', 'FOOD/POTS'],
      ['21', 'Battle Mount', 'Chariot', 'Grimoire', 'N/A', 'N/A', 'N/A', 'N/A', 'Pork Omelette'],
      ['22', 'Engage', 'Oathkeepers', 'N/A', 'Assassin Hood', 'Demon Armor', 'Royal Shoes', 'Martlock Cape', 'Gigantify'],
      ['23', 'DPS', 'Realmbreaker', 'N/A', 'Soldier Helm', 'Mistwalker Jacket', 'Boots of Valor', 'Smuggler Cape', 'Eel Stew'],
    ]);

    expect(sortIncompleteZvZBuildsLast(builds).map((build) => build.number)).toEqual(['22', '23', '21']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  parseZvZCell,
  resolveZvZItem,
  rowsToZvZBuilds,
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
      'T7_MEAL_OMELETTE_AVALON',
      'T7_POTION_REVIVE',
    ]);
  });

  it('keeps build annotations separate from item names', () => {
    const items = parseZvZCell('Jacket of Tenacity (R2/P1)\nRoyal Armor (R3/P1)\n(Royal If No Chariot)', 'armor');

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: 'Jacket of Tenacity', annotation: 'R2/P1' });
    expect(items[1]).toMatchObject({ name: 'Royal Armor', annotation: 'R3/P1' });
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
});

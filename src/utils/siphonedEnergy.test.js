import { describe, expect, it } from 'vitest';
import {
  calculateSiphonedEnergyBalances,
  parseSiphonedEnergyLog,
} from './siphonedEnergy';

const logText = [
  '"Date"\t"Player"\t"Reason"\t"Amount"',
  '"2026-06-20 20:40:07"\t"Dyathix"\t"Deposit"\t"6"',
  '"2026-06-20 17:27:12"\t"Bhrennoh"\t"Withdrawal"\t"-10"',
  '"2026-06-20 17:05:31"\t"Dyathix"\t"Withdrawal"\t"10"',
].join('\n');

describe('Siphoned Energy utilities', () => {
  it('parses the copied game format and normalizes transaction signs', () => {
    expect(parseSiphonedEnergyLog(logText)).toEqual({
      skippedRows: [],
      transactions: [
        {
          amount: 6,
          occurredAt: '2026-06-20T20:40:07',
          player: 'Dyathix',
          reason: 'Deposit',
        },
        {
          amount: -10,
          occurredAt: '2026-06-20T17:27:12',
          player: 'Bhrennoh',
          reason: 'Withdrawal',
        },
        {
          amount: -10,
          occurredAt: '2026-06-20T17:05:31',
          player: 'Dyathix',
          reason: 'Withdrawal',
        },
      ],
    });
  });

  it('combines player names case-insensitively and sorts lowest balances first', () => {
    expect(calculateSiphonedEnergyBalances([
      { amount: -80, player: 'Onslawht' },
      { amount: -30, player: 'onslawht' },
      { amount: -100, player: 'Hosein25111' },
      { amount: 20, player: 'Dyathix' },
    ])).toEqual([
      { amount: -110, player: 'Onslawht' },
      { amount: -100, player: 'Hosein25111' },
      { amount: 20, player: 'Dyathix' },
    ]);
  });

  it('rejects unrelated clipboard data', () => {
    expect(() => parseSiphonedEnergyLog('Player\tItem\nTest\tEnergy'))
      .toThrow('Date, Player, Reason, and Amount');
  });
});

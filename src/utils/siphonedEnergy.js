const EXPECTED_HEADERS = ['Date', 'Player', 'Reason', 'Amount'];

function parseDelimited(text, delimiter = '\t') {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (character === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === delimiter) {
      row.push(value);
      value = '';
    } else if (character === '\n' || character === '\r') {
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = '';
      if (character === '\r' && next === '\n') index += 1;
    } else {
      value += character;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function normalizeDate(value) {
  const match = String(value || '').trim().match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) return '';

  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second),
  ));
  const valid = date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
    && date.getUTCHours() === Number(hour)
    && date.getUTCMinutes() === Number(minute)
    && date.getUTCSeconds() === Number(second);

  return valid ? `${year}-${month}-${day}T${hour}:${minute}:${second}` : '';
}

export function parseSiphonedEnergyLog(text) {
  const rows = parseDelimited(String(text || '').trim());
  if (rows.length === 0) throw new Error('Paste a Siphoned Energy log before updating.');

  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, '').trim());
  if (EXPECTED_HEADERS.some((header, index) => headers[index] !== header)) {
    throw new Error('The log must contain Date, Player, Reason, and Amount columns.');
  }

  const transactions = [];
  const skippedRows = [];

  rows.slice(1).forEach((row, index) => {
    const occurredAt = normalizeDate(row[0]);
    const player = String(row[1] || '').trim();
    const rawReason = String(row[2] || '').trim().toLowerCase();
    const reason = rawReason === 'deposit' ? 'Deposit'
      : rawReason === 'withdrawal' ? 'Withdrawal'
        : '';
    const rawAmount = String(row[3] || '').trim();
    const amount = /^-?\d+$/.test(rawAmount) ? Number(rawAmount) : 0;
    const signedAmount = reason === 'Withdrawal' ? -Math.abs(amount) : Math.abs(amount);

    if (!occurredAt || !player || !reason || !Number.isSafeInteger(amount) || amount === 0) {
      skippedRows.push(index + 2);
      return;
    }

    transactions.push({ amount: signedAmount, occurredAt, player, reason });
  });

  if (transactions.length === 0) {
    throw new Error('The pasted log does not contain any valid Siphoned Energy transactions.');
  }

  return { skippedRows, transactions };
}

export function calculateSiphonedEnergyBalances(transactions) {
  const players = new Map();

  transactions.forEach((transaction) => {
    const player = String(transaction.player || transaction.playerName || '').trim();
    if (!player) return;
    const key = player.toLowerCase();
    const current = players.get(key) || { amount: 0, player };
    current.amount += Number(transaction.amount || 0);
    players.set(key, current);
  });

  return [...players.values()].sort((left, right) => (
    left.amount - right.amount || left.player.localeCompare(right.player)
  ));
}

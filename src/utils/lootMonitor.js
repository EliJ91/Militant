function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(value);
      value = '';
    } else if (char === '\n' || char === '\r') {
      row.push(value);
      value = '';
      if (row.some((cell) => cell.trim() !== '')) {
        rows.push(row);
      }
      row = [];
      if (char === '\r' && next === '\n') index += 1;
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);

  return rows;
}

function rowsToObjects(rows) {
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim());

  return rows.slice(1).map((row) => (
    headers.reduce((record, header, index) => ({
      ...record,
      [header]: (row[index] || '').trim(),
    }), {})
  ));
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function parseInteger(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractEnchantment(itemId) {
  const match = String(itemId || '').match(/@(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function makeInventoryKey({ player, item, enchantment }) {
  return [normalize(player), normalize(item), String(enchantment || 0)].join('::');
}

function makeItemLookupKey({ item, enchantment }) {
  return [normalize(item), String(enchantment || 0)].join('::');
}

function makeItemNameLookupKey({ item }) {
  return normalize(item);
}

function pushUnique(list, value) {
  const clean = String(value || '').trim();
  if (clean && !list.includes(clean)) list.push(clean);
}

export function parseLootEvents(text) {
  const records = rowsToObjects(parseDelimited(text, ';'));
  const lostRows = [];
  const skippedRows = [];

  const rows = records.flatMap((record, index) => {
    const player = record.looted_by__name;
    const item = record.item_name;
    const quantity = parseInteger(record.quantity);

    if (!player || !item || quantity === null) {
      skippedRows.push(index + 2);
      return [];
    }

    const baseRow = {
      item,
      itemId: record.item_id || '',
      quantity,
      timestamp: record.timestamp_utc || '',
      enchantment: extractEnchantment(record.item_id),
    };

    const lostBy = record.looted_from__name;
    if (lostBy && !lostBy.startsWith('@')) {
      lostRows.push({
        ...baseRow,
        alliance: record.looted_from__alliance || '',
        guild: record.looted_from__guild || '',
        lostTo: record.looted_by__name || '',
        player: lostBy,
      });
    }

    return [{
      ...baseRow,
      alliance: record.looted_by__alliance || '',
      guild: record.looted_by__guild || '',
      player,
    }];
  });

  return { lostRows, rows, skippedRows };
}

export function parseChestLog(text) {
  const records = rowsToObjects(parseDelimited(text, '\t'));
  const skippedRows = [];
  const withdrawals = [];

  const rows = records.flatMap((record, index) => {
    const player = record.Player;
    const item = record.Item;
    const amount = parseInteger(record.Amount);
    const enchantment = parseInteger(record.Enchantment) ?? 0;
    const quality = parseInteger(record.Quality) ?? 0;

    if (record.Date === 'Date' || player === 'Player') {
      return [];
    }

    if (!player || !item || amount === null) {
      skippedRows.push(index + 2);
      return [];
    }

    const row = {
      amount,
      date: record.Date || '',
      enchantment,
      item,
      player,
      quality,
    };

    if (amount < 0) withdrawals.push(row);
    if (amount <= 0) return [];

    return [row];
  });

  return { rows, skippedRows, withdrawals };
}

function aggregateLoot(rows) {
  const byKey = new Map();

  rows.forEach((row) => {
    const key = makeInventoryKey(row);
    const current = byKey.get(key) || {
      alliance: [],
      guild: [],
      item: row.item,
      itemId: row.itemId,
      player: row.player,
      quantity: 0,
      enchantment: row.enchantment,
      timestamps: [],
    };

    current.quantity += row.quantity;
    pushUnique(current.alliance, row.alliance);
    pushUnique(current.guild, row.guild);
    pushUnique(current.timestamps, row.timestamp);
    byKey.set(key, current);
  });

  return byKey;
}

function aggregateChest(rows) {
  const byKey = new Map();

  rows.forEach((row) => {
    const key = makeInventoryKey(row);
    const current = byKey.get(key) || {
      amount: 0,
      enchantment: row.enchantment,
      item: row.item,
      player: row.player,
      qualities: [],
    };

    current.amount += row.amount;
    pushUnique(current.qualities, row.quality ? `Q${row.quality}` : '');
    byKey.set(key, current);
  });

  return byKey;
}

function aggregateLost(rows) {
  const byKey = new Map();

  rows.forEach((row) => {
    const key = makeInventoryKey(row);
    const current = byKey.get(key) || {
      alliance: [],
      guild: [],
      item: row.item,
      itemId: row.itemId,
      lostTo: [],
      player: row.player,
      quantity: 0,
      enchantment: row.enchantment,
    };

    current.quantity += row.quantity;
    pushUnique(current.alliance, row.alliance);
    pushUnique(current.guild, row.guild);
    pushUnique(current.lostTo, row.lostTo);
    byKey.set(key, current);
  });

  return byKey;
}

function buildItemIdLookup(rows) {
  const exact = new Map();
  const byName = new Map();

  rows.forEach((row) => {
    if (!row.itemId) return;
    exact.set(makeItemLookupKey(row), row.itemId);

    const nameKey = makeItemNameLookupKey(row);
    if (!nameKey) return;
    if (!byName.has(nameKey)) byName.set(nameKey, new Set());
    byName.get(nameKey).add(row.itemId);
  });

  return {
    byName: new Map(
      [...byName.entries()]
        .filter(([, itemIds]) => itemIds.size === 1)
        .map(([nameKey, itemIds]) => [nameKey, [...itemIds][0]]),
    ),
    exact,
  };
}

function buildPlayerIdentity(rows) {
  const lookup = new Map();

  rows.forEach((row) => {
    const key = normalize(row.player);
    if (!key || lookup.has(key)) return;

    lookup.set(key, {
      alliance: row.alliance ? [row.alliance] : [],
      guild: row.guild ? [row.guild] : [],
    });
  });

  return lookup;
}

function summarizePlayers(rows) {
  const byPlayer = new Map();

  rows.forEach((row) => {
    const key = normalize(row.player);
    const current = byPlayer.get(key) || {
      alliance: row.alliance,
      guild: row.guild,
      itemCount: 0,
      keptQuantity: 0,
      lostQuantity: 0,
      player: row.player,
    };

    current.itemCount += 1;
    current.keptQuantity += row.kept;
    current.lostQuantity += row.lost;
    byPlayer.set(key, current);
  });

  return [...byPlayer.values()].sort((left, right) => (
    (right.keptQuantity + right.lostQuantity) - (left.keptQuantity + left.lostQuantity)
    || left.player.localeCompare(right.player)
  ));
}

export function buildLootMonitorReport(lootText, chestText) {
  const loot = parseLootEvents(lootText);
  const chest = parseChestLog(chestText);
  const lootByKey = aggregateLoot(loot.rows);
  const chestByKey = aggregateChest(chest.rows);
  const lostByKey = aggregateLost(loot.lostRows);
  const itemIdLookup = buildItemIdLookup([...loot.rows, ...loot.lostRows]);
  const playerIdentity = buildPlayerIdentity([...loot.rows, ...loot.lostRows]);
  const inventoryKeys = new Set([...lootByKey.keys(), ...lostByKey.keys(), ...chestByKey.keys()]);

  const rows = [...inventoryKeys].map((key) => {
    const looted = lootByKey.get(key);
    const lost = lostByKey.get(key);
    const deposited = chestByKey.get(key) || { amount: 0, qualities: [] };
    const lootedQuantity = looted?.quantity || 0;
    const lostQuantity = lost?.quantity || 0;
    const depositedQuantity = deposited.amount;
    const accounted = Math.min(lootedQuantity, depositedQuantity);
    const donated = Math.max(depositedQuantity - lootedQuantity, 0);
    const kept = Math.max(lootedQuantity - accounted - lostQuantity, 0);
    const player = looted?.player || lost?.player || deposited.player || '';
    const item = looted?.item || lost?.item || deposited.item || '';
    const enchantment = looted?.enchantment ?? lost?.enchantment ?? deposited.enchantment ?? 0;
    const itemId = looted?.itemId
      || lost?.itemId
      || itemIdLookup.exact.get(makeItemLookupKey({ item, enchantment }))
      || itemIdLookup.byName.get(makeItemNameLookupKey({ item }))
      || '';
    const identity = playerIdentity.get(normalize(player));
    const alliance = looted?.alliance?.length ? looted.alliance : (lost?.alliance?.length ? lost.alliance : (identity?.alliance || []));
    const guild = looted?.guild?.length ? looted.guild : (lost?.guild?.length ? lost.guild : (identity?.guild || []));
    const status = donated > 0 && lootedQuantity === 0 && lostQuantity === 0 ? 'donated'
      : lostQuantity > 0 && kept > 0 ? 'mixed'
      : lostQuantity > 0 ? 'lost'
        : kept > 0 ? 'kept'
          : 'resolved';

    return {
      accounted,
      alliance: alliance.join(', '),
      deposited: depositedQuantity,
      donated,
      enchantment,
      guild: guild.join(', '),
      item,
      itemId,
      kept,
      lost: lostQuantity,
      lostTo: lost?.lostTo?.join(', ') || '',
      looted: lootedQuantity,
      player,
      qualities: deposited.qualities.join(', '),
      status,
    };
  }).sort((left, right) => (
    (right.kept + right.lost) - (left.kept + left.lost)
    || left.player.localeCompare(right.player)
    || left.item.localeCompare(right.item)
  ));

  const attentionRows = rows.filter((row) => row.kept > 0 || row.lost > 0);
  const donatedRows = rows.filter((row) => row.donated > 0);

  return {
    chest,
    loot,
    players: summarizePlayers(attentionRows),
    rows,
    totals: {
      accountedQuantity: rows.reduce((sum, row) => sum + row.accounted, 0),
      depositedQuantity: chest.rows.reduce((sum, row) => sum + row.amount, 0),
      donatedQuantity: rows.reduce((sum, row) => sum + row.donated, 0),
      donatedRows: donatedRows.length,
      keptQuantity: attentionRows.reduce((sum, row) => sum + row.kept, 0),
      keptRows: rows.filter((row) => row.kept > 0).length,
      lostQuantity: loot.lostRows.reduce((sum, row) => sum + row.quantity, 0),
      lostRows: rows.filter((row) => row.lost > 0).length,
      lootedQuantity: loot.rows.reduce((sum, row) => sum + row.quantity, 0),
      playersWithAttention: new Set(attentionRows.map((row) => normalize(row.player))).size,
      withdrawalRows: chest.withdrawals.length,
    },
  };
}

export function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

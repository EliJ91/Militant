import albionItemLookup from '../data/albion_item_lookup.json' with { type: 'json' };

export function parseDelimited(text, delimiter) {
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

export function rowsToObjects(rows) {
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

function normalizeItemLookupName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function makeItemKey({ itemId, item, enchantment }) {
  const id = normalize(itemId);
  return id || [normalize(item), String(enchantment || 0)].join('::');
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

function parseTimestamp(value) {
  const text = String(value || '').trim();
  const localMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (localMatch) {
    const [, month, day, year, hour, minute, second = '0'] = localMatch;
    return new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    )).toISOString();
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function timestampMs(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function escapeTabCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function isChestHeader(cells) {
  const normalizedCells = cells.map((cell) => cell.trim());
  return normalizedCells[0] === 'Date' && normalizedCells.includes('Player') && normalizedCells.includes('Amount');
}

function resolveChestItemId(item, enchantment) {
  const baseId = albionItemLookup[normalizeItemLookupName(item)] || '';
  if (!baseId) return '';

  const cleanBaseId = String(baseId).replace(/@\d+$/, '');
  return enchantment > 0 ? `${cleanBaseId}@${enchantment}` : cleanBaseId;
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
  const tableRows = parseDelimited(text, '\t');
  const skippedRows = [];
  const withdrawals = [];
  const events = [];
  const rows = [];
  const sourceStats = new Map();
  let sourceIndex = -1;
  let headers = [];

  tableRows.forEach((cells, index) => {
    const normalizedCells = cells.map((cell) => cell.trim());
    if (normalizedCells[0] === 'Date' && normalizedCells.includes('Player') && normalizedCells.includes('Amount')) {
      sourceIndex += 1;
      headers = normalizedCells;
      return;
    }

    if (headers.length === 0) {
      sourceIndex = 0;
      headers = tableRows[0].map((header) => header.replace(/^\uFEFF/, '').trim());
      if (index === 0) return;
    }

    const record = headers.reduce((current, header, cellIndex) => ({
      ...current,
      [header]: (cells[cellIndex] || '').trim(),
    }), {});
    const player = record.Player;
    const item = record.Item;
    const amount = parseInteger(record.Amount);
    const enchantment = parseInteger(record.Enchantment) ?? 0;
    const quality = parseInteger(record.Quality) ?? 0;

    if (!player || !item || amount === null) {
      skippedRows.push(index + 2);
      return;
    }

    const row = {
      amount,
      date: record.Date || '',
      enchantment,
      item,
      itemId: resolveChestItemId(item, enchantment),
      player,
      quality,
      sourceIndex: Math.max(sourceIndex, 0),
      timestamp: parseTimestamp(record.Date),
    };

    const stats = sourceStats.get(row.sourceIndex) || {
      hasDeposit: false,
      hasWithdrawal: false,
      latestDepositTime: Number.NEGATIVE_INFINITY,
    };
    if (amount > 0) {
      stats.hasDeposit = true;
      stats.latestDepositTime = Math.max(stats.latestDepositTime, timestampMs(row.timestamp));
    }
    if (amount < 0) stats.hasWithdrawal = true;
    sourceStats.set(row.sourceIndex, stats);

    events.push(row);
    if (amount < 0) withdrawals.push(row);
    if (amount > 0) rows.push(row);
  });

  const finalSource = [...sourceStats.entries()]
    .filter(([, stats]) => stats.hasDeposit && !stats.hasWithdrawal)
    .sort((left, right) => right[1].latestDepositTime - left[1].latestDepositTime)[0];
  const finalSourceIndex = finalSource?.[0] ?? -1;
  rows.forEach((row) => {
    row.isFinalChest = row.sourceIndex === finalSourceIndex;
  });
  withdrawals.forEach((row) => {
    row.isFinalChest = row.sourceIndex === finalSourceIndex;
  });

  return { events, finalSourceIndex, rows, skippedRows, withdrawals };
}

export function combineChestLogTexts(texts) {
  const logs = (texts || []).map((text) => String(text || '')).filter((text) => text.trim());
  if (logs.length === 0) return '';

  const entries = [];
  let header = null;
  let headerCount = 0;
  let order = 0;

  logs.forEach((text) => {
    let activeHeader = null;
    parseDelimited(text, '\t').forEach((cells) => {
      if (isChestHeader(cells)) {
        const normalizedHeader = cells.map((cell) => cell.replace(/^\uFEFF/, '').trim());
        headerCount += 1;
        if (!header) header = normalizedHeader;
        activeHeader = normalizedHeader;
        return;
      }

      if (!activeHeader && header) activeHeader = header;
      if (!activeHeader || !cells.some((cell) => cell.trim())) return;

      const dateIndex = activeHeader.findIndex((cell) => cell === 'Date');
      const timestamp = parseTimestamp(cells[dateIndex] || '');
      entries.push({
        cells: activeHeader.map((_, index) => (cells[index] || '').trim()),
        order,
        timestamp,
      });
      order += 1;
    });
  });

  if (!header || entries.length === 0) return logs.join('\n');
  if (logs.length === 1 && headerCount <= 1) return logs[0];

  entries.sort((left, right) => (
    timestampMs(left.timestamp) - timestampMs(right.timestamp)
    || left.order - right.order
  ));

  return [header, ...entries.map((entry) => entry.cells)]
    .map((row) => row.map(escapeTabCell).join('\t'))
    .join('\n');
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

function createReportRow(rowMap, source) {
  const itemId = source.itemId || '';
  const key = [
    normalize(source.player),
    makeItemKey(source),
    String(source.enchantment || 0),
  ].join('::');
  const current = rowMap.get(key) || {
    accounted: 0,
    alliance: [],
    deposited: 0,
    donated: 0,
    enchantment: source.enchantment || 0,
    guild: [],
    item: source.item || '',
    itemId,
    kept: 0,
    lost: 0,
    lostTo: [],
    looted: 0,
    player: source.player || '',
    qualities: [],
    sourceLooters: [],
  };

  if (!current.itemId && itemId) current.itemId = itemId;
  if (!current.item && source.item) current.item = source.item;
  pushUnique(current.alliance, source.alliance);
  pushUnique(current.guild, source.guild);
  pushUnique(current.sourceLooters, source.sourceLooter);
  rowMap.set(key, current);
  return current;
}

function addReportQuantity(rowMap, source, field, quantity, extra = {}) {
  if (!quantity || quantity <= 0) return;
  const row = createReportRow(rowMap, source);
  row[field] += quantity;
  if (field === 'accounted' || field === 'donated') row.deposited += quantity;
  pushUnique(row.qualities, extra.quality ? `Q${extra.quality}` : '');
  pushUnique(row.lostTo, extra.lostTo);
}

function makeLot(row, quantity) {
  return {
    alliance: row.alliance || '',
    enchantment: row.enchantment || 0,
    guild: row.guild || '',
    item: row.item || '',
    itemId: row.itemId || '',
    player: row.player || '',
    quantity,
    sourceLooter: row.sourceLooter || row.player || '',
  };
}

function custodyKey(player, itemKey) {
  return `${normalize(player)}::${itemKey}`;
}

function addLots(store, player, itemKey, lots) {
  const key = custodyKey(player, itemKey);
  const current = store.get(key) || [];
  current.push(...lots.filter((lot) => lot.quantity > 0));
  store.set(key, current);
}

function consumeLots(store, player, itemKey, quantity) {
  const key = custodyKey(player, itemKey);
  const lots = store.get(key) || [];
  const consumed = [];
  let remaining = quantity;

  while (remaining > 0 && lots.length > 0) {
    const lot = lots[0];
    const used = Math.min(remaining, lot.quantity);
    consumed.push({ ...lot, quantity: used });
    lot.quantity -= used;
    remaining -= used;
    if (lot.quantity <= 0) lots.shift();
  }

  if (lots.length > 0) {
    store.set(key, lots);
  } else {
    store.delete(key);
  }

  return { consumed, missing: remaining };
}

function consumeAnyLots(store, itemKey, quantity) {
  const consumed = [];
  let remaining = quantity;

  for (const key of [...store.keys()]) {
    if (remaining <= 0) break;
    if (!key.endsWith(`::${itemKey}`)) continue;

    const lots = store.get(key) || [];
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const used = Math.min(remaining, lot.quantity);
      consumed.push({ ...lot, quantity: used });
      lot.quantity -= used;
      remaining -= used;
      if (lot.quantity <= 0) lots.shift();
    }

    if (lots.length > 0) {
      store.set(key, lots);
    } else {
      store.delete(key);
    }
  }

  return { consumed, missing: remaining };
}

function addLotsToPool(pool, itemKey, lots) {
  const current = pool.get(itemKey) || [];
  current.push(...lots.filter((lot) => lot.quantity > 0));
  pool.set(itemKey, current);
}

function consumePoolLots(pool, itemKey, quantity) {
  const lots = pool.get(itemKey) || [];
  const consumed = [];
  let remaining = quantity;

  while (remaining > 0 && lots.length > 0) {
    const lot = lots[0];
    const used = Math.min(remaining, lot.quantity);
    consumed.push({ ...lot, quantity: used });
    lot.quantity -= used;
    remaining -= used;
    if (lot.quantity <= 0) lots.shift();
  }

  if (lots.length > 0) {
    pool.set(itemKey, lots);
  } else {
    pool.delete(itemKey);
  }

  return { consumed, missing: remaining };
}

function buildLootMonitorReportFromParsedLoot(loot, chestText) {
  const chest = parseChestLog(chestText);
  const itemIdLookup = buildItemIdLookup([...loot.rows, ...loot.lostRows]);
  const rowMap = new Map();
  const holderLots = new Map();
  const chestLots = new Map();
  const events = [
    ...loot.rows.map((row) => ({ order: 0, row, timestamp: row.timestamp, type: 'loot' })),
    ...loot.lostRows.map((row) => ({ order: 1, row, timestamp: row.timestamp, type: 'lost' })),
    ...chest.withdrawals.map((row) => ({ order: 2, row, timestamp: row.timestamp, type: 'withdrawal' })),
    ...chest.rows.map((row) => ({
      order: row.isFinalChest ? 4 : 3,
      row,
      timestamp: row.isFinalChest ? '' : row.timestamp,
      type: 'deposit',
    })),
  ].sort((left, right) => (
    timestampMs(left.timestamp) - timestampMs(right.timestamp)
    || left.order - right.order
  ));

  events.forEach((event) => {
    const row = event.row;
    const itemId = row.itemId
      || itemIdLookup.exact.get(makeItemLookupKey(row))
      || itemIdLookup.byName.get(makeItemNameLookupKey(row))
      || '';
    const itemRow = { ...row, itemId };
    const itemKey = makeItemKey(itemRow);

    if (event.type === 'loot') {
      addReportQuantity(rowMap, itemRow, 'looted', row.quantity);
      addLots(holderLots, row.player, itemKey, [makeLot(itemRow, row.quantity)]);
      return;
    }

    if (event.type === 'lost') {
      const { consumed, missing } = consumeLots(holderLots, row.player, itemKey, row.quantity);
      consumed.forEach((lot) => addReportQuantity(rowMap, lot, 'lost', lot.quantity, { lostTo: row.lostTo }));
      if (missing > 0) addReportQuantity(rowMap, itemRow, 'lost', missing, { lostTo: row.lostTo });
      return;
    }

    if (event.type === 'withdrawal') {
      const { consumed, missing } = consumePoolLots(chestLots, itemKey, Math.abs(row.amount));
      addLots(holderLots, row.player, itemKey, consumed.map((lot) => ({
        ...lot,
        alliance: '',
        guild: '',
        player: row.player,
      })));
      if (missing > 0) addLots(holderLots, row.player, itemKey, [makeLot(itemRow, missing)]);
      return;
    }

    const ownDeposit = consumeLots(holderLots, row.player, itemKey, row.amount);
    const tradedDeposit = ownDeposit.missing > 0
      ? consumeAnyLots(holderLots, itemKey, ownDeposit.missing)
      : { consumed: [], missing: 0 };
    addLotsToPool(chestLots, itemKey, [...ownDeposit.consumed, ...tradedDeposit.consumed]);
    if (tradedDeposit.missing > 0) {
      if (row.isFinalChest) {
        addReportQuantity(rowMap, itemRow, 'donated', tradedDeposit.missing, { quality: row.quality });
      } else {
        addLotsToPool(chestLots, itemKey, [makeLot(itemRow, tradedDeposit.missing)]);
      }
    }
  });

  chestLots.forEach((lots) => {
    lots.forEach((lot) => addReportQuantity(rowMap, lot, 'accounted', lot.quantity));
  });

  holderLots.forEach((lots) => {
    lots.forEach((lot) => addReportQuantity(rowMap, lot, 'kept', lot.quantity));
  });

  const rows = [...rowMap.values()].map((row) => {
    const lootedQuantity = row.looted || 0;
    const lostQuantity = row.lost || 0;
    const kept = row.kept || 0;
    const donated = row.donated || 0;
    const status = donated > 0 && lootedQuantity === 0 && lostQuantity === 0 ? 'donated'
      : lostQuantity > 0 && kept > 0 ? 'mixed'
      : lostQuantity > 0 ? 'lost'
        : kept > 0 ? 'kept'
          : 'resolved';

    return {
      ...row,
      alliance: row.alliance.join(', '),
      guild: row.guild.join(', '),
      kept,
      lostTo: row.lostTo.join(', '),
      qualities: row.qualities.join(', '),
      sourceLooters: row.sourceLooters.join(', '),
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
      depositedQuantity: chest.rows
        .filter((row) => row.isFinalChest)
        .reduce((sum, row) => sum + row.amount, 0),
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

export function buildLootMonitorReport(lootText, chestText) {
  return buildLootMonitorReportFromParsedLoot(parseLootEvents(lootText), chestText);
}

export function buildLootMonitorReportFromEvents(events, chestText) {
  const loot = {
    lostRows: [],
    rows: [],
    skippedRows: [],
  };

  (events || []).forEach((event) => {
    const row = {
      alliance: event.alliance || '',
      enchantment: event.enchantment || 0,
      guild: event.guild || '',
      item: event.item || '',
      itemId: event.itemId || '',
      player: event.player || '',
      quantity: event.quantity || 0,
      timestamp: event.timestamp || '',
    };

    if (event.eventType === 'lost') {
      loot.lostRows.push({ ...row, lostTo: event.lostTo || '' });
    } else {
      loot.rows.push(row);
    }
  });

  return buildLootMonitorReportFromParsedLoot(loot, chestText);
}

function exportTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toISOString();
}

function exportEventMatchKey(event, player) {
  return [
    exportTimestamp(event.timestamp),
    normalize(event.itemId || event.item),
    String(event.enchantment || 0),
    String(event.quantity || 0),
    normalize(player),
  ].join('|');
}

function escapeSemicolonCell(value) {
  const text = String(value ?? '');
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildLootLogExport(events) {
  const headers = [
    'timestamp_utc',
    'looted_by__alliance',
    'looted_by__guild',
    'looted_by__name',
    'item_id',
    'item_name',
    'quantity',
    'looted_from__alliance',
    'looted_from__guild',
    'looted_from__name',
  ];
  const lostByLootKey = new Map();
  const unmatchedLost = new Set();

  (events || []).filter((event) => event.eventType === 'lost').forEach((event) => {
    const key = exportEventMatchKey(event, event.lostTo);
    const matches = lostByLootKey.get(key) || [];
    matches.push(event);
    lostByLootKey.set(key, matches);
    unmatchedLost.add(event);
  });

  const rows = (events || [])
    .filter((event) => event.eventType !== 'lost')
    .sort((left, right) => exportTimestamp(left.timestamp).localeCompare(exportTimestamp(right.timestamp)))
    .map((event) => {
      const key = exportEventMatchKey(event, event.player);
      const loss = lostByLootKey.get(key)?.shift();
      if (loss) unmatchedLost.delete(loss);

      return [
        exportTimestamp(event.timestamp),
        event.alliance,
        event.guild,
        event.player,
        event.itemId,
        event.item,
        event.quantity,
        loss?.alliance || '',
        loss?.guild || '',
        loss?.player || '',
      ];
    });

  unmatchedLost.forEach((loss) => {
    rows.push([
      exportTimestamp(loss.timestamp),
      '',
      '',
      loss.lostTo || '@UNKNOWN',
      loss.itemId,
      loss.item,
      loss.quantity,
      loss.alliance,
      loss.guild,
      loss.player,
    ]);
  });

  return [headers, ...rows]
    .map((row) => row.map(escapeSemicolonCell).join(';'))
    .join('\r\n');
}

export function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

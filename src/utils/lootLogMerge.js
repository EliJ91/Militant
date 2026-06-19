import { parseLootEvents } from './lootMonitor.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function eventIdentityKey(event) {
  return [
    event.eventType,
    normalize(event.player),
    normalize(event.itemId),
    normalize(event.item),
    String(event.enchantment || 0),
    cleanTimestamp(event.timestamp),
    normalize(event.alliance),
    normalize(event.guild),
    normalize(event.lostTo),
  ].join('|');
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

export function buildLootLogEvents(text) {
  const parsed = parseLootEvents(text);
  const events = [
    ...parsed.rows.map((row) => ({ ...row, eventType: 'looted', lostTo: '' })),
    ...parsed.lostRows.map((row) => ({ ...row, eventType: 'lost' })),
  ].map((event) => ({
    alliance: event.alliance || '',
    dedupeKey: eventIdentityKey(event),
    enchantment: event.enchantment || 0,
    eventType: event.eventType,
    guild: event.guild || '',
    item: event.item || '',
    itemId: event.itemId || '',
    lostTo: event.lostTo || '',
    player: event.player || '',
    quantity: event.quantity || 0,
    timestamp: cleanTimestamp(event.timestamp),
  }));

  return { events, parsed };
}

export function getLootLogTimeRange(events) {
  const timestamps = events
    .map((event) => new Date(event.timestamp).getTime())
    .filter((time) => Number.isFinite(time));

  if (timestamps.length === 0) return null;

  return {
    endAt: new Date(Math.max(...timestamps)).toISOString(),
    matchEndAt: new Date(Math.max(...timestamps) + ONE_HOUR_MS).toISOString(),
    matchStartAt: new Date(Math.min(...timestamps) - ONE_HOUR_MS).toISOString(),
    startAt: new Date(Math.min(...timestamps)).toISOString(),
  };
}

export function aggregateLootLogEvents(events) {
  const byKey = new Map();

  events.forEach((event) => {
    const key = [
      normalize(event.player),
      normalize(event.itemId),
      normalize(event.item),
      String(event.enchantment || 0),
    ].join('|');
    const current = byKey.get(key) || {
      alliance: [],
      guild: [],
      item: event.item,
      itemId: event.itemId,
      enchantment: event.enchantment || 0,
      lost: 0,
      lostTo: [],
      looted: 0,
      player: event.player,
      timestamps: [],
    };

    if (event.eventType === 'lost') {
      current.lost += event.quantity || 0;
      if (event.lostTo) current.lostTo.push(event.lostTo);
    } else {
      current.looted += event.quantity || 0;
    }

    current.alliance.push(event.alliance);
    current.guild.push(event.guild);
    current.timestamps.push(event.timestamp);
    byKey.set(key, current);
  });

  const rows = [...byKey.values()].map((row) => ({
    ...row,
    alliance: unique(row.alliance).join(', '),
    guild: unique(row.guild).join(', '),
    kept: Math.max(row.looted - row.lost, 0),
    lostTo: unique(row.lostTo).join(', '),
    timestamps: unique(row.timestamps).sort(),
  })).sort((left, right) => (
    (right.kept + right.lost) - (left.kept + left.lost)
    || left.player.localeCompare(right.player)
    || left.item.localeCompare(right.item)
  ));

  return {
    rows,
    totals: {
      eventRows: events.length,
      keptQuantity: rows.reduce((sum, row) => sum + row.kept, 0),
      lostQuantity: rows.reduce((sum, row) => sum + row.lost, 0),
      lootedQuantity: rows.reduce((sum, row) => sum + row.looted, 0),
      players: new Set(rows.map((row) => normalize(row.player))).size,
    },
  };
}

import { parseLootEvents } from './lootMonitor.js';
import { dedupeNearbyLootEvents } from './dedupeLootEvents.js';

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

export const LOOT_LOG_START_WINDOW_MS = 30 * 60 * 1000;

function filterLootLogBefore(text, cutoffTime) {
  const lines = String(text || '').split(/\r?\n/);
  const timestampIndex = lines
    .map((line) => line.split(';').map((value) => value.trim().replace(/^"|"$/g, '')))
    .find((values) => values.some((value) => /^timestamp_utc$/i.test(value)))
    ?.findIndex((value) => /^timestamp_utc$/i.test(value)) ?? 0;

  return lines.filter((line) => {
    const value = String(line).split(';')[timestampIndex]?.trim().replace(/^"|"$/g, '');
    const timestamp = new Date(value).getTime();
    return !Number.isFinite(timestamp) || timestamp >= cutoffTime;
  }).join('\n');
}

function closestStartPair(logs) {
  const pairs = [];
  for (let left = 0; left < logs.length; left += 1) {
    for (let right = left + 1; right < logs.length; right += 1) {
      pairs.push({
        distance: Math.abs(logs[left].startTime - logs[right].startTime),
        logs: [logs[left], logs[right]],
      });
    }
  }
  return pairs.sort((left, right) => left.distance - right.distance)[0] || null;
}

export function buildLootLogEvents(text) {
  const parsed = parseLootEvents(text);
  const events = dedupeNearbyLootEvents([
    ...parsed.rows.map((row) => ({ ...row, eventType: 'looted', lostTo: '' })),
    ...parsed.lostRows.map((row) => ({ ...row, eventType: 'lost' })),
  ]).map((event) => ({
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
  const timestamps = dedupeNearbyLootEvents(events)
    .map((event) => new Date(event.timestamp).getTime())
    .filter((time) => Number.isFinite(time));

  if (timestamps.length === 0) return null;

  return {
    endAt: new Date(Math.max(...timestamps)).toISOString(),
    startAt: new Date(Math.min(...timestamps)).toISOString(),
  };
}

export function validateLootLogStartWindow(logs) {
  let inspected = logs.map((log, index) => {
    const text = typeof log === 'string' ? log : (log?.text ?? log?.logText);
    const { events } = buildLootLogEvents(text);
    const range = getLootLogTimeRange(events);
    if (!range) {
      throw new Error(`${log?.label || log?.fileName || `Loot log ${index + 1}`} does not contain any valid timestamp_utc values.`);
    }
    return { ...log, range, startAt: range.startAt, startTime: new Date(range.startAt).getTime() };
  });

  if (inspected.length === 3) {
    const likelyPair = closestStartPair(inspected);
    if (likelyPair && likelyPair.distance <= LOOT_LOG_START_WINDOW_MS) {
      const likelyStart = Math.min(...likelyPair.logs.map((log) => log.startTime));
      const cutoffTime = likelyStart - LOOT_LOG_START_WINDOW_MS;
      inspected = inspected.map((log) => {
        const originalText = log.text ?? log.logText;
        const filteredText = filterLootLogBefore(originalText, cutoffTime);
        const { events } = buildLootLogEvents(filteredText);
        const range = getLootLogTimeRange(events);
        if (!range) return null;
        return {
          ...log,
          ...(Object.hasOwn(log, 'text') ? { text: filteredText } : {}),
          ...(Object.hasOwn(log, 'logText') ? { logText: filteredText } : {}),
          range,
          startAt: range.startAt,
          startTime: new Date(range.startAt).getTime(),
        };
      }).filter(Boolean);
    }
  }

  return inspected.sort((left, right) => left.startTime - right.startTime);
}

export function aggregateLootLogEvents(events) {
  const byKey = new Map();

  dedupeNearbyLootEvents(events).forEach((event) => {
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

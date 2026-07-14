const NEARBY_DUPLICATE_MS = 30000;

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function eventTimestampMs(event) {
  const time = new Date(event.timestamp).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

function duplicateKey(event) {
  return [
    event.eventType || 'looted',
    normalize(event.player),
    normalize(event.guild),
    normalize(event.itemId),
    normalize(event.item),
    String(event.enchantment || 0),
  ].join('|');
}

function bestValue(entries, field) {
  return entries.map(({ event }) => event[field]).find((value) => String(value || '').trim()) || '';
}

function mostCommonQuantity(entries) {
  const quantities = entries
    .map(({ event }) => Number(event.quantity) || 0)
    .filter((quantity) => quantity > 0);
  if (!quantities.length) return 0;

  const counts = new Map();
  quantities.forEach((quantity) => counts.set(quantity, (counts.get(quantity) || 0) + 1));

  return quantities.reduce((best, quantity) => {
    const quantityCount = counts.get(quantity) || 0;
    const bestCount = counts.get(best) || 0;
    return quantityCount > bestCount || (quantityCount === bestCount && quantity < best)
      ? quantity
      : best;
  }, quantities[0]);
}

export function dedupeNearbyLootEvents(events) {
  const groups = new Map();

  (events || []).forEach((event, index) => {
    const key = duplicateKey(event);
    const group = groups.get(key) || [];
    group.push({ event, index, time: eventTimestampMs(event) });
    groups.set(key, group);
  });

  const deduped = [];
  groups.forEach((group) => {
    const clusters = [];
    group
      .sort((left, right) => (
        (Number.isNaN(left.time) ? Number.POSITIVE_INFINITY : left.time)
        - (Number.isNaN(right.time) ? Number.POSITIVE_INFINITY : right.time)
        || left.index - right.index
      ))
      .forEach((entry) => {
        if (Number.isNaN(entry.time)) {
          clusters.push({ entries: [entry], lastTime: Number.NaN });
          return;
        }

        const cluster = clusters.find((current) => (
          Number.isFinite(current.lastTime) && entry.time - current.lastTime <= NEARBY_DUPLICATE_MS
        ));
        if (cluster) {
          cluster.entries.push(entry);
          cluster.lastTime = Math.max(cluster.lastTime, entry.time);
        } else {
          clusters.push({ entries: [entry], lastTime: entry.time });
        }
      });

    clusters.forEach((cluster) => {
      const first = cluster.entries[0];
      deduped.push({
        ...first.event,
        alliance: bestValue(cluster.entries, 'alliance'),
        guild: bestValue(cluster.entries, 'guild'),
        lostTo: bestValue(cluster.entries, 'lostTo'),
        quantity: mostCommonQuantity(cluster.entries),
      });
    });
  });

  return deduped.sort((left, right) => (
    (Number.isNaN(eventTimestampMs(left)) ? Number.POSITIVE_INFINITY : eventTimestampMs(left))
    - (Number.isNaN(eventTimestampMs(right)) ? Number.POSITIVE_INFINITY : eventTimestampMs(right))
    || duplicateKey(left).localeCompare(duplicateKey(right))
  ));
}

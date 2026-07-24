const NEARBY_DUPLICATE_MS = 30000;

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function eventTimestampMs(event) {
  const time = new Date(event.timestamp).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

function itemIdentity(event) {
  return normalize(event.itemId) || [normalize(event.item), String(event.enchantment || 0)].join('|');
}

function sourceActorKey(event, actor) {
  return [
    itemIdentity(event),
    String(Number(event.quantity) || 0),
    normalize(actor),
  ].join('|');
}

function withInferredSources(events) {
  const sourcesByActor = new Map();

  (events || [])
    .filter((event) => event.eventType === 'lost')
    .forEach((event) => {
      const key = sourceActorKey(event, event.lostTo);
      const candidates = sourcesByActor.get(key) || [];
      candidates.push({ player: event.player, time: eventTimestampMs(event) });
      sourcesByActor.set(key, candidates);
    });

  return (events || []).map((event) => {
    if (event.sourcePlayer || event.eventType === 'lost') {
      return { ...event, sourcePlayer: event.sourcePlayer || event.player };
    }

    const time = eventTimestampMs(event);
    const nearest = (sourcesByActor.get(sourceActorKey(event, event.player)) || [])
      .filter((candidate) => Math.abs(candidate.time - time) <= NEARBY_DUPLICATE_MS)
      .sort((left, right) => Math.abs(left.time - time) - Math.abs(right.time - time))[0];
    return { ...event, sourcePlayer: nearest?.player || '' };
  });
}

function duplicateKey(event) {
  return [
    event.eventType || 'looted',
    normalize(event.player),
    normalize(event.itemId),
    normalize(event.item),
    String(event.enchantment || 0),
    event.eventType === 'lost' ? normalize(event.lostTo) : '',
  ].join('|');
}

function sourceConflictKey(event) {
  return [
    event.eventType || 'looted',
    normalize(event.sourcePlayer),
    itemIdentity(event),
    String(Number(event.quantity) || 0),
  ].join('|');
}

function resolveSourceConflicts(events) {
  const groups = new Map();
  const resolved = [];

  events.forEach((event, index) => {
    if (!normalize(event.sourcePlayer)) {
      resolved.push(event);
      return;
    }
    const key = sourceConflictKey(event);
    const group = groups.get(key) || [];
    group.push({ event, index, time: eventTimestampMs(event) });
    groups.set(key, group);
  });

  groups.forEach((group) => {
    const clusters = [];
    group
      .sort((left, right) => left.time - right.time || left.index - right.index)
      .forEach((entry) => {
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
      const actors = new Set(cluster.entries.map(({ event }) => normalize(
        event.eventType === 'lost' ? event.lostTo : event.player,
      )).filter(Boolean));
      if (actors.size > 1) {
        resolved.push(cluster.entries.at(-1).event);
      } else {
        resolved.push(...cluster.entries.map(({ event }) => event));
      }
    });
  });

  return resolved;
}

function bestValue(entries, field) {
  return entries.map(({ event }) => event[field]).find((value) => String(value || '').trim()) || '';
}

export function dedupeNearbyLootEvents(events) {
  const groups = new Map();

  withInferredSources(events).forEach((event, index) => {
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
      const latest = cluster.entries.at(-1);
      deduped.push({
        ...latest.event,
        alliance: latest.event.alliance || bestValue(cluster.entries, 'alliance'),
        guild: latest.event.guild || bestValue(cluster.entries, 'guild'),
        lostTo: latest.event.lostTo || bestValue(cluster.entries, 'lostTo'),
      });
    });
  });

  return resolveSourceConflicts(deduped).sort((left, right) => (
    (Number.isNaN(eventTimestampMs(left)) ? Number.POSITIVE_INFINITY : eventTimestampMs(left))
    - (Number.isNaN(eventTimestampMs(right)) ? Number.POSITIVE_INFINITY : eventTimestampMs(right))
    || duplicateKey(left).localeCompare(duplicateKey(right))
  ));
}

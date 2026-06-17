const WEST_API_BASE = 'https://west.albion-online-data.com/api/v2/stats';
const MAX_ITEMS_PER_REQUEST = 60;

const SPECIAL_MARKET_LOCATIONS = [
  'Arthurs Rest Smugglers Network',
  'Merlyns Rest Smugglers Network',
  'Morganas Rest Smugglers Network',
  'Black Market',
];

const SPECIAL_MARKET_LOCATION_SET = new Set(SPECIAL_MARKET_LOCATIONS);

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export function getWestMultiHistoryUrl(itemIds, locations = []) {
  const encodedItems = itemIds.map((itemId) => encodeURIComponent(itemId)).join(',');
  const locationQuery = locations.length
    ? `&locations=${locations.map((location) => encodeURIComponent(location)).join(',')}`
    : '';

  return `${WEST_API_BASE}/history/${encodedItems}.json?time-scale=24${locationQuery}`;
}

async function requestHistory(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Albion market API returned HTTP ${response.status}.`);

  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Albion market API returned an unexpected response.');

  return data;
}

function normalizeItemIds(history, itemIds) {
  if (itemIds.length !== 1) return history;
  return history.map((entry) => ({
    ...entry,
    item_id: entry.item_id || itemIds[0],
  }));
}

function mergeHistory(...historyGroups) {
  const merged = new Map();

  for (const history of historyGroups) {
    for (const entry of history) {
      const key = `${entry.item_id || ''}|${entry.location}|${entry.quality}`;
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, {
          ...entry,
          data: [...(entry.data || [])],
        });
        continue;
      }

      const points = new Map((existing.data || []).map((point) => [point.timestamp, point]));
      for (const point of entry.data || []) points.set(point.timestamp, point);
      existing.data = [...points.values()].sort(
        (left, right) => new Date(left.timestamp) - new Date(right.timestamp),
      );
    }
  }

  return [...merged.values()];
}

async function fetchWestHistoryChunk(itemIds, signal) {
  const primaryRequest = requestHistory(getWestMultiHistoryUrl(itemIds), signal);
  const specialMarketsRequest = requestHistory(
    getWestMultiHistoryUrl(itemIds, SPECIAL_MARKET_LOCATIONS),
    signal,
  ).catch((error) => {
    if (error.name === 'AbortError') throw error;
    return [];
  });

  const [primaryHistory, specialMarketsHistory] = await Promise.all([
    primaryRequest,
    specialMarketsRequest,
  ]);

  return mergeHistory(
    normalizeItemIds(primaryHistory, itemIds),
    normalizeItemIds(specialMarketsHistory, itemIds).filter((entry) => (
      SPECIAL_MARKET_LOCATION_SET.has(entry.location)
    )),
  );
}

export function getEstimatedMarketValue(history) {
  const totals = history.reduce(
    (result, entry) => {
      for (const point of entry.data || []) {
        const itemCount = Number(point.item_count) || 0;
        const averagePrice = Number(point.avg_price) || 0;
        result.itemCount += itemCount;
        result.weightedPrice += averagePrice * itemCount;
      }
      return result;
    },
    { itemCount: 0, weightedPrice: 0 },
  );

  return totals.itemCount > 0 ? totals.weightedPrice / totals.itemCount : null;
}

export async function fetchWestAveragePrices(itemIds, signal) {
  const uniqueItemIds = [...new Set(itemIds.filter(Boolean))];
  if (uniqueItemIds.length === 0) return {};

  const historyGroups = await Promise.all(
    chunk(uniqueItemIds, MAX_ITEMS_PER_REQUEST).map((itemIdChunk) => (
      fetchWestHistoryChunk(itemIdChunk, signal)
    )),
  );
  const byItemId = new Map(uniqueItemIds.map((itemId) => [itemId, []]));

  historyGroups.flat().forEach((entry) => {
    if (!byItemId.has(entry.item_id)) return;
    byItemId.get(entry.item_id).push(entry);
  });

  return Object.fromEntries(uniqueItemIds.map((itemId) => [
    itemId,
    { averagePrice: getEstimatedMarketValue(byItemId.get(itemId) || []) },
  ]));
}

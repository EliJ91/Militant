import albionItemLookup from '../data/albion_item_lookup.json' with { type: 'json' };

export const ZVZ_SLOT_DEFINITIONS = [
  { key: 'mainHand', label: 'Main Hand' },
  { key: 'offHand', label: 'Off Hand' },
  { key: 'helm', label: 'Helm' },
  { key: 'armor', label: 'Armor' },
  { key: 'boots', label: 'Boots' },
  { key: 'cape', label: 'Cape' },
  { key: 'foodPots', label: 'Food / Pots' },
];

const HEADER_KEYS = new Map([
  ['role', 'role'],
  ['main hand', 'mainHand'],
  ['mainhand', 'mainHand'],
  ['weapon', 'mainHand'],
  ['off hand', 'offHand'],
  ['offhand', 'offHand'],
  ['helm', 'helm'],
  ['helmet', 'helm'],
  ['head', 'helm'],
  ['armor', 'armor'],
  ['armour', 'armor'],
  ['chest', 'armor'],
  ['boots', 'boots'],
  ['shoes', 'boots'],
  ['cape', 'cape'],
  ['food pots', 'foodPots'],
  ['food pot', 'foodPots'],
  ['food potion', 'foodPots'],
  ['food potions', 'foodPots'],
  ['foodpots', 'foodPots'],
]);

const SLOT_ID_MATCHERS = {
  armor: (itemId) => itemId.includes('_ARMOR_'),
  boots: (itemId) => itemId.includes('_SHOES_'),
  cape: (itemId) => itemId.includes('_CAPE'),
  foodPots: (itemId) => itemId.includes('_MEAL_') || itemId.includes('_POTION_'),
  helm: (itemId) => itemId.includes('_HEAD_'),
  mainHand: (itemId) => itemId.includes('_MAIN_') || itemId.includes('_2H_'),
  offHand: (itemId) => itemId.includes('_OFF_'),
};

const SLOT_ALIASES = {
  mainHand: {
    astral: 'astral staff',
    earthrune: 'earthrune staff',
    enigmatic: 'enigmatic staff',
    exalted: 'exalted staff',
    hellfire: 'hellfire hands',
    lifecurse: 'lifecurse staff',
    locus: 'malevolent locus',
    rootbound: 'rootbound staff',
    rotcaller: 'rotcaller staff',
    spiked: 'spiked gauntlets',
  },
  offHand: {
    aegis: 'astral aegis',
    censor: 'celestial censer',
    censer: 'celestial censer',
  },
  helm: {
    'knight helm': 'knight helmet',
    'leather helm': 'mercenary hood',
    mistwalker: 'mistwalker hood',
    'soldier helm': 'soldier helmet',
  },
  boots: {
    graveguard: 'graveguard boots',
    'graveguard terri castle': 'graveguard boots',
  },
  foodPots: {
    'ava omelette': 'avalonian pork omelette',
    'avalonian omelette': 'avalonian pork omelette',
    'eel stew': 'deadwater eel stew',
    gigantify: 'major gigantify potion',
    'roast puremist': 'roasted puremist snapper',
  },
};

const RANK_PREFIX = /^(?:beginner|novice|journeyman|adept|expert|master|grandmaster|elder) s /;
const ANNOTATION_PATTERN = /^(?:[QWPRDF]\d+)(?:\s*\/\s*(?:[QWPRDF]\d+))*$/i;
const ITEM_NOTE_PATTERN = /^(?:can be flexible|royal if no chariot|no chariot|\d+x\s+food\s*&\s*\d+x\s+pots)$/i;

function normalizeText(value) {
  return String(value ?? '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tier(itemId) {
  const match = String(itemId || '').match(/^T(\d+)_/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

const ITEM_RECORDS = Object.entries(albionItemLookup).map(([lookupName, itemId]) => ({
  baseName: normalizeText(lookupName).replace(RANK_PREFIX, ''),
  itemId,
  lookupName,
  tier: tier(itemId),
}));

const ITEMS_BY_BASE_NAME = ITEM_RECORDS.reduce((index, record) => {
  const records = index.get(record.baseName) || [];
  records.push(record);
  index.set(record.baseName, records);
  return index;
}, new Map());

function chooseBestTier(records, slot) {
  const matchingSlot = records.filter((record) => SLOT_ID_MATCHERS[slot]?.(record.itemId));
  const candidates = matchingSlot.length > 0 ? matchingSlot : records;
  return [...candidates].sort((left, right) => {
    if (slot !== 'foodPots') {
      const leftIsT8 = left.tier === 8 ? 1 : 0;
      const rightIsT8 = right.tier === 8 ? 1 : 0;
      if (leftIsT8 !== rightIsT8) return rightIsT8 - leftIsT8;
    }
    return right.tier - left.tier;
  })[0] || null;
}

function itemNameScore(candidateName, itemName) {
  if (candidateName === itemName) return 1000;
  if (itemName.startsWith(`${candidateName} `) || candidateName.startsWith(`${itemName} `)) return 850;

  const candidateTokens = candidateName.split(' ').filter(Boolean);
  const itemTokens = itemName.split(' ').filter(Boolean);
  const overlap = candidateTokens.filter((token) => itemTokens.includes(token)).length;
  const tokenScore = overlap === candidateTokens.length
    ? 700 - Math.abs(itemTokens.length - candidateTokens.length) * 10
    : (overlap / Math.max(candidateTokens.length, itemTokens.length)) * 500;
  const maxLength = Math.max(candidateName.length, itemName.length);
  if (maxLength === 0) return tokenScore;
  const previous = Array.from({ length: itemName.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= candidateName.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= itemName.length; rightIndex += 1) {
      const cost = candidateName[leftIndex - 1] === itemName[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  const similarity = 1 - (previous[itemName.length] / maxLength);
  return Math.max(tokenScore, similarity >= 0.72 ? similarity * 700 : 0);
}

export function resolveZvZItem(itemName, slot) {
  const normalized = normalizeText(itemName);
  const aliasedName = SLOT_ALIASES[slot]?.[normalized] || normalized;
  const exact = chooseBestTier(ITEMS_BY_BASE_NAME.get(aliasedName) || [], slot);

  let match = exact;
  if (!match) {
    let bestScore = 0;
    ITEM_RECORDS.forEach((record) => {
      if (SLOT_ID_MATCHERS[slot] && !SLOT_ID_MATCHERS[slot](record.itemId)) return;
      const score = itemNameScore(aliasedName, record.baseName);
      if (score > bestScore) {
        bestScore = score;
        match = record;
      } else if (score === bestScore && score > 0 && match && record.tier > match.tier) {
        match = record;
      }
    });
    if (bestScore < 480) match = null;
  }

  return {
    itemId: match?.itemId || '',
    lookupName: match?.lookupName || '',
    resolved: Boolean(match),
  };
}

export function zvzItemImageUrl(itemId) {
  if (!itemId) return '';
  const imagePath = `${itemId}.png?count=1&quality=1&size=160`;
  if (typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
    return `/item-image/${imagePath}`;
  }
  return `https://images.weserv.nl/?url=${encodeURIComponent(`render.albiononline.com/v1/item/${imagePath}`)}`;
}

function cleanItemLine(value) {
  return String(value || '')
    .replace(/^\s*[\u2022*]+\s*/, '')
    .replace(/^\s*\d+(?:\.\d+)?\+?\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseZvZCell(value, slot) {
  const text = String(value ?? '').replace(/\r/g, '\n');
  const normalizedCell = normalizeText(text);
  if (!normalizedCell || /^(?:n ?a|none)$/.test(normalizedCell)) return [];

  const items = [];
  text.split(/\n+/).map((line) => line.trim()).filter(Boolean).forEach((rawLine) => {
    const tolerantAnnotations = [];
    const annotationCleanedLine = rawLine.replace(
      /[([{]?\s*((?:[QWPRDF]\s*\d+\s*\/\s*)+[QWPRDF]\s*\d+)\s*[)\]}]?/gi,
      (_match, annotation) => {
        tolerantAnnotations.push(annotation.replace(/\s+/g, '').toUpperCase());
        return ' ';
      },
    );
    const parentheticals = [...annotationCleanedLine.matchAll(/\(([^()]*)\)/g)].map((match) => match[1].trim());
    const annotations = parentheticals.filter((annotation) => ANNOTATION_PATTERN.test(annotation));
    annotations.unshift(...tolerantAnnotations);
    const withoutParentheticals = annotationCleanedLine.replace(/\([^()]*\)/g, ' ');
    const name = cleanItemLine(withoutParentheticals);

    if (!name && annotations.length > 0 && items.length > 0) {
      items[items.length - 1].annotation = annotations.join(' / ');
      return;
    }

    const normalizedName = normalizeText(name);
    if (!normalizedName || /^(?:n ?a|none)$/.test(normalizedName) || ITEM_NOTE_PATTERN.test(normalizedName)) return;

    const match = resolveZvZItem(name, slot);
    const isFood = match.itemId.includes('_MEAL_');
    const isGigantifyPotion = match.itemId.includes('_POTION_REVIVE')
      || normalizeText(name).includes('gigantify');
    const itemId = isFood
      ? `${match.itemId.replace(/@\d+$/, '')}@1`
      : match.itemId;
    items.push({
      annotation: annotations.join(' / '),
      imageUrl: zvzItemImageUrl(itemId),
      itemId,
      lookupName: match.lookupName,
      name,
      quantity: isFood ? 2 : isGigantifyPotion ? 10 : 1,
      resolved: match.resolved,
    });
  });

  return items;
}

function getHeaderKey(value) {
  const normalized = normalizeText(value);
  return HEADER_KEYS.get(normalized) || '';
}

export function rowsToZvZBuilds(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  let headerIndex = -1;
  let columnMap = {};

  rows.some((row, rowIndex) => {
    const candidateMap = {};
    (Array.isArray(row) ? row : []).forEach((cell, columnIndex) => {
      const key = getHeaderKey(cell);
      if (key && candidateMap[key] === undefined) candidateMap[key] = columnIndex;
    });
    const recognizedColumns = Object.keys(candidateMap).length;
    if (candidateMap.role !== undefined && recognizedColumns >= 4) {
      headerIndex = rowIndex;
      columnMap = candidateMap;
      return true;
    }
    return false;
  });

  if (headerIndex < 0) {
    throw new Error('Could not find the ROLE, MAIN HAND, and equipment columns.');
  }

  const roleColumn = columnMap.role;
  return rows.slice(headerIndex + 1).map((row, rowOffset) => {
    const cells = Array.isArray(row) ? row : [];
    const role = String(cells[roleColumn] ?? '').trim();
    const numberCell = roleColumn > 0 ? String(cells[roleColumn - 1] ?? '').trim() : '';
    const slots = Object.fromEntries(ZVZ_SLOT_DEFINITIONS.map(({ key }) => [
      key,
      columnMap[key] === undefined ? [] : parseZvZCell(cells[columnMap[key]], key),
    ]));
    return {
      id: `${headerIndex + rowOffset + 1}-${numberCell || role || 'build'}`,
      number: numberCell || String(rowOffset + 1),
      role,
      slots,
    };
  }).filter((build) => (
    build.role
    && !/^(?:role|n ?a)$/i.test(build.role)
    && Object.values(build.slots).some((items) => items.length > 0)
  )).map((build, index) => ({
    ...build,
    number: /^alt\.?$/i.test(build.number) ? build.number : String(index + 1),
  }));
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === delimiter) {
      row.push(value);
      value = '';
    } else if (character === '\r' || character === '\n') {
      row.push(value);
      value = '';
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
      if (character === '\r' && next === '\n') index += 1;
    } else value += character;
  }
  row.push(value);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  return rows;
}

function detectDelimiter(text) {
  const firstLine = String(text || '').split(/\r?\n/, 1)[0] || '';
  const counts = [',', '\t', ';'].map((delimiter) => ({
    count: firstLine.split(delimiter).length - 1,
    delimiter,
  }));
  counts.sort((left, right) => right.count - left.count);
  return counts[0].count > 0 ? counts[0].delimiter : ',';
}

function groupConsecutive(values) {
  const groups = [];
  values.forEach((value) => {
    const current = groups[groups.length - 1];
    if (!current || value > current[current.length - 1] + 1) groups.push([value]);
    else current.push(value);
  });
  return groups.map((group) => Math.round(group.reduce((sum, value) => sum + value, 0) / group.length));
}

function findGridLines(context, width, height, axis) {
  const { data } = context.getImageData(0, 0, width, height);
  const primarySize = axis === 'horizontal' ? height : width;
  const secondarySize = axis === 'horizontal' ? width : height;
  const minimumDarkPixels = secondarySize * (axis === 'horizontal' ? 0.45 : 0.34);
  const lines = [];

  for (let primary = 0; primary < primarySize; primary += 1) {
    let darkPixels = 0;
    for (let secondary = 0; secondary < secondarySize; secondary += 1) {
      const x = axis === 'horizontal' ? secondary : primary;
      const y = axis === 'horizontal' ? primary : secondary;
      const offset = ((y * width) + x) * 4;
      const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      if (data[offset + 3] > 100 && brightness < 80) darkPixels += 1;
    }
    if (darkPixels >= minimumDarkPixels) lines.push(primary);
  }

  return groupConsecutive(lines);
}

function flattenOcrWords(blocks = []) {
  return (blocks || []).flatMap((block, blockIndex) => (
    (block.paragraphs || []).flatMap((paragraph, paragraphIndex) => (
      (paragraph.lines || []).flatMap((line, lineIndex) => (
        (line.words || []).map((word) => ({
          bbox: word.bbox,
          confidence: word.confidence,
          lineKey: `${blockIndex}-${paragraphIndex}-${lineIndex}-${line.bbox?.y0 ?? word.bbox?.y0 ?? 0}`,
          text: word.text,
        }))
      ))
    ))
  )).filter((word) => word.text && word.bbox && word.confidence >= 0);
}

function wordsToCell(words) {
  const lines = new Map();
  words.forEach((word) => {
    const line = lines.get(word.lineKey) || [];
    line.push(word);
    lines.set(word.lineKey, line);
  });
  return [...lines.values()]
    .sort((left, right) => left[0].bbox.y0 - right[0].bbox.y0)
    .map((line) => line.sort((left, right) => left.bbox.x0 - right.bbox.x0).map((word) => word.text).join(' '))
    .join('\n')
    .trim();
}

function matrixFromOcrGrid(words, verticalLines, horizontalLines) {
  const columnBands = verticalLines.slice(0, -1).map((line, index) => [line, verticalLines[index + 1]]);
  const rowBands = horizontalLines.slice(0, -1)
    .map((line, index) => [line, horizontalLines[index + 1]])
    .filter(([top, bottom]) => bottom - top >= 11);

  return rowBands.map(([top, bottom]) => columnBands.map(([left, right]) => wordsToCell(
    words.filter((word) => {
      const x = (word.bbox.x0 + word.bbox.x1) / 2;
      const y = (word.bbox.y0 + word.bbox.y1) / 2;
      return x > left && x < right && y > top && y < bottom;
    }),
  ))).filter((row) => row.some(Boolean));
}

function prepareSpreadsheetForOcr(context, width, height, verticalLines, horizontalLines) {
  context.save();
  context.fillStyle = '#ffffff';
  verticalLines.forEach((line) => context.fillRect(Math.max(0, line - 2), 0, 5, height));
  horizontalLines.forEach((line) => context.fillRect(0, Math.max(0, line - 2), width, 5));
  context.restore();

  const image = context.getImageData(0, 0, width, height);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const brightness = (image.data[offset] + image.data[offset + 1] + image.data[offset + 2]) / 3;
    const value = brightness < 165 ? 0 : 255;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

async function loadImageToCanvas(file) {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Could not open the spreadsheet image.'));
      image.src = imageUrl;
    });
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    sourceContext.drawImage(image, 0, 0);

    const scale = image.naturalWidth < 3000 ? Math.min(3, 3000 / image.naturalWidth) : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, context, scale, sourceContext };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function readImageSpreadsheet(file, onProgress) {
  const { canvas, context, scale, sourceContext } = await loadImageToCanvas(file);
  onProgress?.({ label: 'Finding spreadsheet cells', progress: 0.08 });
  const verticalLines = findGridLines(
    sourceContext,
    sourceContext.canvas.width,
    sourceContext.canvas.height,
    'vertical',
  ).map((line) => Math.round(line * scale));
  const horizontalLines = findGridLines(
    sourceContext,
    sourceContext.canvas.width,
    sourceContext.canvas.height,
    'horizontal',
  ).map((line) => Math.round(line * scale));
  if (verticalLines.length < 9 || horizontalLines.length < 3) {
    throw new Error('Could not detect the spreadsheet grid. Upload a clear, uncropped image of the full table.');
  }
  prepareSpreadsheetForOcr(context, canvas.width, canvas.height, verticalLines, horizontalLines);

  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger(message) {
      if (message.status === 'recognizing text') {
        onProgress?.({ label: 'Reading spreadsheet text', progress: 0.12 + (message.progress * 0.82) });
      }
    },
  });

  try {
    await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' });
    const result = await worker.recognize(canvas, {}, { blocks: true, text: true });
    const words = flattenOcrWords(result.data.blocks);
    if (words.length === 0) throw new Error('No spreadsheet text was found in the image.');
    const rows = matrixFromOcrGrid(words, verticalLines, horizontalLines);
    return [
      ['', 'ROLE', 'MAIN HAND', 'OFF HAND', 'HELM', 'ARMOR', 'BOOTS', 'CAPE', 'FOOD/POTS'],
      ...rows,
    ];
  } finally {
    await worker.terminate();
  }
}

export async function readZvZSpreadsheet(file, onProgress) {
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(extension) || String(file?.type || '').startsWith('image/')) {
    return readImageSpreadsheet(file, onProgress);
  }
  if (extension === 'xlsx') {
    onProgress?.({ label: 'Reading workbook', progress: 0.35 });
    const { default: readXlsxFile } = await import('read-excel-file');
    // Some exported workbooks contain blank shared-string cells. The reader's
    // default trimming attempts to call trim() on those undefined values.
    return readXlsxFile(file, { trim: false });
  }
  if (['csv', 'tsv', 'txt'].includes(extension)) {
    onProgress?.({ label: 'Reading spreadsheet', progress: 0.6 });
    const text = await file.text();
    return parseDelimited(text, extension === 'tsv' ? '\t' : detectDelimiter(text));
  }
  throw new Error('Use an .xlsx, .csv, .tsv, .png, .jpg, or .webp file.');
}

export async function parseZvZSpreadsheet(file, onProgress) {
  const rows = await readZvZSpreadsheet(file, onProgress);
  const builds = rowsToZvZBuilds(rows);
  if (builds.length === 0) throw new Error('No complete build rows were found.');
  onProgress?.({ label: `${builds.length} builds ready`, progress: 1 });
  return builds;
}

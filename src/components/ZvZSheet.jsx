import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clipboard, FileImage, FileSpreadsheet, Minus, Pencil, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import {
  createZvZBuildLayout,
  fetchZvZBuildLayouts,
  updateZvZBuildLayout,
} from '../services/zvzBuildsApi';
import { warmItemImageCache } from '../utils/itemImageCache';
import {
  getZvZItemOptions,
  parseZvZSpreadsheet,
  stripAlbionRankPrefix,
  t8ItemId,
  tokenizeZvZSearch,
  zvzItemImageUrl,
} from '../utils/zvzSheet';
import { copyElementScreenshot } from './LootMonitor';

const ACCEPTED_FILE_TYPES = '.xlsx,.csv,.tsv,.txt,.png,.jpg,.jpeg,.webp,.bmp';
const DEFAULT_HEADERS = ['#', 'Role', 'Main Hand', 'Off Hand', 'Helm', 'Armor', 'Boots', 'Cape', 'Food/Pots'];
const COLUMN_KEYS = ['number', 'role', 'mainHand', 'offHand', 'helm', 'armor', 'boots', 'cape', 'foodPots'];
const ITEM_COLUMNS = new Set(['mainHand', 'offHand', 'helm', 'armor', 'boots', 'cape', 'foodPots']);
const T8_ITEM_OPTIONS = getZvZItemOptions({ t8Only: true });
const ALL_ITEM_OPTIONS = getZvZItemOptions({ t8Only: false });
const ITEM_OPTIONS = T8_ITEM_OPTIONS;
const DEFAULT_T8_COLUMNS = COLUMN_KEYS.reduce((state, key) => ({
  ...state,
  [key]: ITEM_COLUMNS.has(key),
}), {});

function searchOptionScore(option, query) {
  const search = query.trim();
  if (!search) return 1;
  const searchText = search.toLowerCase();
  const queryTokens = tokenizeZvZSearch(searchText);
  if (option.label.toLowerCase() === searchText) return 1000;
  if (option.label.toLowerCase().startsWith(searchText)) return 900;
  if (option.searchText.includes(searchText)) return 760;
  if (queryTokens.length === 0) return 0;
  const matchedTokens = queryTokens.filter((token) => (
    option.searchTokens?.some((optionToken) => (
      optionToken === token || optionToken.startsWith(token) || optionToken.includes(token)
    ))
  ));
  if (matchedTokens.length !== queryTokens.length) return 0;
  return 620 + matchedTokens.length * 28;
}

function rankedOptions(options, query) {
  return options
    .map((option) => ({ option, score: searchOptionScore(option, query) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => (
      right.score - left.score
      || left.option.label.localeCompare(right.option.label, undefined, { sensitivity: 'base' })
      || left.option.itemId.localeCompare(right.option.itemId)
    ))
    .map(({ option }) => option);
}

function canonicalItemName(item) {
  const option = item?.itemId
    ? ITEM_OPTIONS.find((candidate) => candidate.itemId === item.itemId)
    : null;
  return option?.label || stripAlbionRankPrefix(item?.itemName || item?.name || '');
}

function itemIsUnresolved(item) {
  return Boolean(item?.unresolved);
}

function normalizeItem(item) {
  const itemId = item?.itemId || '';
  const itemName = canonicalItemName(item);
  return {
    itemId,
    itemName,
    unresolved: itemIsUnresolved(item),
  };
}

function emptyCell() {
  return { itemId: '', itemName: '', items: [], notes: '', text: '' };
}

function cellHasContent(cell, columnKey) {
  const normalized = normalizeCell(cell);
  if (ITEM_COLUMNS.has(columnKey)) {
    return buildSlotItems(normalized).length > 0 || Boolean(normalized.notes?.trim());
  }
  return Boolean(normalized.text?.trim());
}

function cellHasUnresolvedItem(cell, columnKey) {
  if (!ITEM_COLUMNS.has(columnKey)) return false;
  return buildSlotItems(cell).some((item) => item.unresolved || (item.itemName && !findOptionForItem(item)));
}

function sheetCellClass(cell, columnKey) {
  const classes = [];
  if (!cellHasContent(cell, columnKey)) classes.push('zvz-sheet-empty-cell');
  if (cellHasUnresolvedItem(cell, columnKey)) classes.push('zvz-sheet-unresolved-cell');
  return classes.join(' ') || undefined;
}

function normalizeCell(cell) {
  if (cell && typeof cell === 'object') {
    const legacyItem = cell.itemId || cell.itemName
      ? [{ itemId: cell.itemId || '', itemName: cell.itemName || '', unresolved: cell.unresolved, resolved: cell.resolved }]
      : [];
    const items = (Array.isArray(cell.items) && cell.items.length > 0 ? cell.items : legacyItem)
      .map(normalizeItem)
      .filter((item) => item.itemId || item.itemName);
    return {
      ...emptyCell(),
      ...cell,
      itemId: items[0]?.itemId || '',
      itemName: items[0]?.itemName || '',
      items,
    };
  }
  return { ...emptyCell(), text: String(cell || '') };
}

function normalizeHeaders(headers = DEFAULT_HEADERS) {
  return COLUMN_KEYS.map((_key, index) => String(headers[index] || DEFAULT_HEADERS[index] || ''));
}

function makeEmptyRow(index = 0) {
  return COLUMN_KEYS.map((key) => ({
    ...emptyCell(),
    text: key === 'number' ? String(index + 1) : '',
  }));
}

function buildItemCell(item) {
  const items = [item].filter(Boolean).map(normalizeItem);
  return {
    ...emptyCell(),
    itemId: items[0]?.itemId || '',
    itemName: items[0]?.itemName || '',
    items,
    notes: item?.annotation || '',
  };
}

function buildToSheetRow(build, index = 0) {
  const row = makeEmptyRow(index);
  row[0].text = String(build?.number || index + 1);
  row[1].text = build?.role || '';
  row[2] = buildSlotCell(build?.slots?.mainHand);
  row[3] = buildSlotCell(build?.slots?.offHand);
  row[4] = buildSlotCell(build?.slots?.helm);
  row[5] = buildSlotCell(build?.slots?.armor);
  row[6] = buildSlotCell(build?.slots?.boots);
  row[7] = buildSlotCell(build?.slots?.cape);
  row[8] = buildSlotCell(build?.slots?.foodPots);
  return row;
}

function buildSlotCell(slotItems = []) {
  const items = (slotItems || []).map(normalizeItem).filter((item) => item.itemId || item.itemName);
  return {
    ...emptyCell(),
    itemId: items[0]?.itemId || '',
    itemName: items[0]?.itemName || '',
    items,
    notes: [...new Set((slotItems || []).map((item) => item?.annotation || '').filter(Boolean))].join(' / '),
  };
}

function buildSheetFromBuilds(builds = []) {
  const first = builds.find((build) => Array.isArray(build.sheetHeaders));
  if (first) {
    return {
      headers: normalizeHeaders(first.sheetHeaders.length ? first.sheetHeaders : DEFAULT_HEADERS),
      rows: builds.map((build, index) => (
        Array.isArray(build.sheetRow)
          ? COLUMN_KEYS.map((_key, columnIndex) => normalizeCell(build.sheetRow[columnIndex]))
          : buildToSheetRow(build, index)
      )),
      t8Columns: first.sheetT8Columns && typeof first.sheetT8Columns === 'object'
        ? { ...DEFAULT_T8_COLUMNS, ...first.sheetT8Columns }
        : DEFAULT_T8_COLUMNS,
    };
  }

  return {
    headers: normalizeHeaders(DEFAULT_HEADERS),
    rows: builds.map(buildToSheetRow),
    t8Columns: DEFAULT_T8_COLUMNS,
  };
}

function findOption(cell) {
  const name = String(cell.itemName || '').toLowerCase();
  return ITEM_OPTIONS.find((item) => item.itemId === cell.itemId)
    || ALL_ITEM_OPTIONS.find((item) => item.itemId === cell.itemId)
    || ITEM_OPTIONS.find((item) => item.value.toLowerCase() === name)
    || ALL_ITEM_OPTIONS.find((item) => item.value.toLowerCase() === name)
    || rankedOptions(ITEM_OPTIONS, cell.itemName || '')[0]
    || rankedOptions(ALL_ITEM_OPTIONS, cell.itemName || '')[0]
    || ITEM_OPTIONS.find((item) => name && (
      item.value.toLowerCase().includes(name) || name.includes(item.value.toLowerCase())
    ))
    || ALL_ITEM_OPTIONS.find((item) => name && (
      item.value.toLowerCase().includes(name) || name.includes(item.value.toLowerCase())
    ));
}

function findOptionForItem(item, forceT8 = false) {
  if (item?.unresolved && !item?.itemId) return null;
  if (forceT8) {
    const itemId = t8ItemId(item.itemId);
    return T8_ITEM_OPTIONS.find((option) => option.itemId === itemId)
      || T8_ITEM_OPTIONS.find((option) => option.label.toLowerCase() === String(item.itemName || '').toLowerCase())
      || rankedOptions(T8_ITEM_OPTIONS, item.itemName || '')[0];
  }
  return findOption({ itemId: item.itemId, itemName: item.itemName });
}

function buildSlotItems(cell) {
  const normalized = normalizeCell(cell);
  return normalized.items.length > 0
    ? normalized.items
    : (normalized.itemId || normalized.itemName ? [normalizeItem(normalized)] : []);
}

function quantityForItem(itemId) {
  if (String(itemId || '').includes('_MEAL_')) return 2;
  if (String(itemId || '').includes('_POTION_REVIVE')) return 10;
  return 1;
}

function buildItemsFromCell(cell) {
  const normalized = normalizeCell(cell);
  return buildSlotItems(normalized).map((item) => {
    const option = findOptionForItem(item);
    const itemId = item.itemId || option?.itemId || '';
    return {
      annotation: normalized.notes || '',
      imageUrl: itemId ? option?.imageUrl || zvzItemImageUrl(itemId) : '',
      itemId,
      lookupName: option?.label || item.itemName,
      name: item.itemName || option?.label || '',
      quantity: quantityForItem(itemId),
      resolved: Boolean(itemId) && !item.unresolved,
      unresolved: Boolean(item.unresolved),
    };
  }).filter((item) => item.name || item.itemId);
}

function sheetCellExportValue(cell, columnKey) {
  const normalized = normalizeCell(cell);
  if (!ITEM_COLUMNS.has(columnKey)) return normalized.text || '';
  const itemText = buildSlotItems(normalized)
    .map((item) => item.itemName)
    .filter(Boolean)
    .join('\n');
  const notes = normalized.notes?.trim() ? `(${normalized.notes.trim()})` : '';
  return [itemText, notes].filter(Boolean).join(itemText && notes ? '\n' : '');
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - remainder - 1) / 26);
  }
  return name;
}

function exportedRowHeight(row) {
  const maxLines = Math.max(1, ...COLUMN_KEYS.map((key, columnIndex) => (
    String(sheetCellExportValue(row[columnIndex], key)).split(/\r?\n/).length
  )));
  if (maxLines <= 2) return 31.5;
  if (maxLines === 3) return 41.25;
  return Math.min(70.5, 21.75 + maxLines * 6.5);
}

async function buildFormattedZvZWorkbookBlob(headers, visibleRows) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const exportRows = [
    headers,
    ...visibleRows.map(({ row }) => COLUMN_KEYS.map((key, columnIndex) => sheetCellExportValue(row[columnIndex], key))),
  ];
  const columnWidths = [2.63, 12.63, 20.75, 10.13, 16.25, 20.13, 22.63, 20.13, 13.75];
  const colsXml = columnWidths.map((width, index) => (
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  )).join('');
  const rowsXml = exportRows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const styleId = rowIndex === 0 ? 1 : (rowIndex % 2 === 1 ? 2 : 3);
    const height = rowIndex === 0 ? 12.75 : exportedRowHeight(visibleRows[rowIndex - 1]?.row || []);
    const cellsXml = COLUMN_KEYS.map((_key, columnIndex) => {
      const value = row[columnIndex] ?? '';
      const ref = `${columnName(columnIndex)}${rowNumber}`;
      const cellStyleId = rowIndex > 0 && columnIndex === 0 ? (rowIndex % 2 === 1 ? 4 : 5) : styleId;
      return `<c r="${ref}" s="${cellStyleId}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowNumber}" ht="${height}" customHeight="1">${cellsXml}</row>`;
  }).join('');
  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml}</sheetData>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="8"/><name val="Arial"/></font>
    <font><b/><sz val="8"/><name val="Arial"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF8BC34A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEF7E3"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF000000"/></left>
      <right style="thin"><color rgb="FF000000"/></right>
      <top style="thin"><color rgb="FF000000"/></top>
      <bottom style="thin"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
  const created = new Date().toISOString();
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Militant</dc:creator>
  <cp:lastModifiedBy>Militant</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`;
  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Militant WebApp</Application>
</Properties>`;
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('xl/workbook.xml', workbookXml);
  zip.file('xl/_rels/workbook.xml.rels', workbookRelsXml);
  zip.file('xl/worksheets/sheet1.xml', worksheetXml);
  zip.file('xl/styles.xml', stylesXml);
  zip.file('docProps/core.xml', coreXml);
  zip.file('docProps/app.xml', appXml);
  return zip.generateAsync({
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    type: 'blob',
  });
}

function sheetToBuilds(headers, rows, t8Columns = DEFAULT_T8_COLUMNS) {
  const normalizedHeaders = normalizeHeaders(headers);
  return rows.map((row, index) => {
    const normalizedRow = COLUMN_KEYS.map((_key, columnIndex) => normalizeCell(row[columnIndex]));
    const slots = {
      armor: buildItemsFromCell(normalizedRow[5]),
      boots: buildItemsFromCell(normalizedRow[6]),
      cape: buildItemsFromCell(normalizedRow[7]),
      foodPots: buildItemsFromCell(normalizedRow[8]),
      helm: buildItemsFromCell(normalizedRow[4]),
      mainHand: buildItemsFromCell(normalizedRow[2]),
      offHand: buildItemsFromCell(normalizedRow[3]),
    };
    return {
      id: `${index}-${normalizedRow[0].text || normalizedRow[1].text || 'build'}`,
      notes: '',
      number: normalizedRow[0].text || String(index + 1),
      role: normalizedRow[1].text || '',
      sheetHeaders: normalizedHeaders,
      sheetRow: normalizedRow,
      sheetT8Columns: t8Columns,
      slots,
    };
  }).filter((build) => (
    build.role
    && Object.values(build.slots).some((items) => items.length > 0)
  ));
}

function ItemPreview({ cell, forceT8 = false }) {
  const items = buildSlotItems(cell);
  if (items.length === 0) return null;
  return (
    <span className="zvz-sheet-preview-shell">
      <span className="zvz-sheet-view-items">
        {items.map((item, index) => {
          const option = findOptionForItem(item, forceT8);
          const textOnly = !option?.imageUrl;
          return (
            <span className={`zvz-sheet-view-item${textOnly ? ' text-only' : ''}`} key={`${item.itemId}-${item.itemName}-${index}`}>
              {!textOnly && option?.imageUrl ? (
                <img src={option.imageUrl} alt="" loading="lazy" />
              ) : null}
              <strong>{item.itemName || option?.label}</strong>
            </span>
          );
        })}
      </span>
      {cell.notes ? <small className="zvz-sheet-cell-notes">{cell.notes}</small> : null}
    </span>
  );
}

function ItemCellEditor({ cell, disabled, forceT8 = false, onChange }) {
  const containerRef = useRef(null);
  const [addAfterIndex, setAddAfterIndex] = useState(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedItems = buildSlotItems(cell);
  const visibleOptions = useMemo(() => {
    const sourceOptions = forceT8 ? T8_ITEM_OPTIONS : ALL_ITEM_OPTIONS;
    return rankedOptions(sourceOptions, query).slice(0, 45);
  }, [forceT8, query]);

  useEffect(() => {
    warmItemImageCache(visibleOptions.map((option) => option.imageUrl));
  }, [visibleOptions]);

  useEffect(() => {
    setQuery('');
  }, [cell.itemName, cell.items]);

  useEffect(() => {
    if (!open) return undefined;
    function close(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
        if (!query.trim()) setAddAfterIndex(null);
      }
    }
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, query]);

  if (disabled) {
    return (
      <div className="zvz-sheet-view-cell">
        <ItemPreview cell={cell} forceT8={forceT8} />
      </div>
    );
  }

  function changeItems(nextItems) {
    onChange({
      ...cell,
      itemId: nextItems[0]?.itemId || '',
      itemName: nextItems[0]?.itemName || '',
      items: nextItems,
    });
  }

  function renderSearchRow(insertAfterIndex = -1) {
    return (
      <div className="zvz-sheet-add-item">
        <input
          aria-label="Add item"
          autoFocus
          placeholder="Search item"
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !query.trim()) {
              setOpen(false);
              setAddAfterIndex(null);
            }
          }}
        />
        {open ? (
          <div className="zvz-sheet-item-menu" role="listbox">
            {visibleOptions.map((option) => (
              <button
                key={`${option.itemId}-${option.label}`}
                type="button"
                onClick={() => {
                  const exists = selectedItems.some((item) => item.itemId === option.itemId);
                  const nextItems = exists
                    ? selectedItems
                    : [
                      ...selectedItems.slice(0, insertAfterIndex + 1),
                      { itemId: option.itemId, itemName: option.label },
                      ...selectedItems.slice(insertAfterIndex + 1),
                    ];
                  changeItems(nextItems);
                  setQuery('');
                  setOpen(false);
                  setAddAfterIndex(null);
                }}
              >
                <img src={option.imageUrl} alt="" loading="lazy" />
                <span>{option.label}</span>
              </button>
            ))}
            {visibleOptions.length === 0 ? <p>No items found.</p> : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="zvz-sheet-item-editor" ref={containerRef}>
      {selectedItems.length > 0 ? (
        <div className="zvz-sheet-edit-items">
          {selectedItems.map((item, index) => {
            const option = findOptionForItem(item, forceT8);
            const textOnly = !option?.imageUrl;
            return (
              <div className="zvz-sheet-edit-item-group" key={`${item.itemId}-${item.itemName}-${index}`}>
                <div className={`zvz-sheet-edit-item${textOnly ? ' text-only' : ''}`}>
                  {!textOnly && option?.imageUrl ? (
                    <img src={option.imageUrl} alt="" loading="lazy" />
                  ) : null}
                  {textOnly ? (
                    <span className="zvz-sheet-item-fallback">
                      {String(item.itemName || '?').slice(0, 2).toUpperCase()}
                    </span>
                  ) : null}
                  <strong>{item.itemName || option?.label}</strong>
                  <button
                    aria-label={`Remove ${item.itemName || option?.label || 'item'}`}
                    className="zvz-sheet-sign-button zvz-sheet-sign-minus"
                    type="button"
                    onClick={() => {
                      const nextItems = selectedItems.filter((_selected, selectedIndex) => selectedIndex !== index);
                      changeItems(nextItems);
                    }}
                  >
                    <Minus size={11} aria-hidden="true" />
                  </button>
                </div>
                {addAfterIndex === index ? renderSearchRow(index) : null}
              </div>
            );
          })}
          {addAfterIndex === selectedItems.length ? renderSearchRow(selectedItems.length - 1) : (
            <button
              aria-label="Add item"
              className="zvz-sheet-sign-button zvz-sheet-sign-plus zvz-sheet-list-plus"
              type="button"
              onClick={() => {
                setAddAfterIndex(selectedItems.length);
                setQuery('');
                setOpen(true);
              }}
            >
              <Plus size={11} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : (
        <div className="zvz-sheet-empty-item-editor">
          {addAfterIndex === -1 ? renderSearchRow(-1) : (
            <button
              aria-label="Add item"
              className="zvz-sheet-sign-button zvz-sheet-sign-plus zvz-sheet-empty-plus"
              type="button"
              onClick={() => {
                setAddAfterIndex(-1);
                setQuery('');
                setOpen(true);
              }}
            >
              <Plus size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div className="zvz-sheet-notes-editor">
        {editingNotes ? (
          <textarea
            aria-label="Cell notes"
            autoFocus
            placeholder="Cell notes"
            value={cell.notes}
            onChange={(event) => onChange({ ...cell, notes: event.target.value })}
            onBlur={() => setEditingNotes(false)}
          />
        ) : (
          <>
            <small>{cell.notes || 'No notes'}</small>
            <button className="zvz-sheet-mini-action" type="button" aria-label="Edit cell notes" onClick={() => setEditingNotes(true)}>
              <Pencil size={12} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SheetCell({ cell, columnKey, canEdit, forceT8 = false, onChange }) {
  const normalized = normalizeCell(cell);
  if (ITEM_COLUMNS.has(columnKey)) {
    return <ItemCellEditor cell={normalized} disabled={!canEdit} forceT8={forceT8} onChange={onChange} />;
  }

  if (!canEdit) return <span className="zvz-sheet-text-cell">{normalized.text}</span>;
  return (
    <textarea
      aria-label={`${columnKey} cell`}
      className="zvz-sheet-text-editor"
      value={normalized.text}
      wrap="off"
      onChange={(event) => onChange({ ...normalized, text: event.target.value })}
    />
  );
}

export default function ZvZSheet({
  canCopyScreenshot = false,
  canEdit = false,
  canExtract = false,
  uploadedBy = 'Unknown Server Member',
}) {
  const captureRef = useRef(null);
  const fileInputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [headers, setHeaders] = useState(DEFAULT_HEADERS);
  const [layoutId, setLayoutId] = useState('');
  const [loadingLayouts, setLoadingLayouts] = useState(true);
  const [pendingFileName, setPendingFileName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ label: '', progress: 0 });
  const [copyingSheet, setCopyingSheet] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentLayout, setCurrentLayout] = useState(null);
  const [rows, setRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFileName, setSourceFileName] = useState('');
  const [status, setStatus] = useState('');
  const [t8Columns, setT8Columns] = useState(DEFAULT_T8_COLUMNS);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const visibleRows = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    return rows
      .map((row, index) => ({ index, row }))
      .filter(({ row }) => !search || row.some((cell) => [
        cell.text,
        cell.itemName,
        cell.notes,
        cell.itemId,
        ...(cell.items || []).flatMap((item) => [item.itemName, item.itemId]),
      ].filter(Boolean).join(' ').toLowerCase().includes(search)));
  }, [rows, searchQuery]);

  function openLayout(layout) {
    const sheet = buildSheetFromBuilds(layout.builds || []);
    setHeaders(normalizeHeaders(sheet.headers));
    setRows(sheet.rows.length ? sheet.rows : [makeEmptyRow(0)]);
    setT8Columns(sheet.t8Columns || DEFAULT_T8_COLUMNS);
    setError('');
    setLayoutId(layout.id || '');
    setSearchQuery('');
    setSourceFileName(layout.sourceFileName || layout.source_file_name || '');
    setStatus('');
    setHasUnsavedChanges(false);
    setIsEditing(false);
    setCurrentLayout(layout);
  }

  useEffect(() => {
    let cancelled = false;
    fetchZvZBuildLayouts()
      .then((result) => {
        if (cancelled) return;
        const savedLayouts = Array.isArray(result.layouts) ? result.layouts : [];
        if (savedLayouts[0]) openLayout(savedLayouts[0]);
      })
      .catch((caughtError) => {
        if (!cancelled) setError(caughtError.message || 'Could not load saved ZVZ sheet.');
      })
      .finally(() => {
        if (!cancelled) setLoadingLayouts(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    warmItemImageCache(rows.flatMap((row) => (
      row.flatMap((cell, columnIndex) => (
        buildSlotItems(cell)
          .map((item) => findOptionForItem(item, Boolean(t8Columns[COLUMN_KEYS[columnIndex]]))?.imageUrl)
      )).filter(Boolean)
    )));
  }, [rows, t8Columns]);

  function updateCell(rowIndex, columnIndex, nextCell) {
    setRows((current) => current.map((row, index) => (
      index === rowIndex
        ? row.map((cell, cellIndex) => (cellIndex === columnIndex ? normalizeCell(nextCell) : cell))
        : row
    )));
    setStatus('');
    setHasUnsavedChanges(true);
  }

  function updateHeader(index, value) {
    setHeaders((current) => current.map((header, headerIndex) => (headerIndex === index ? value : header)));
    setStatus('');
    setHasUnsavedChanges(true);
  }

  function toggleT8Column(key) {
    setT8Columns((current) => ({
      ...current,
      [key]: !current[key],
    }));
    setStatus('');
    setHasUnsavedChanges(true);
  }

  async function saveSheet(nextRows = rows, nextSourceFileName = sourceFileName, allowDuringProcessing = false, nextHeaders = headers) {
    if (!canEdit || (processing && !allowDuringProcessing)) return;
    const nextBuilds = sheetToBuilds(nextHeaders, nextRows, t8Columns);
    if (nextBuilds.length === 0) {
      setError('Add at least one row with a role and item before saving.');
      return;
    }
    setProcessing(true);
    setError('');
    try {
      const payload = {
        builds: nextBuilds,
        sourceFileName: nextSourceFileName || 'ZVZ Sheet',
        title: 'ZVZ Sheet',
        uploadedBy,
      };
      const result = layoutId
        ? await updateZvZBuildLayout({ ...payload, id: layoutId })
        : await createZvZBuildLayout(payload);
      openLayout(result.layout);
      setStatus('Sheet saved.');
      setUploadModalOpen(false);
    } catch (caughtError) {
      setError(caughtError.message || 'Could not save the ZVZ sheet.');
    } finally {
      setProcessing(false);
    }
  }

  async function processFile(file) {
    if (!file || processing) return;
    setError('');
    setPendingFileName(file.name);
    setProcessing(true);
    setProgress({ label: 'Opening file', progress: 0.02 });
    try {
      const parsedBuilds = await parseZvZSpreadsheet(file, setProgress);
      const sheet = buildSheetFromBuilds(parsedBuilds);
      setHeaders(normalizeHeaders(sheet.headers));
      setRows(sheet.rows);
      setSourceFileName(file.name);
      setPendingFileName('');
      setProcessing(false);
      setUploadModalOpen(false);
      setStatus('Sheet loaded. Save to keep changes.');
      setHasUnsavedChanges(true);
      setIsEditing(true);
    } catch (caughtError) {
      setError(caughtError.message || 'Could not read the build sheet.');
      setPendingFileName('');
      setProcessing(false);
    }
  }

  function chooseFile() {
    fileInputRef.current?.click();
  }

  function startUpload() {
    setError('');
    setPendingFileName('');
    setProgress({ label: '', progress: 0 });
    setStatus('');
    setUploadModalOpen(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function cancelEditing() {
    if (currentLayout) {
      openLayout(currentLayout);
      return;
    }
    setHeaders(DEFAULT_HEADERS);
    setRows([]);
    setT8Columns(DEFAULT_T8_COLUMNS);
    setSourceFileName('');
    setStatus('');
    setHasUnsavedChanges(false);
    setIsEditing(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    processFile(event.dataTransfer.files?.[0]);
  }

  function addRow() {
    setRows((current) => [...current, makeEmptyRow(current.length)]);
    setStatus('');
    setHasUnsavedChanges(true);
  }

  function removeRow(rowIndex) {
    setRows((current) => current.filter((_row, index) => index !== rowIndex));
    setStatus('');
    setHasUnsavedChanges(true);
  }

  async function copyVisibleSheetScreenshot() {
    if (visibleRows.length === 0 || copyingSheet) return;
    setCopyingSheet(true);
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (!captureRef.current) throw new Error('Could not prepare screenshot.');
      await copyElementScreenshot(captureRef.current);
      setStatus('Screenshot copied.');
    } catch (caughtError) {
      setError(caughtError.message || 'Could not copy screenshot.');
    } finally {
      setCopyingSheet(false);
    }
  }

  async function extractVisibleSheet() {
    if (visibleRows.length === 0) return;
    setError('');
    try {
      const fileName = `zvz-sheet-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const blob = await buildFormattedZvZWorkbookBlob(headers, visibleRows);
      const link = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setStatus('Sheet extracted.');
    } catch (caughtError) {
      setError(caughtError.message || 'Could not extract the sheet.');
    }
  }

  return (
    <main className="zvz-shell">
      <section className="zvz-heading">
        <div>
          <p className="eyebrow">Tool</p>
          <h1>ZVZ Sheet</h1>
        </div>
        <div className="zvz-heading-actions">
          {rows.length > 0 ? (
            <label className="zvz-build-search zvz-heading-search">
              <span className="visually-hidden">Search</span>
              <input
                aria-label="Search builds"
                placeholder="Role, item, build..."
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
          ) : null}
          {rows.length > 0 && canExtract ? (
            <button className="secondary-button" type="button" onClick={extractVisibleSheet}>
              <FileSpreadsheet size={17} aria-hidden="true" />
              Extract
            </button>
          ) : null}
          {rows.length > 0 && canCopyScreenshot ? (
            <button className="secondary-button" type="button" onClick={copyVisibleSheetScreenshot}>
              <Clipboard size={17} aria-hidden="true" />
              Copy Screenshot
            </button>
          ) : null}
        </div>
      </section>

      {loadingLayouts ? <p className="zvz-library-message">Loading current sheet...</p> : null}
      {!loadingLayouts && rows.length === 0 ? <p className="zvz-library-message">No ZVZ sheet has been saved.</p> : null}
      {status ? <p className="zvz-status" role="status">{status}</p> : null}
      {error ? <p className="zvz-error zvz-load-error" role="alert">{error}</p> : null}

      <input
        accept={ACCEPTED_FILE_TYPES}
        className="visually-hidden"
        ref={fileInputRef}
        type="file"
        onChange={(event) => processFile(event.target.files?.[0])}
      />

      {canEdit && uploadModalOpen && typeof document !== 'undefined' ? createPortal(
        <div className="zvz-upload-modal-backdrop" role="presentation" onMouseDown={() => !processing && setUploadModalOpen(false)}>
          <section
            aria-labelledby="zvz-upload-modal-title"
            aria-modal="true"
            className="zvz-upload-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="zvz-upload-modal-heading">
              <div>
                <p className="eyebrow">ZVZ Sheet</p>
                <h2 id="zvz-upload-modal-title">Upload ZVZ Sheet</h2>
              </div>
              <button className="icon-button" disabled={processing} type="button" title="Close" aria-label="Close sheet uploader" onClick={() => setUploadModalOpen(false)}>
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            <div
              className={dragging ? 'zvz-upload drag-over' : 'zvz-upload'}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
              }}
              onDrop={handleDrop}
            >
              <div className="zvz-upload-icons" aria-hidden="true">
                <FileSpreadsheet size={30} />
                <FileImage size={30} />
              </div>
              <div className="zvz-upload-copy">
                <h2>{processing ? progress.label : 'Drop a sheet'}</h2>
                <p>{processing ? pendingFileName : 'Spreadsheet or image'}</p>
              </div>
              {processing ? (
                <div className="zvz-progress" aria-label={progress.label} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress.progress * 100)}>
                  <span style={{ width: `${Math.max(3, progress.progress * 100)}%` }} />
                </div>
              ) : (
                <button className="primary-button" type="button" onClick={chooseFile}>
                  <Upload size={18} aria-hidden="true" />
                  Choose File
                </button>
              )}
            </div>
          </section>
        </div>,
        document.body,
      ) : null}

      {rows.length > 0 || canEdit ? (
        <section className="zvz-sheet-panel" aria-label="ZVZ sheet">
          <div className="zvz-sheet-toolbar">
            <strong>{visibleRows.length} rows</strong>
            <div className="zvz-sheet-toolbar-actions">
              {canEdit && !isEditing ? (
                <button className="secondary-button" type="button" onClick={() => setIsEditing(true)}>
                  <Pencil size={16} aria-hidden="true" />
                  Edit
                </button>
              ) : null}
              {canEdit && isEditing ? (
                <button className="secondary-button" type="button" onClick={cancelEditing}>
                  <X size={16} aria-hidden="true" />
                  Cancel
                </button>
              ) : null}
              {canEdit && isEditing ? (
                <button
                  className={hasUnsavedChanges ? 'primary-button' : 'secondary-button'}
                  disabled={processing || !hasUnsavedChanges}
                  type="button"
                  onClick={() => saveSheet()}
                >
                  <Save size={16} aria-hidden="true" />
                  Save
                </button>
              ) : null}
              {canEdit && isEditing ? (
                <button className="secondary-button" disabled={processing} type="button" onClick={startUpload}>
                  <Upload size={16} aria-hidden="true" />
                  Upload
                </button>
              ) : null}
              {canEdit && isEditing ? (
                <button className="secondary-button" type="button" onClick={addRow}>
                  <Plus size={16} aria-hidden="true" />
                  Add Row
                </button>
              ) : null}
            </div>
          </div>
          <div className="zvz-sheet-scroll">
            <table className="zvz-sheet-table">
              <thead>
                <tr>
                  {headers.map((header, index) => (
                    <th key={`${COLUMN_KEYS[index]}-${index}`}>
                      <span className="zvz-sheet-header-cell">
                        {canEdit && isEditing ? (
                          <input
                            aria-label={`${header || COLUMN_KEYS[index]} header`}
                            value={header}
                            onChange={(event) => updateHeader(index, event.target.value)}
                          />
                        ) : <span>{header}</span>}
                        {isEditing && ITEM_COLUMNS.has(COLUMN_KEYS[index]) ? (
                          <button
                            aria-pressed={Boolean(t8Columns[COLUMN_KEYS[index]])}
                            className="zvz-sheet-tier-toggle"
                            type="button"
                            onClick={() => toggleT8Column(COLUMN_KEYS[index])}
                          >
                            T8
                          </button>
                        ) : null}
                      </span>
                    </th>
                  ))}
                  {canEdit && isEditing ? <th className="zvz-sheet-row-action-cell" aria-label="Row actions" /> : null}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(({ row, index: rowIndex }) => (
                  <tr key={`row-${rowIndex}`}>
                    {COLUMN_KEYS.map((key, columnIndex) => (
                      <td className={sheetCellClass(row[columnIndex], key)} key={`${rowIndex}-${key}`}>
                        <SheetCell
                          canEdit={canEdit && isEditing}
                          cell={row[columnIndex] || emptyCell()}
                          columnKey={key}
                          forceT8={Boolean(t8Columns[key])}
                          onChange={(nextCell) => updateCell(rowIndex, columnIndex, nextCell)}
                        />
                      </td>
                    ))}
                    {canEdit && isEditing ? (
                      <td className="zvz-sheet-row-action-cell">
                        <button className="zvz-row-delete" type="button" aria-label={`Delete row ${rowIndex + 1}`} onClick={() => removeRow(rowIndex)}>
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {copyingSheet ? (
            <div className="zvz-sheet-copy-capture" ref={captureRef} aria-hidden="true">
              <table className="zvz-sheet-table">
                <thead>
                  <tr>
                    {headers.map((header, index) => (
                      <th key={`copy-${COLUMN_KEYS[index]}-${index}`}>
                        <span className="zvz-sheet-header-cell">
                          <span>{header}</span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ row, index: rowIndex }) => (
                    <tr key={`copy-row-${rowIndex}`}>
                      {COLUMN_KEYS.map((key, columnIndex) => (
                        <td className={sheetCellClass(row[columnIndex], key)} key={`copy-${rowIndex}-${key}`}>
                          <SheetCell
                            canEdit={false}
                            cell={row[columnIndex] || emptyCell()}
                            columnKey={key}
                            forceT8={Boolean(t8Columns[key])}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}


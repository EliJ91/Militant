import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileImage, FileSpreadsheet, Pencil, Plus, Save, Upload, X } from 'lucide-react';
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

const ACCEPTED_FILE_TYPES = '.xlsx,.csv,.tsv,.txt,.png,.jpg,.jpeg,.webp,.bmp';
const DEFAULT_HEADERS = ['#', 'Role', 'Main Hand', 'Off Hand', 'Helm', 'Armor', 'Boots', 'Cape', 'Food/Pots', 'Notes'];
const COLUMN_KEYS = ['number', 'role', 'mainHand', 'offHand', 'helm', 'armor', 'boots', 'cape', 'foodPots', 'notes'];
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

function normalizeCell(cell) {
  if (cell && typeof cell === 'object') {
    const legacyItem = cell.itemId || cell.itemName
      ? [{ itemId: cell.itemId || '', itemName: cell.itemName || '' }]
      : [];
    const items = (Array.isArray(cell.items) && cell.items.length > 0 ? cell.items : legacyItem)
      .map((item) => ({
        itemId: item.itemId || '',
        itemName: canonicalItemName(item),
      }))
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

function makeEmptyRow(index = 0) {
  return COLUMN_KEYS.map((key) => ({
    ...emptyCell(),
    text: key === 'number' ? String(index + 1) : '',
  }));
}

function buildItemCell(item) {
  const items = [item].filter(Boolean).map((entry) => ({
    itemId: entry.itemId || '',
    itemName: canonicalItemName(entry),
  }));
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
  row[9].text = build?.notes || '';
  return row;
}

function buildSlotCell(slotItems = []) {
  const items = (slotItems || []).map((item) => ({
    itemId: item?.itemId || '',
    itemName: canonicalItemName(item),
  })).filter((item) => item.itemId || item.itemName);
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
      headers: first.sheetHeaders.length ? first.sheetHeaders : DEFAULT_HEADERS,
      rows: builds.map((build, index) => (
        Array.isArray(build.sheetRow)
          ? build.sheetRow.map(normalizeCell)
          : buildToSheetRow(build, index)
      )),
      t8Columns: first.sheetT8Columns && typeof first.sheetT8Columns === 'object'
        ? { ...DEFAULT_T8_COLUMNS, ...first.sheetT8Columns }
        : DEFAULT_T8_COLUMNS,
    };
  }

  return {
    headers: DEFAULT_HEADERS,
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
    : (normalized.itemId || normalized.itemName ? [{ itemId: normalized.itemId, itemName: normalized.itemName }] : []);
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
      imageUrl: option?.imageUrl || zvzItemImageUrl(itemId),
      itemId,
      lookupName: option?.label || item.itemName,
      name: item.itemName || option?.label || '',
      quantity: quantityForItem(itemId),
      resolved: Boolean(itemId),
    };
  }).filter((item) => item.name || item.itemId);
}

function sheetToBuilds(headers, rows, t8Columns = DEFAULT_T8_COLUMNS) {
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
      notes: normalizedRow[9].text || '',
      number: normalizedRow[0].text || String(index + 1),
      role: normalizedRow[1].text || '',
      sheetHeaders: headers,
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
    <span className="zvz-sheet-item-preview-list">
      <span className="zvz-sheet-item-image-stack">
        {items.map((item, index) => {
          const option = findOptionForItem(item, forceT8);
          return option?.imageUrl ? (
            <img key={`${item.itemId}-${item.itemName}-${index}`} src={option.imageUrl} alt="" loading="lazy" />
          ) : (
            <span className="zvz-sheet-item-fallback" key={`${item.itemId}-${item.itemName}-${index}`}>
              {String(item.itemName || '?').slice(0, 2).toUpperCase()}
            </span>
          );
        })}
      </span>
      <span className="zvz-sheet-item-copy">
        {items.map((item, index) => {
          const option = findOptionForItem(item, forceT8);
          return (
            <strong key={`${item.itemId}-${item.itemName}-${index}`}>{item.itemName || option?.label}</strong>
          );
        })}
        {cell.notes ? <small className="zvz-sheet-cell-notes">{cell.notes}</small> : null}
      </span>
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
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

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
            return (
              <div className="zvz-sheet-edit-item-group" key={`${item.itemId}-${item.itemName}-${index}`}>
                <div className="zvz-sheet-edit-item">
                  {option?.imageUrl ? (
                    <img src={option.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="zvz-sheet-item-fallback">
                      {String(item.itemName || '?').slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <strong>{item.itemName || option?.label}</strong>
                  <span className="zvz-sheet-item-actions">
                    <button
                      aria-label={`Remove ${item.itemName || option?.label || 'item'}`}
                      className="zvz-sheet-sign-button zvz-sheet-sign-minus"
                      type="button"
                      onClick={() => {
                        const nextItems = selectedItems.filter((_selected, selectedIndex) => selectedIndex !== index);
                        changeItems(nextItems);
                      }}
                    >
                      -
                    </button>
                    <button
                      aria-label={`Add item after ${item.itemName || option?.label || 'item'}`}
                      className="zvz-sheet-sign-button zvz-sheet-sign-plus"
                      type="button"
                      onClick={() => {
                        setAddAfterIndex(index);
                        setQuery('');
                        setOpen(true);
                      }}
                    >
                      +
                    </button>
                  </span>
                </div>
                {addAfterIndex === index ? renderSearchRow(index) : null}
              </div>
            );
          })}
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
              +
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
      onChange={(event) => onChange({ ...normalized, text: event.target.value })}
    />
  );
}

export default function ZvZSheet({ canEdit = false, uploadedBy = 'Unknown Server Member' }) {
  const fileInputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [headers, setHeaders] = useState(DEFAULT_HEADERS);
  const [layoutId, setLayoutId] = useState('');
  const [loadingLayouts, setLoadingLayouts] = useState(true);
  const [pendingFileName, setPendingFileName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ label: '', progress: 0 });
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
    setHeaders(sheet.headers);
    setRows(sheet.rows.length ? sheet.rows : [makeEmptyRow(0)]);
    setT8Columns(sheet.t8Columns || DEFAULT_T8_COLUMNS);
    setError('');
    setLayoutId(layout.id || '');
    setSearchQuery('');
    setSourceFileName(layout.sourceFileName || layout.source_file_name || '');
    setStatus('');
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
  }

  function updateHeader(index, value) {
    setHeaders((current) => current.map((header, headerIndex) => (headerIndex === index ? value : header)));
    setStatus('');
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
      setHeaders(sheet.headers);
      setRows(sheet.rows);
      setSourceFileName(file.name);
      setPendingFileName('');
      setProcessing(false);
      await saveSheet(sheet.rows, file.name, true, sheet.headers);
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

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    processFile(event.dataTransfer.files?.[0]);
  }

  function addRow() {
    setRows((current) => [...current, makeEmptyRow(current.length)]);
    setStatus('');
  }

  function removeRow(rowIndex) {
    setRows((current) => current.filter((_row, index) => index !== rowIndex));
    setStatus('');
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
          {canEdit ? (
            <>
              <button className="secondary-button" type="button" onClick={startUpload}>
                <Upload size={17} aria-hidden="true" />
                Update
              </button>
              <button className="primary-button" disabled={processing} type="button" onClick={() => saveSheet()}>
                <Save size={17} aria-hidden="true" />
                Save
              </button>
            </>
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
                <h2 id="zvz-upload-modal-title">Update ZVZ Sheet</h2>
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

      {rows.length > 0 ? (
        <section className="zvz-sheet-panel" aria-label="ZVZ sheet">
          <div className="zvz-sheet-toolbar">
            <strong>{visibleRows.length} rows</strong>
            {canEdit ? (
              <button className="secondary-button" type="button" onClick={addRow}>
                <Plus size={16} aria-hidden="true" />
                Add Row
              </button>
            ) : null}
          </div>
          <div className="zvz-sheet-scroll">
            <table className="zvz-sheet-table">
              <thead>
                <tr>
                  {headers.map((header, index) => (
                    <th key={`${COLUMN_KEYS[index]}-${index}`}>
                      <span className="zvz-sheet-header-cell">
                        {canEdit ? (
                          <input
                            aria-label={`${header || COLUMN_KEYS[index]} header`}
                            value={header}
                            onChange={(event) => updateHeader(index, event.target.value)}
                          />
                        ) : <span>{header}</span>}
                        {ITEM_COLUMNS.has(COLUMN_KEYS[index]) ? (
                          <button
                            aria-pressed={Boolean(t8Columns[COLUMN_KEYS[index]])}
                            className="zvz-sheet-tier-toggle"
                            type="button"
                            onClick={() => setT8Columns((current) => ({
                              ...current,
                              [COLUMN_KEYS[index]]: !current[COLUMN_KEYS[index]],
                            }))}
                          >
                            T8
                          </button>
                        ) : null}
                      </span>
                    </th>
                  ))}
                  {canEdit ? <th aria-label="Row actions" /> : null}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(({ row, index: rowIndex }) => (
                  <tr key={`row-${rowIndex}`}>
                    {COLUMN_KEYS.map((key, columnIndex) => (
                      <td className={cellHasContent(row[columnIndex], key) ? undefined : 'zvz-sheet-empty-cell'} key={`${rowIndex}-${key}`}>
                        <SheetCell
                          canEdit={canEdit}
                          cell={row[columnIndex] || emptyCell()}
                          columnKey={key}
                          forceT8={Boolean(t8Columns[key])}
                          onChange={(nextCell) => updateCell(rowIndex, columnIndex, nextCell)}
                        />
                      </td>
                    ))}
                    {canEdit ? (
                      <td>
                <button className="zvz-row-delete" type="button" aria-label={`Delete row ${rowIndex + 1}`} onClick={() => removeRow(rowIndex)}>
                          -
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}


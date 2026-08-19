import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileImage, FileSpreadsheet, Plus, Save, Upload, X } from 'lucide-react';
import {
  createZvZBuildLayout,
  fetchZvZBuildLayouts,
  updateZvZBuildLayout,
} from '../services/zvzBuildsApi';
import { warmItemImageCache } from '../utils/itemImageCache';
import {
  getZvZItemOptions,
  parseZvZSpreadsheet,
  rowsToZvZBuilds,
  stripAlbionRankPrefix,
} from '../utils/zvzInfographic';

const ACCEPTED_FILE_TYPES = '.xlsx,.csv,.tsv,.txt,.png,.jpg,.jpeg,.webp,.bmp';
const DEFAULT_HEADERS = ['#', 'Role', 'Main Hand', 'Off Hand', 'Helm', 'Armor', 'Boots', 'Cape', 'Food/Pots', 'Notes'];
const COLUMN_KEYS = ['number', 'role', 'mainHand', 'offHand', 'helm', 'armor', 'boots', 'cape', 'foodPots', 'notes'];
const ITEM_COLUMNS = new Set(['mainHand', 'offHand', 'helm', 'armor', 'boots', 'cape', 'foodPots']);
const ITEM_OPTIONS = getZvZItemOptions();

function emptyCell() {
  return { itemId: '', itemName: '', notes: '', text: '' };
}

function normalizeCell(cell) {
  if (cell && typeof cell === 'object') {
    return { ...emptyCell(), ...cell, itemName: stripAlbionRankPrefix(cell.itemName || '') };
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
  return {
    ...emptyCell(),
    itemId: item?.itemId || '',
    itemName: stripAlbionRankPrefix(item?.name || ''),
    notes: item?.annotation || '',
  };
}

function buildToSheetRow(build, index = 0) {
  const row = makeEmptyRow(index);
  row[0].text = String(build?.number || index + 1);
  row[1].text = build?.role || '';
  row[2] = buildItemCell(build?.slots?.mainHand?.[0]);
  row[3] = buildItemCell(build?.slots?.offHand?.[0]);
  row[4] = buildItemCell(build?.slots?.helm?.[0]);
  row[5] = buildItemCell(build?.slots?.armor?.[0]);
  row[6] = buildItemCell(build?.slots?.boots?.[0]);
  row[7] = buildItemCell(build?.slots?.cape?.[0]);
  row[8] = buildItemCell(build?.slots?.foodPots?.[0]);
  row[9].text = build?.notes || '';
  return row;
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
    };
  }

  return {
    headers: DEFAULT_HEADERS,
    rows: builds.map(buildToSheetRow),
  };
}

function cellTextForBuild(cell, key) {
  if (ITEM_COLUMNS.has(key)) return [cell.itemName, cell.notes].filter(Boolean).join('\n');
  return cell.text || '';
}

function sheetToBuilds(headers, rows) {
  const spreadsheetRows = [
    DEFAULT_HEADERS,
    ...rows.map((row) => row.map((cell, index) => cellTextForBuild(normalizeCell(cell), COLUMN_KEYS[index]))),
  ];
  return rowsToZvZBuilds(spreadsheetRows).map((build, index) => ({
    ...build,
    sheetHeaders: headers,
    sheetRow: rows[index] || makeEmptyRow(index),
  }));
}

function findOption(cell) {
  const name = String(cell.itemName || '').toLowerCase();
  return ITEM_OPTIONS.find((item) => item.itemId === cell.itemId)
    || ITEM_OPTIONS.find((item) => item.value.toLowerCase() === name)
    || ITEM_OPTIONS.find((item) => name && (
      item.value.toLowerCase().includes(name) || name.includes(item.value.toLowerCase())
    ));
}

function ItemPreview({ cell }) {
  const option = findOption(cell);
  if (!option && !cell.itemName) return null;
  return (
    <span className="zvz-sheet-item-preview">
      {option?.imageUrl ? <img src={option.imageUrl} alt="" loading="lazy" /> : <span>{String(cell.itemName || '?').slice(0, 2).toUpperCase()}</span>}
      <strong>{cell.itemName || option?.label}</strong>
    </span>
  );
}

function ItemCellEditor({ cell, disabled, onChange }) {
  const containerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(cell.itemName || '');
  const visibleOptions = useMemo(() => {
    const search = query.trim().toLowerCase();
    return ITEM_OPTIONS
      .filter((option) => !search || option.searchText.includes(search))
      .slice(0, 45);
  }, [query]);

  useEffect(() => {
    setQuery(cell.itemName || '');
  }, [cell.itemName]);

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
        <ItemPreview cell={cell} />
        {cell.notes ? <small>{cell.notes}</small> : null}
      </div>
    );
  }

  return (
    <div className="zvz-sheet-item-editor" ref={containerRef}>
      <input
        aria-label="Select item"
        placeholder="Select item"
        value={query}
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          onChange({ ...cell, itemId: '', itemName: value });
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
                onChange({ ...cell, itemId: option.itemId, itemName: option.value });
                setQuery(option.value);
                setOpen(false);
              }}
            >
              <img src={option.imageUrl} alt="" loading="lazy" />
              <span>{option.label}</span>
            </button>
          ))}
          {visibleOptions.length === 0 ? <p>No items found.</p> : null}
        </div>
      ) : null}
      <textarea
        aria-label="Item notes"
        placeholder="Notes"
        value={cell.notes}
        onChange={(event) => onChange({ ...cell, notes: event.target.value })}
      />
    </div>
  );
}

function SheetCell({ cell, columnKey, canEdit, onChange }) {
  const normalized = normalizeCell(cell);
  if (ITEM_COLUMNS.has(columnKey)) {
    return <ItemCellEditor cell={normalized} disabled={!canEdit} onChange={onChange} />;
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

export default function ZvZInfographic({ canEdit = false, uploadedBy = 'Unknown Server Member' }) {
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
      ].filter(Boolean).join(' ').toLowerCase().includes(search)));
  }, [rows, searchQuery]);

  function openLayout(layout) {
    const sheet = buildSheetFromBuilds(layout.builds || []);
    setHeaders(sheet.headers);
    setRows(sheet.rows.length ? sheet.rows : [makeEmptyRow(0)]);
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
      row.map((cell) => findOption(cell)?.imageUrl).filter(Boolean)
    )));
  }, [rows]);

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
    const nextBuilds = sheetToBuilds(nextHeaders, nextRows);
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
                      {canEdit ? (
                        <input
                          aria-label={`${header || COLUMN_KEYS[index]} header`}
                          value={header}
                          onChange={(event) => updateHeader(index, event.target.value)}
                        />
                      ) : header}
                    </th>
                  ))}
                  {canEdit ? <th aria-label="Row actions" /> : null}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(({ row, index: rowIndex }) => (
                  <tr key={`row-${rowIndex}`}>
                    {COLUMN_KEYS.map((key, columnIndex) => (
                      <td key={`${rowIndex}-${key}`}>
                        <SheetCell
                          canEdit={canEdit}
                          cell={row[columnIndex] || emptyCell()}
                          columnKey={key}
                          onChange={(nextCell) => updateCell(rowIndex, columnIndex, nextCell)}
                        />
                      </td>
                    ))}
                    {canEdit ? (
                      <td>
                        <button className="zvz-row-delete" type="button" onClick={() => removeRow(rowIndex)}>
                          Delete
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

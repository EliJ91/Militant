import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileImage, FileSpreadsheet, Plus, Upload, X } from 'lucide-react';
import {
  createZvZBuildLayout,
  fetchZvZBuildLayouts,
  updateZvZBuildLayout,
} from '../services/zvzBuildsApi';
import { warmItemImageCache } from '../utils/itemImageCache';
import {
  filterZvZBuilds,
  groupDuplicateZvZBuilds,
  parseZvZSpreadsheet,
  resolveZvZItem,
  sortIncompleteZvZBuildsLast,
  zvzItemImageUrl,
  ZVZ_SLOT_DEFINITIONS,
} from '../utils/zvzInfographic';

const ACCEPTED_FILE_TYPES = '.xlsx,.csv,.tsv,.txt,.png,.jpg,.jpeg,.webp,.bmp';

function formatAnnotation(annotation) {
  return String(annotation || '')
    .split(/\s+or\s+/i)
    .map((option) => `(${option})`)
    .join(' or ');
}

function ItemVariant({ item, multiple, slot, stacked = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedFallback = resolveZvZItem(item.name, slot);
  const resolved = item.resolved || resolvedFallback.resolved;
  const imageUrl = item.imageUrl || zvzItemImageUrl(item.itemId || resolvedFallback.itemId);
  const initials = item.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <div className={`zvz-item-variant${multiple ? ' compact' : ''}${stacked ? ' stacked' : ''}`} title={resolved ? item.lookupName || resolvedFallback.lookupName : `${item.name} (image not matched)`}>
      <span className={resolved ? 'zvz-item-image' : 'zvz-item-image unresolved'}>
        {imageUrl && !imageFailed ? (
          <img src={imageUrl} alt={item.name} onError={() => setImageFailed(true)} />
        ) : <span>{initials || '?'}</span>}
        {item.quantity > 1 ? <small className="zvz-item-quantity">{item.quantity}</small> : null}
      </span>
      <span className="zvz-item-copy">
        <strong>{item.name}</strong>
        {item.annotation ? <small>{formatAnnotation(item.annotation)}</small> : null}
      </span>
    </div>
  );
}

function BuildCard({ build }) {
  const notesControlRef = useRef(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const visibleSlots = ZVZ_SLOT_DEFINITIONS.filter(({ key }) => (
    key !== 'offHand' && build.slots[key]?.length > 0
  ));
  const hasWeaponRow = build.slots.mainHand?.length > 0 || build.slots.offHand?.length > 0;
  const weaponItems = [
    ...(build.slots.mainHand || []).map((item) => ({ item, slot: 'mainHand' })),
    ...(build.slots.offHand || []).map((item) => ({ item, slot: 'offHand' })),
  ];
  const compactWeaponItems = weaponItems.length > 1;
  const weaponName = build.slots.mainHand?.length === 1
    ? build.slots.mainHand[0].name
    : build.slots.mainHand?.length > 1 ? 'Choose' : 'Not listed';

  useEffect(() => {
    if (!notesOpen) return undefined;

    function closeNotes(event) {
      if (!notesControlRef.current?.contains(event.target)) setNotesOpen(false);
    }

    document.addEventListener('pointerdown', closeNotes);
    return () => document.removeEventListener('pointerdown', closeNotes);
  }, [notesOpen]);

  return (
    <article className="zvz-build-card">
      <header className="zvz-build-heading">
        <span className="zvz-build-number">{build.number}</span>
        <div className="zvz-build-identity">
          <p><span>Weapon:</span> <strong>{weaponName}</strong></p>
          <p><span>Role:</span> <strong>{build.role}</strong></p>
        </div>
        <div className="zvz-notes-control" ref={notesControlRef}>
          <button type="button" onClick={() => setNotesOpen((open) => !open)} aria-expanded={notesOpen}>
            Notes
          </button>
          {notesOpen ? (
            <div className="zvz-notes-popover" role="note">
              {build.notes || 'No notes.'}
            </div>
          ) : null}
        </div>
      </header>
      <div className="zvz-build-slots">
        {hasWeaponRow ? (
          <section className="zvz-build-slot zvz-weapon-row" aria-label="Main Hand and Off Hand">
            {weaponItems.length >= 3 ? (
              <div className="zvz-slot-variants multiple zvz-weapon-variants">
                {weaponItems.map(({ item, slot }, index) => (
                  <ItemVariant item={item} key={`${item.name}-${item.annotation}-${index}`} multiple slot={slot} stacked />
                ))}
              </div>
            ) : ['mainHand', 'offHand'].map((key) => {
                const items = build.slots[key] || [];
                if (items.length === 0) return null;
                const multiple = items.length > 1;
                return (
                  <div className={multiple ? 'zvz-slot-variants multiple' : 'zvz-slot-variants'} key={key}>
                    {items.map((item, index) => (
                      <ItemVariant item={item} key={`${item.name}-${item.annotation}-${index}`} multiple={compactWeaponItems} slot={key} />
                    ))}
                  </div>
                );
              })}
          </section>
        ) : null}
        {visibleSlots.map(({ key, label }) => {
          if (key === 'mainHand') return null;
          const items = build.slots[key];
          const multiple = items.length > 1;
          return (
            <section className="zvz-build-slot" key={key} aria-label={label}>
              <div className={multiple ? 'zvz-slot-variants multiple' : 'zvz-slot-variants'}>
                {items.map((item, index) => (
                  <ItemVariant
                    item={item}
                    key={`${item.name}-${item.annotation}-${index}`}
                    multiple={multiple}
                    slot={key}
                    stacked={items.length >= 3}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </article>
  );
}

export default function ZvZInfographic({ canEdit = false, uploadedBy = 'Unknown Server Member' }) {
  const fileInputRef = useRef(null);
  const [builds, setBuilds] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [layouts, setLayouts] = useState([]);
  const [loadingLayouts, setLoadingLayouts] = useState(true);
  const [pendingFileName, setPendingFileName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ label: '', progress: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLayoutId, setSelectedLayoutId] = useState('');
  const [status, setStatus] = useState('');
  const [title, setTitle] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  function openLayout(layout) {
    setBuilds(layout.builds || []);
    setError('');
    setProgress({ label: '', progress: 0 });
    setSearchQuery('');
    setSelectedLayoutId(layout.id);
    setStatus('');
    setTitle(layout.title);
  }

  useEffect(() => {
    let cancelled = false;
    fetchZvZBuildLayouts()
      .then((result) => {
        if (cancelled) return;
        const savedLayouts = Array.isArray(result.layouts) ? result.layouts : [];
        setLayouts(savedLayouts);
        if (savedLayouts[0]) openLayout(savedLayouts[0]);
      })
      .catch((caughtError) => {
        if (!cancelled) setError(caughtError.message || 'Could not load saved ZVZ build layouts.');
      })
      .finally(() => {
        if (!cancelled) setLoadingLayouts(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function processFile(file) {
    if (!file || processing) return;
    setError('');
    setPendingFileName(file.name);
    setProcessing(true);
    setProgress({ label: 'Opening file', progress: 0.02 });
    try {
      const parsedBuilds = await parseZvZSpreadsheet(file, setProgress);
      const nextTitle = title.trim() || file.name.replace(/\.[^.]+$/, '');
      setProgress({ label: 'Saving layout', progress: 0.96 });
      const payload = {
        builds: parsedBuilds,
        sourceFileName: file.name,
        title: nextTitle,
        uploadedBy,
      };
      const result = selectedLayoutId
        ? await updateZvZBuildLayout({ ...payload, id: selectedLayoutId })
        : await createZvZBuildLayout(payload);
      const savedLayout = result.layout;
      setLayouts([savedLayout]);
      openLayout(savedLayout);
      setStatus('Layout updated.');
      setUploadModalOpen(false);
    } catch (caughtError) {
      setError(caughtError.message || 'Could not read the build sheet.');
    } finally {
      setPendingFileName('');
      setProcessing(false);
    }
  }

  function chooseFile() {
    fileInputRef.current?.click();
  }

  function startNewLayout() {
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

  const groupedBuilds = sortIncompleteZvZBuildsLast(groupDuplicateZvZBuilds(builds));
  const visibleBuilds = filterZvZBuilds(groupedBuilds, searchQuery);

  useEffect(() => {
    warmItemImageCache(builds.flatMap((build) => (
      Object.values(build.slots).flat().map((item) => item.imageUrl)
    )));
  }, [builds]);

  return (
    <main className="zvz-shell">
      <section className="zvz-heading">
        <div>
          <p className="eyebrow">Tool</p>
          <h1>ZVZ Build Layouts</h1>
        </div>
        {builds.length > 0 || canEdit ? (
          <div className="zvz-heading-actions">
            {builds.length > 0 ? (
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
              <button className="secondary-button" type="button" onClick={startNewLayout}>
                <Plus size={17} aria-hidden="true" />
                {layouts[0] ? 'Update' : 'Add Layout'}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {loadingLayouts ? <p className="zvz-library-message">Loading current layout...</p> : null}
      {!loadingLayouts && layouts.length === 0 ? <p className="zvz-library-message">No ZVZ layout has been saved.</p> : null}
      {error && builds.length === 0 && !canEdit ? <p className="zvz-error zvz-load-error" role="alert">{error}</p> : null}

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
                <p className="eyebrow">ZVZ Build Layouts</p>
                <h2 id="zvz-upload-modal-title">{layouts[0] ? 'Update ZVZ Layout' : 'Add ZVZ Layout'}</h2>
              </div>
              <button className="icon-button" disabled={processing} type="button" title="Close" aria-label="Close new layout" onClick={() => setUploadModalOpen(false)}>
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
                <h2>{processing ? progress.label : 'Drop a build sheet'}</h2>
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
              {error ? <p className="zvz-error" role="alert">{error}</p> : null}
            </div>
          </section>
        </div>,
        document.body,
      ) : null}

      {builds.length > 0 ? (
        <>
          {status ? <p className="zvz-status" role="status">{status}</p> : null}
          {error ? <p className="zvz-error" role="alert">{error}</p> : null}
          <section className="zvz-build-board" aria-label="ZVZ build layouts">
            {visibleBuilds.map((build) => <BuildCard build={build} key={build.id} />)}
          </section>
          {visibleBuilds.length === 0 ? <p className="zvz-no-results">No builds match this search.</p> : null}
        </>
      ) : null}
    </main>
  );
}

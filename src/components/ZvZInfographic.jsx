import { useEffect, useRef, useState } from 'react';
import { FileImage, FileSpreadsheet, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import {
  createZvZBuildLayout,
  deleteZvZBuildLayout,
  fetchZvZBuildLayouts,
  updateZvZBuildLayout,
} from '../services/zvzBuildsApi';
import { warmItemImageCache } from '../utils/itemImageCache';
import {
  filterZvZBuilds,
  groupDuplicateZvZBuilds,
  parseZvZSpreadsheet,
  sortIncompleteZvZBuildsLast,
  ZVZ_SLOT_DEFINITIONS,
} from '../utils/zvzInfographic';

const ACCEPTED_FILE_TYPES = '.xlsx,.csv,.tsv,.txt,.png,.jpg,.jpeg,.webp,.bmp';

function formatAnnotation(annotation) {
  return String(annotation || '')
    .split(/\s+or\s+/i)
    .map((option) => `(${option})`)
    .join(' or ');
}

function ItemVariant({ item, multiple, stacked = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = item.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <div className={`zvz-item-variant${multiple ? ' compact' : ''}${stacked ? ' stacked' : ''}`} title={item.resolved ? item.lookupName : `${item.name} (image not matched)`}>
      <span className={item.resolved ? 'zvz-item-image' : 'zvz-item-image unresolved'}>
        {item.imageUrl && !imageFailed ? (
          <img src={item.imageUrl} alt={item.name} onError={() => setImageFailed(true)} />
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
  const weaponItems = [...(build.slots.mainHand || []), ...(build.slots.offHand || [])];
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
                {weaponItems.map((item, index) => (
                  <ItemVariant item={item} key={`${item.name}-${item.annotation}-${index}`} multiple stacked />
                ))}
              </div>
            ) : ['mainHand', 'offHand'].map((key) => {
                const items = build.slots[key] || [];
                if (items.length === 0) return null;
                const multiple = items.length > 1;
                return (
                  <div className={multiple ? 'zvz-slot-variants multiple' : 'zvz-slot-variants'} key={key}>
                    {items.map((item, index) => (
                      <ItemVariant item={item} key={`${item.name}-${item.annotation}-${index}`} multiple={compactWeaponItems} />
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

function formatSavedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export default function ZvZInfographic({ canEdit = false, uploadedBy = 'Unknown Server Member' }) {
  const fileInputRef = useRef(null);
  const [builds, setBuilds] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [layouts, setLayouts] = useState([]);
  const [loadingLayouts, setLoadingLayouts] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ label: '', progress: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLayoutId, setSelectedLayoutId] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [title, setTitle] = useState('');

  function openLayout(layout) {
    setBuilds(layout.builds || []);
    setError('');
    setFileName(layout.sourceFileName || 'Saved build');
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
        if (!cancelled) setError(caughtError.message || 'Could not load saved ZvZ builds.');
      })
      .finally(() => {
        if (!cancelled) setLoadingLayouts(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function processFile(file) {
    if (!file || processing) return;
    setError('');
    setBuilds([]);
    setFileName(file.name);
    setProcessing(true);
    setProgress({ label: 'Opening file', progress: 0.02 });
    try {
      const parsedBuilds = await parseZvZSpreadsheet(file, setProgress);
      setBuilds(parsedBuilds);
      setSelectedLayoutId('');
      setTitle(file.name.replace(/\.[^.]+$/, ''));
      setStatus('');
    } catch (caughtError) {
      setFileName('');
      setError(caughtError.message || 'Could not read the build sheet.');
    } finally {
      setProcessing(false);
    }
  }

  function chooseFile() {
    fileInputRef.current?.click();
  }

  function clearFile() {
    setBuilds([]);
    setError('');
    setFileName('');
    setSelectedLayoutId('');
    setSearchQuery('');
    setStatus('');
    setTitle('');
    setProgress({ label: '', progress: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function saveLayout() {
    if (!canEdit || saving) return;
    if (!title.trim()) {
      setError('Enter a title before saving.');
      return;
    }
    setSaving(true);
    setError('');
    setStatus(selectedLayoutId ? 'Overwriting saved build...' : 'Saving build...');
    try {
      const payload = {
        builds,
        sourceFileName: fileName,
        title: title.trim(),
        uploadedBy,
      };
      const result = selectedLayoutId
        ? await updateZvZBuildLayout({ ...payload, id: selectedLayoutId })
        : await createZvZBuildLayout(payload);
      const savedLayout = result.layout;
      setLayouts((current) => [savedLayout, ...current.filter((layout) => layout.id !== savedLayout.id)]);
      openLayout(savedLayout);
      setStatus(selectedLayoutId ? 'Build overwritten.' : 'Build saved.');
    } catch (caughtError) {
      setError(caughtError.message || 'Could not save the ZvZ build.');
      setStatus('');
    } finally {
      setSaving(false);
    }
  }

  async function deleteLayout() {
    if (!canEdit || !selectedLayoutId || saving) return;
    const selectedLayout = layouts.find((layout) => layout.id === selectedLayoutId);
    if (!window.confirm(`Delete "${selectedLayout?.title || title}"?`)) return;
    setSaving(true);
    setError('');
    setStatus('Deleting build...');
    try {
      await deleteZvZBuildLayout({ id: selectedLayoutId, title: selectedLayout?.title || title });
      const remaining = layouts.filter((layout) => layout.id !== selectedLayoutId);
      setLayouts(remaining);
      if (remaining[0]) openLayout(remaining[0]);
      else clearFile();
      setStatus('Build deleted.');
    } catch (caughtError) {
      setError(caughtError.message || 'Could not delete the ZvZ build.');
      setStatus('');
    } finally {
      setSaving(false);
    }
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
          <h1>ZvZ Builds</h1>
        </div>
        {canEdit ? (
          <div className="zvz-heading-actions">
            <button className="secondary-button" type="button" onClick={clearFile}>
              <Plus size={17} aria-hidden="true" />
              New Build
            </button>
          </div>
        ) : null}
      </section>

      <section className="zvz-library" aria-labelledby="zvz-library-title">
        <div className="zvz-library-heading">
          <div>
            <p className="eyebrow">Saved Layouts</p>
            <h2 id="zvz-library-title">Build Library</h2>
          </div>
          <strong>{layouts.length}</strong>
        </div>
        {loadingLayouts ? <p className="zvz-library-message">Loading saved builds...</p> : null}
        {!loadingLayouts && layouts.length === 0 ? (
          <p className="zvz-library-message">{canEdit ? 'No builds have been saved yet.' : 'No saved ZvZ builds are available.'}</p>
        ) : null}
        {layouts.length > 0 ? (
          <div className="zvz-library-list">
            {layouts.map((layout) => (
              <button
                className={selectedLayoutId === layout.id ? 'zvz-library-card selected' : 'zvz-library-card'}
                key={layout.id}
                type="button"
                onClick={() => openLayout(layout)}
              >
                <strong>{layout.title}</strong>
                <span>Uploaded by {layout.uploadedBy}</span>
                <small>{layout.builds.length} builds · {formatSavedDate(layout.updatedAt)}</small>
              </button>
            ))}
          </div>
        ) : null}
      </section>
      {error && builds.length === 0 && !canEdit ? <p className="zvz-error zvz-load-error" role="alert">{error}</p> : null}

      <input
        accept={ACCEPTED_FILE_TYPES}
        className="visually-hidden"
        ref={fileInputRef}
        type="file"
        onChange={(event) => processFile(event.target.files?.[0])}
      />

      {builds.length === 0 && canEdit ? (
        <section
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
            <p>{processing ? fileName : 'Spreadsheet or image'}</p>
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
        </section>
      ) : builds.length > 0 ? (
        <>
          <section className="zvz-file-summary">
            {canEdit ? (
              <label className="zvz-title-input">
                <span>Build Title</span>
                <input
                  aria-label="Build title"
                  maxLength="120"
                  placeholder="Name this build"
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
            ) : (
              <div>
                <span>Build</span>
                <strong>{title}</strong>
              </div>
            )}
            <label className="zvz-build-search">
              <span>Search</span>
              <input
                aria-label="Search builds"
                placeholder="Role, item, build..."
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
            <div>
              <span>Uploaded By</span>
              <strong>{layouts.find((layout) => layout.id === selectedLayoutId)?.uploadedBy || uploadedBy}</strong>
            </div>
          </section>
          {canEdit ? (
            <div className="zvz-editor-actions">
              <button className="secondary-button" disabled={saving} type="button" onClick={chooseFile}>
                <Upload size={17} aria-hidden="true" />
                Replace File
              </button>
              <button className="primary-button" disabled={saving || !title.trim()} type="button" onClick={saveLayout}>
                <Save size={17} aria-hidden="true" />
                {selectedLayoutId ? 'Overwrite Build' : 'Save Build'}
              </button>
              {selectedLayoutId ? (
                <button className="zvz-delete-button" disabled={saving} type="button" onClick={deleteLayout}>
                  <Trash2 size={17} aria-hidden="true" />
                  Delete
                </button>
              ) : null}
              <button className="icon-button" disabled={saving} type="button" title="Clear build sheet" aria-label="Clear build sheet" onClick={clearFile}>
                <X size={19} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {status ? <p className="zvz-status" role="status">{status}</p> : null}
          {error ? <p className="zvz-error" role="alert">{error}</p> : null}
          <section className="zvz-build-board" aria-label="ZvZ builds">
            {visibleBuilds.map((build) => <BuildCard build={build} key={build.id} />)}
          </section>
          {visibleBuilds.length === 0 ? <p className="zvz-no-results">No builds match this search.</p> : null}
        </>
      ) : null}
    </main>
  );
}

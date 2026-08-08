import { useEffect, useRef, useState } from 'react';
import { FileImage, FileSpreadsheet, Upload, X } from 'lucide-react';
import { warmItemImageCache } from '../utils/itemImageCache';
import {
  parseZvZSpreadsheet,
  ZVZ_SLOT_DEFINITIONS,
} from '../utils/zvzInfographic';

const ACCEPTED_FILE_TYPES = '.xlsx,.csv,.tsv,.txt,.png,.jpg,.jpeg,.webp,.bmp';

function ItemVariant({ item, multiple }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = item.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <div className={multiple ? 'zvz-item-variant compact' : 'zvz-item-variant'} title={item.resolved ? item.lookupName : `${item.name} (image not matched)`}>
      <span className={item.resolved ? 'zvz-item-image' : 'zvz-item-image unresolved'}>
        {item.imageUrl && !imageFailed ? (
          <img src={item.imageUrl} alt={item.name} onError={() => setImageFailed(true)} />
        ) : <span>{initials || '?'}</span>}
        {item.quantity > 1 ? <small className="zvz-item-quantity">{item.quantity}</small> : null}
      </span>
      <span className="zvz-item-copy">
        <strong>{item.name}</strong>
        {item.annotation ? <small>{`(${item.annotation})`}</small> : null}
      </span>
    </div>
  );
}

function BuildCard({ build }) {
  const visibleSlots = ZVZ_SLOT_DEFINITIONS.filter(({ key }) => (
    key !== 'offHand' && build.slots[key]?.length > 0
  ));
  const hasWeaponRow = build.slots.mainHand?.length > 0 || build.slots.offHand?.length > 0;

  return (
    <article className="zvz-build-card">
      <header className="zvz-build-heading">
        <span className="zvz-build-number">{build.number}</span>
        <div>
          <span>Role</span>
          <h2>{build.role}</h2>
        </div>
      </header>
      <div className="zvz-build-slots">
        {hasWeaponRow ? (
          <section className="zvz-build-slot zvz-weapon-row" aria-label="Main Hand and Off Hand">
            {['mainHand', 'offHand'].map((key) => {
              const items = build.slots[key] || [];
              if (items.length === 0) return null;
              const multiple = items.length > 1;
              return (
                <div className={multiple ? 'zvz-slot-variants multiple' : 'zvz-slot-variants'} key={key}>
                  {items.map((item, index) => (
                    <ItemVariant item={item} key={`${item.name}-${item.annotation}-${index}`} multiple={multiple} />
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
                  <ItemVariant item={item} key={`${item.name}-${item.annotation}-${index}`} multiple={multiple} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </article>
  );
}

export default function ZvZInfographic() {
  const fileInputRef = useRef(null);
  const [builds, setBuilds] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ label: '', progress: 0 });

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
    setProgress({ label: '', progress: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    processFile(event.dataTransfer.files?.[0]);
  }

  const unresolvedCount = builds.reduce((total, build) => (
    total + Object.values(build.slots).flat().filter((item) => !item.resolved).length
  ), 0);

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
          <h1>ZvZ Infographic</h1>
        </div>
        {builds.length > 0 ? (
          <div className="zvz-heading-actions">
            <button className="secondary-button" type="button" onClick={chooseFile}>
              <Upload size={17} aria-hidden="true" />
              Replace
            </button>
            <button className="icon-button" type="button" title="Clear build sheet" aria-label="Clear build sheet" onClick={clearFile}>
              <X size={19} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </section>

      <input
        accept={ACCEPTED_FILE_TYPES}
        className="visually-hidden"
        ref={fileInputRef}
        type="file"
        onChange={(event) => processFile(event.target.files?.[0])}
      />

      {builds.length === 0 ? (
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
      ) : (
        <>
          <section className="zvz-file-summary">
            <div>
              <span>Source</span>
              <strong>{fileName}</strong>
            </div>
            <div>
              <span>Builds</span>
              <strong>{builds.length}</strong>
            </div>
            <div>
              <span>Unmatched</span>
              <strong className={unresolvedCount > 0 ? 'warning' : ''}>{unresolvedCount}</strong>
            </div>
          </section>
          <section className="zvz-build-board" aria-label="ZvZ builds">
            {builds.map((build) => <BuildCard build={build} key={build.id} />)}
          </section>
        </>
      )}
    </main>
  );
}

import { ChevronDown } from 'lucide-react';

const GUIDE_SECTIONS = [
  {
    steps: [
      <><strong>Webapp:</strong> Use <strong>Upload</strong> to add one or more <strong>.csv/.txt</strong> loot log files.</>,
      <><strong>Discord:</strong> Run <code>/upload</code> in the thread containing the loot log files and select the CTA's UTC start hour for <strong>CTA Timer</strong>.</>,
    ],
    title: 'Upload Loot Logs',
  },
  {
    steps: [
      <>Copy every relevant page from the bank tab's chest log.</>,
      <>Use the <strong>+</strong> beside <strong>Chest linked</strong> or <strong>No chest log</strong> to paste the log or add <strong>.txt/.tsv</strong> files.</>,
    ],
    title: 'Upload Chest Logs',
  },
  {
    steps: [
      <>Right-click loot logs, or press and hold on mobile, to select at least two entries.</>,
      <><strong>Merge</strong> creates a combined entry from their loot and chest logs. The original entries remain unchanged.</>,
    ],
    title: 'Merge Loot Logs',
  },
  {
    steps: [
      <>Select a player's name and use <strong>Check Recent Deaths</strong> to view their Murderledger deaths.</>,
      <>Copy the numeric ID from the correct death. For example, in the URL <code>"/kill/123456789"</code> has death ID <strong>123456789</strong>.</>,
    ],
    title: 'Check And Add Deaths',
  },
];

const STATUS_LEGEND = [
  { className: 'legend-kept', description: 'Loot still held by a player and not deposited or lost.', label: 'Kept' },
  { className: 'legend-accounted', description: 'Kept loot matched to a verified player death.', label: 'Accounted' },
  { className: 'legend-donated', description: 'Loot deposited in the final chest that was not expected from the loot log.', label: 'Donated' },
  { className: 'legend-resolved', description: 'Loot successfully traced to the final chest.', label: 'Resolved' },
  { className: 'legend-lost', description: 'Loot lost when the looting player died.', label: 'Lost' },
];

export default function ViewLootLogsUploadInstructions({ onClose }) {
  return (
    <div className="upload-instructions-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="upload-instructions-title"
        aria-modal="true"
        className="upload-instructions-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="upload-instructions-heading">
          <h2 id="upload-instructions-title">Upload Instructions</h2>
          <button
            aria-label="Close upload instructions"
            className="raw-log-modal-close"
            title="Close"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="upload-instructions-body">
          <section className="upload-guide-intro">
            <p className="eyebrow">Loot Log Guide</p>
            <div className="upload-guide-formats" aria-label="Supported file formats">
              <span><strong>Loot logs</strong> .csv or .txt</span>
              <span><strong>Chest logs</strong> paste, .txt, or .tsv</span>
            </div>
          </section>
          <div className="upload-guide-sections">
            {GUIDE_SECTIONS.map((section, sectionIndex) => (
              <details className="upload-guide-section" key={section.title}>
                <summary>
                  <span>{String(sectionIndex + 1).padStart(2, '0')}</span>
                  <h3>{section.title}</h3>
                  <ChevronDown aria-hidden="true" className="upload-guide-chevron" size={20} strokeWidth={2} />
                </summary>
                <div className="upload-guide-content">
                  <ol>
                    {section.steps.map((step, stepIndex) => <li key={`${section.title}-${stepIndex}`}>{step}</li>)}
                  </ol>
                </div>
              </details>
            ))}
          </div>
        </div>
        <section className="upload-guide-legend" aria-labelledby="loot-status-guide-title">
          <h3 id="loot-status-guide-title">Item Status Colors</h3>
          <div className="upload-guide-legend-items">
            {STATUS_LEGEND.map((status) => (
              <div className="upload-guide-legend-item" key={status.label}>
                <span aria-hidden="true" className={`upload-guide-status-dot ${status.className}`} />
                <p><strong>{status.label}</strong> {status.description}</p>
              </div>
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}

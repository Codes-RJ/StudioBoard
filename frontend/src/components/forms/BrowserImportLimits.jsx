import { MAX_LOCAL_DATASET_BYTES, MAX_LOCAL_DATASET_ROWS, MAX_LOCAL_DATASET_COLUMNS,
  MAX_SELECTED_SOURCE_ROWS, MAX_SELECTED_SOURCE_TEXT_BYTES } from '../../utils/browserCapacityPolicy';
import DisclosurePanel from '../common/DisclosurePanel';

export default function BrowserImportLimits({ compact = false, variant = 'notice' }) {
  const content = <div role="note" aria-label="Browser import and analysis limits" className={variant !== 'notice' ? 'browser-limits-quiet' : 'rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950'}>
    <p><strong>Import:</strong> up to {MAX_LOCAL_DATASET_BYTES / 1024 / 1024} MiB per file, {MAX_LOCAL_DATASET_ROWS.toLocaleString('en-US')} rows per source and {MAX_LOCAL_DATASET_COLUMNS} columns.</p>
    <p className="mt-1"><strong>Opening a saved source for review or charts:</strong> up to {MAX_SELECTED_SOURCE_ROWS.toLocaleString('en-US')} working rows and {MAX_SELECTED_SOURCE_TEXT_BYTES / 1024 / 1024} MiB of estimated row text. A file that imports successfully can still exceed these limits.</p>
    <p className="mt-1">Split large or wide files by date, sheet or category before importing. Full-source totals can scan saved pages; median calculations retain at most 250,000 contributing values. These limits do not guarantee performance on every device.</p>
  </div>;
  if (variant === 'summary') return <div className="capacity-summary"><p><strong>Import:</strong> {MAX_LOCAL_DATASET_BYTES / 1024 / 1024} MiB / {MAX_LOCAL_DATASET_ROWS.toLocaleString('en-US', { notation: 'compact' })} rows. <strong>Review &amp; charts:</strong> {MAX_SELECTED_SOURCE_ROWS.toLocaleString('en-US', { notation: 'compact' })} rows / {MAX_SELECTED_SOURCE_TEXT_BYTES / 1024 / 1024} MiB working text.</p><DisclosurePanel label="Import and analysis limits">{content}</DisclosurePanel></div>;
  return compact ? <details className="text-xs text-slate-700"><summary className="cursor-pointer py-2">Browser import and analysis limits</summary>{content}</details> : content;
}

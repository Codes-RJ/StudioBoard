import { useEffect, useRef, useState } from 'react';
import DataQualityPanel from './DataQualityPanel';
import { getStoredDatasetVersion } from '../../utils/datasetWorkerPayload';
import useModalFocus from '../../hooks/useModalFocus';
export default function SavedDataQualityPanel({ dataset, onClose, ...props }) {
  const [loaded, setLoaded] = useState(null); const [error, setError] = useState('');
  const dialog = useRef(null);
  useEffect(() => {
    let cancelled = false; const controller = new AbortController(); setLoaded(null); setError('');
    if (dataset.rowStreamsDeferred) void import('../../utils/localDatasetStore').then(({ loadLocalDataset }) => loadLocalDataset(dataset.id,
      { signal: controller.signal, expectedStorageRevision: getStoredDatasetVersion(dataset), retainedPolicy: { rows: 250_000, bytes: 32 * 1024 * 1024 } })).then((source) => {
      if (!source) throw new Error('This source was deleted.');
      if (!cancelled) setLoaded({ input: dataset, source });
    }).catch((failure) => { if (!cancelled) setError(failure.message); });
    return () => { cancelled = true; controller.abort(); };
  }, [dataset]);
  const source = dataset.rowStreamsDeferred ? loaded?.input === dataset ? loaded.source : null : dataset;
  useModalFocus(dialog, { open: !source, onClose, resetKey: error ? 'error' : 'loading' });
  if (!source) return <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Opening data quality review" aria-busy={!error} className="fixed inset-0 z-50 grid place-content-center bg-white p-6"><p role={error ? 'alert' : 'status'}>{error || 'Opening original rows and cleaning history for review…'}</p><button type="button" onClick={onClose} className="mt-4 rounded-sm border border-slate-300 p-3">Cancel review</button></div>;
  return <DataQualityPanel dataset={source} onClose={onClose} {...props} />;
}

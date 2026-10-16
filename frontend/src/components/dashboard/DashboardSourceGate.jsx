import { useDashboard } from '../../context/DashboardContext';
import { SAMPLE_DATASETS } from '../../utils/localDataEngine';
import { SERVER_WORKSPACE_ENABLED } from '../../config/workspace';
import { isQualityApproved } from '../../utils/qualityReview';
import QualityReviewGate from './QualityReviewGate';
import BrowserImportLimits from '../forms/BrowserImportLimits';
import toast from 'react-hot-toast';

export default function DashboardSourceGate({ settings, children }) {
  const { selectedDataset, datasets, datasetLoadState, setSelectedDataset,
    localSaveConflicts = [], reloadSavedLocalDataset, preserveLocalDatasetCopy } = useDashboard();
  const recoverSource = async (conflict, copy) => {
    try {
      const source = await (copy ? preserveLocalDatasetCopy : reloadSavedLocalDataset)(conflict.id);
      if (copy || selectedDataset?.id === conflict.id) setSelectedDataset(source || datasets.find(({ id }) => id !== conflict.id) || null);
    } catch (error) { toast.error(error.message || 'Could not recover this source.'); }
  };
  if (!settings.sections.showDashboard) {
    return <section className="mx-auto flex min-h-[calc(100svh-8rem)] max-w-3xl items-center px-4 py-12"><p className="border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">The dashboard workspace is currently unavailable.</p></section>;
  }
  const sources = selectedDataset?.isFolderOverview
    ? datasets.filter((source) => source.folderId === selectedDataset.folderId && !source.isFolderOverview)
    : selectedDataset ? [selectedDataset] : [];
  const reviewable = sources.filter((source) => source.isLocal && (source.qualityReviewRequired
    || !SAMPLE_DATASETS.some(({ id }) => id === source.id)));
  const needsReview = !SERVER_WORKSPACE_ENABLED && reviewable.some((source) => !isQualityApproved(source));
  return <>
    {localSaveConflicts.map((conflict) => <div key={conflict.id} role="alert" className="mx-auto max-w-7xl rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <p><strong>{conflict.name || 'Dataset'}:</strong> {conflict.message}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <button type="button" onClick={() => void recoverSource(conflict, true)} className="rounded-sm border border-amber-500 px-3 py-2 font-semibold">Save unsaved rows as a copy</button>
        <button type="button" onClick={() => void recoverSource(conflict, false)} className="rounded-sm border border-amber-500 px-3 py-2">Discard unsaved rows and reload saved source</button>
      </div>
    </div>)}
    {datasetLoadState && <div role={datasetLoadState.status === 'error' ? 'alert' : 'status'} className="mx-auto max-w-7xl px-4 pt-4 text-sm text-slate-700">
      {datasetLoadState.status === 'loading' ? `Opening ${datasetLoadState.name}…` : datasetLoadState.error}
      {datasetLoadState.status === 'error' && <button type="button" className="ml-3 underline" onClick={() => setSelectedDataset(datasets.find(({ id }) => id === datasetLoadState.id))}>Retry opening dataset</button>}
      {datasetLoadState.status === 'error' && <BrowserImportLimits />}
    </div>}
    {needsReview ? <QualityReviewGate sources={reviewable} /> : children}
  </>;
}


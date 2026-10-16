import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDashboard } from '../../context/DashboardContext';
import { isQualityApproved } from '../../utils/qualityReview';

const DataQualityPanel = lazy(() => import('./SavedDataQualityPanel'));

export default function QualityReviewGate({ sources }) {
  const { datasets, setSelectedDataset, loadLocalDatasets } = useDashboard();
  const [reviewId, setReviewId] = useState(null);
  const [loadedReview, setLoadedReview] = useState(null);
  const [loadError, setLoadError] = useState('');
  const reviewRequest = useRef(0);
  const candidate = datasets.find(({ id }) => id === reviewId);
  const reviewing = candidate?.rawRows ? candidate : loadedReview;
  useEffect(() => { if (candidate?.rawRows) setLoadedReview(candidate); }, [candidate]);
  const openReview = async (source) => {
    const version = ++reviewRequest.current;
    setReviewId(source.id); setLoadedReview(null); setLoadError('');
    try {
      const [loaded] = loadLocalDatasets ? await loadLocalDatasets([source]) : [source];
      if (reviewRequest.current === version) setLoadedReview(loaded);
    } catch (error) { if (reviewRequest.current === version) setLoadError(error.message); }
  };
  const closeReview = () => { reviewRequest.current += 1; setReviewId(null); setLoadedReview(null); setLoadError(''); };
  useEffect(() => () => { reviewRequest.current += 1; }, []);
  const pending = sources.filter((source) => !isQualityApproved(source));
  return <section className="site-container max-w-4xl py-12">
    <h1 className="font-serif text-4xl font-normal tracking-tight text-slate-900">Review data before visualization</h1>
    <p className="mt-3 text-sm leading-6 text-slate-600">Your data stays in this browser. Review types, roles and missing cells for each source. Charts, reports and the assistant open after the reviewed data is saved locally.</p>
    <p role="status" className="mt-4 text-sm font-semibold text-slate-700">{sources.length - pending.length} of {sources.length} sources reviewed</p>
    <ul className="mt-4 space-y-3">
      {sources.map((source) => <li key={source.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="min-w-0"><h2 className="break-words font-semibold text-slate-900">{source.name}</h2>
          <p className="mt-1 text-xs text-slate-500">{(source.rawRows?.length ?? source.rowCount).toLocaleString()} rows · {source.columns.length} columns · {isQualityApproved(source) ? 'Reviewed' : 'Review required'}</p></div>
        <button type="button" onClick={() => void openReview(source)} className="btn-primary">Review Data</button>
      </li>)}
    </ul>
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Link to="/upload" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Import other data</Link>
      <label className="text-sm text-slate-600">Switch dataset
        <select aria-label="Switch dataset during review" onChange={(event) => setSelectedDataset(datasets.find(({ id }) => id === event.target.value))}
          defaultValue="" className="ml-2 max-w-full rounded-lg border border-slate-300 p-2">
          <option value="" disabled>Select a dataset</option>
          {datasets.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
    </div>
    {reviewId && !reviewing && !loadError && <p role="status">Opening data review…</p>}
    {loadError && <p role="alert">{loadError}</p>}
    {reviewing && <Suspense fallback={<p role="status">Opening data review…</p>}><DataQualityPanel dataset={reviewing} requiredReview onClose={closeReview} /></Suspense>}
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import { runLocalTransform } from '../../utils/localTransforms';
import { relationshipNeedsReview } from '../../utils/datasetRelationships';
import { qualityRevisionKey } from '../../utils/qualityReview';
import ManualRelationshipReview from './ManualRelationshipReview';
import { loadLocalDataset } from '../../utils/localDatasetStore';
import { encodeDatasetPayload } from '../../utils/datasetWorkerPayload';

// Avoid cloning cleaning history, metrics and unrelated sources into workers.
const workerSource = (source) => encodeDatasetPayload({ dataset: source }).dataset;
const hydrateSources = (sources) => Promise.all(sources.map(async (source) => {
  if (!source.metadataOnly || source.storageRevision) return source;
  const loaded = await loadLocalDataset(source.id);
  if (!loaded || qualityRevisionKey(loaded) !== qualityRevisionKey(source)) throw new Error('A saved source changed. Reload the workspace before reviewing relationships.');
  return loaded;
}));

export default function FolderOverviewPanel({ dataset, datasets, onSelect, onUpdate, loadSources = hydrateSources }) {
  const [loadingRelationships, setLoadingRelationships] = useState(false);
  const [relationshipError, setRelationshipError] = useState('');
  const [crossAnalysis, setCrossAnalysis] = useState({});
  const requests = useRef(new Map());

  const overview = datasets.find((item) => item.folderId === dataset?.folderId && item.isFolderOverview);
  const children = datasets
    .filter((item) => item.folderId === dataset?.folderId && !item.isFolderOverview)
    .sort((left, right) => (left.sourcePath || '').localeCompare(right.sourcePath || '') || (left.sheetName || '').localeCompare(right.sheetName || ''));
  const relationships = (dataset?.relationships || []).map((item) => relationshipNeedsReview(item, children)
    ? { ...item, status: 'needs_review' } : item);
  const workVersion = JSON.stringify([dataset?.id,
    children.map((source) => [source.id, qualityRevisionKey(source)]),
    relationships.map(({ id, status, leftUpdatedAt, rightUpdatedAt, leftRevisionKey, rightRevisionKey }) => [id, status, leftUpdatedAt, rightUpdatedAt, leftRevisionKey, rightRevisionKey]),
  ]);
  const latest = useRef(null);
  latest.current = { workVersion, children, dataset, onUpdate };
  useEffect(() => {
    setCrossAnalysis({});
    setRelationshipError('');
    setLoadingRelationships(false);
    const activeRequests = requests.current;
    return () => {
      activeRequests.forEach((controller) => controller.abort());
      activeRequests.clear();
    };
  }, [workVersion]);
  const requestIsCurrent = (id, controller) => !controller.signal.aborted
    && requests.current.get(id) === controller && latest.current.workVersion === workVersion
    && children.every((source) => {
      const current = latest.current.children.find(({ id: sourceId }) => sourceId === source.id);
      return current?.rawRows === source.rawRows && current?.columns === source.columns;
    });
  const updateAnalysisSelection = (id, updates) => {
    requests.current.get(id)?.abort();
    requests.current.delete(id);
    setCrossAnalysis((current) => ({ ...current, [id]: { ...current[id], ...updates, loading: false, result: null, error: '' } }));
  };
  if (!dataset?.folderId) return null;

  const collectionLabel = dataset.collectionKind === 'workbook' ? 'workbook' : 'folder';
  if (!dataset.isFolderOverview) {
    const sourceLabel = dataset.sourcePath?.startsWith(`${dataset.folderName}/`)
      ? dataset.sourcePath.slice(dataset.folderName.length + 1)
      : dataset.sourcePath || dataset.name;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
        <div><strong>{dataset.folderName || 'Folder'}</strong> / {sourceLabel}{dataset.sheetName ? ` / ${dataset.sheetName}` : ''}</div>
        {overview && <button type="button" onClick={() => onSelect(overview)} className="rounded-lg bg-indigo-700 px-3 py-2 font-semibold text-white hover:bg-indigo-800">Back to {collectionLabel} overview</button>}
      </div>
    );
  }

  const reviewRelationships = async () => {
    const controller = new AbortController();
    requests.current.get('relationships')?.abort();
    requests.current.set('relationships', controller);
    setLoadingRelationships(true);
    setRelationshipError('');
    try {
      const loaded = children.some((source) => source.metadataOnly && !source.storageRevision) ? await loadSources(children) : children;
      if (!requestIsCurrent('relationships', controller)) return;
      const found = await runLocalTransform('discover-relationships', { datasets: loaded.map(workerSource), manualRelationships: relationships.filter((item) => item.manual) }, { signal: controller.signal });
      if (!requestIsCurrent('relationships', controller)) return;
      const previous = new Map(relationships.map((item) => [item.id, item]));
      const next = found.map((item) => {
        const old = previous.get(item.id);
        return old && old.leftUpdatedAt === item.leftUpdatedAt && old.rightUpdatedAt === item.rightUpdatedAt
          ? { ...item, status: old.status, leftRevisionKey: old.leftRevisionKey, rightRevisionKey: old.rightRevisionKey } : item;
      });
      latest.current.onUpdate?.({ ...latest.current.dataset, relationships: next, updatedAt: new Date().toISOString() });
    } catch (error) {
      if (requestIsCurrent('relationships', controller)) setRelationshipError(error?.message || 'Could not analyze possible relationships.');
    } finally {
      if (requests.current.get('relationships') === controller) {
        requests.current.delete('relationships');
        setLoadingRelationships(false);
      }
    }
  };
  const setRelationshipStatus = (id, status) => onUpdate?.({
    ...dataset,
    relationships: relationships.map((item) => item.id === id ? { ...item, status,
      leftRevisionKey: qualityRevisionKey(children.find((source) => source.id === item.leftDatasetId)),
      rightRevisionKey: qualityRevisionKey(children.find((source) => source.id === item.rightDatasetId)) } : item),
    updatedAt: new Date().toISOString()
  });
  const numericFields = (source) => source?.metrics?.columnGroups?.numeric
    || (source?.columns || []).filter((column) => typeof column === 'object' && column.type === 'number').map(({ name }) => name);
  const groupingFields = (source) => source?.metrics?.columnGroups?.dimensions
    || source?.metrics?.columnGroups?.categorical
    || (source?.columns || []).filter((column) => typeof column === 'string' || column.type !== 'number').map((column) => typeof column === 'string' ? column : column.name);
  const runCrossAnalysis = async (item) => {
    const controller = new AbortController();
    requests.current.get(item.id)?.abort();
    requests.current.set(item.id, controller);
    const selection = crossAnalysis[item.id] || {};
    setCrossAnalysis((current) => ({ ...current, [item.id]: { ...selection, loading: true, error: '', result: null } }));
    try {
      const inputs = children.filter(({ id }) => id === item.leftDatasetId || id === item.rightDatasetId);
      const loaded = inputs.some((source) => source.metadataOnly && !source.storageRevision) ? await loadSources(inputs) : inputs;
      if (!requestIsCurrent(item.id, controller)) return;
      const result = await runLocalTransform('analyze-approved-relationship', {
        datasets: loaded.map(workerSource),
        relationship: item,
        metric: selection.metric || '__rows__',
        aggregation: selection.aggregation || 'count',
        dimension: selection.dimension || '',
        measureGrain: selection.measureGrain || 'source',
      }, { signal: controller.signal });
      if (!requestIsCurrent(item.id, controller)) return;
      setCrossAnalysis((current) => ({ ...current, [item.id]: { ...current[item.id], loading: false, result } }));
    } catch (error) {
      if (requestIsCurrent(item.id, controller)) setCrossAnalysis((current) => ({ ...current, [item.id]: { ...current[item.id], loading: false, error: error?.message || 'Analysis failed.' } }));
    } finally {
      if (requests.current.get(item.id) === controller) requests.current.delete(item.id);
    }
  };

  return (
    <section aria-label={`${collectionLabel === 'workbook' ? 'Workbook' : 'Folder'} overview`} className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Whole {collectionLabel} analysis</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">{dataset.folderName || 'Folder'}</h2>
          <p className="mt-1 text-sm text-slate-600">{children.length} datasets from {dataset.sourceFileCount || 0} {dataset.sourceFileCount === 1 ? 'file' : 'files'} · {(dataset.totalSourceRows || 0).toLocaleString()} source rows</p>
        </div>
        <p className="max-w-xl text-sm text-slate-600">The charts below summarize files and worksheets. Open any source for its full rows, charts, cleaning, assistant, report, and export tools.</p>
      </div>
      <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-slate-200">
        {children.map((child) => (
          <button key={child.id} type="button" onClick={() => onSelect(child)} className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-left text-sm hover:bg-indigo-50 last:border-0">
            <span className="min-w-0 font-semibold text-slate-900">{child.sourcePath}{child.sheetName ? ` / ${child.sheetName}` : ''}</span>
            <span className="text-slate-600">{child.rowCount.toLocaleString()} rows · {child.columns.length} columns</span>
          </button>
        ))}
      </div>
      <section aria-label="Possible cross-file relationships" className="mt-5 border-t border-slate-200 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="font-semibold text-slate-900">Possible relationships</h3><p className="text-sm text-slate-600">Local key overlap and join-size estimates. Nothing is joined unless you approve a relationship.</p><p className="mt-1 text-xs text-slate-500">Up to 20 suggestions from the 30 highest-ranked header matches. Other relationships may exist.</p></div>
          <button type="button" disabled={loadingRelationships || children.length < 2} onClick={reviewRelationships} className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{loadingRelationships ? 'Checking…' : 'Review possible relationships'}</button>
        </div>
        {relationshipError && <p role="alert" className="mt-3 text-sm text-red-700">{relationshipError}</p>}
        <ManualRelationshipReview sources={children} loadSources={loadSources} onCandidate={(candidate) => onUpdate?.({ ...dataset,
          relationships: [...relationships.filter((item) => item.id !== candidate.id), candidate], updatedAt: new Date().toISOString() })} />
        {!relationships.length && <p className="mt-3 text-sm text-slate-500">No relationship analysis yet.</p>}
        <div className="mt-3 space-y-3">
          {relationships.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-slate-900">{item.leftLabel} · {item.leftColumn} ↔ {item.rightLabel} · {item.rightColumn}</p><p className="mt-1 text-sm text-slate-600">{item.cardinality}; {item.leftUnique ? 'left key unique' : 'left key repeats'}; {item.rightUnique ? 'right key unique' : 'right key repeats'}; {item.matchedDistinct.toLocaleString()} shared keys</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase text-slate-700">{item.status.replace('_', ' ')}</span></div>
            <p className="mt-2 text-sm text-slate-600">Estimated left join: {item.leftJoinRows.toLocaleString()} rows ({item.leftRows.toLocaleString()} left rows); unmatched: {item.leftUnmatchedRows.toLocaleString()} left, {item.rightUnmatchedRows.toLocaleString()} right.</p>
            {item.expansionRows > 0 && <p className="mt-1 text-sm font-semibold text-amber-800">This join may add {item.expansionRows.toLocaleString()} rows due to repeated keys.</p>}
            {item.status === 'needs_review' && <p className="mt-2 text-sm text-amber-800">Source evidence needs refreshing. Use Review possible relationships before approving this relationship.</p>}
            {item.status !== 'approved' && item.status !== 'rejected' && <div className="mt-3 flex gap-2"><button type="button" disabled={item.status === 'needs_review'} onClick={() => setRelationshipStatus(item.id, 'approved')} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve relationship</button><button type="button" onClick={() => setRelationshipStatus(item.id, 'rejected')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Dismiss</button></div>}
            {item.status === 'rejected' && <button type="button" onClick={() => setRelationshipStatus(item.id, 'suggested')} className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Review again</button>}
            {item.status === 'approved' && <p className="mt-2 text-sm text-emerald-800">Approved for deterministic cross-file analysis.</p>}
            {item.status === 'approved' && (() => {
              const left = children.find(({ id }) => id === item.leftDatasetId);
              const right = children.find(({ id }) => id === item.rightDatasetId);
              const selection = crossAnalysis[item.id] || {};
              const measures = [...numericFields(left).map((column) => ({ source: left, column })), ...numericFields(right).map((column) => ({ source: right, column }))];
              const dimensions = [...groupingFields(left).map((column) => ({ source: left, column })), ...groupingFields(right).map((column) => ({ source: right, column }))];
              return <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <h4 className="font-semibold text-slate-900">Deterministic cross-file analysis</h4>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <label className="text-xs font-semibold text-slate-700">Calculation<select aria-label="Calculation" value={selection.aggregation || 'count'} onChange={(event) => {
                    const aggregation = event.target.value;
                    const firstMeasure = measures[0] && `${measures[0].source.id}::${measures[0].column}`;
                    updateAnalysisSelection(item.id, { aggregation, metric: aggregation === 'count' ? '__rows__' : selection.metric && selection.metric !== '__rows__' ? selection.metric : firstMeasure });
                  }} className="mt-1 block w-full rounded-sm border border-slate-300 bg-white p-2 text-sm"><option value="count">Count joined rows</option><option value="sum" disabled={!measures.length}>Sum</option><option value="average" disabled={!measures.length}>Average</option></select></label>
                  <label className="text-xs font-semibold text-slate-700">Measure<select aria-label="Measure" disabled={!selection.aggregation || selection.aggregation === 'count'} value={selection.metric || '__rows__'} onChange={(event) => updateAnalysisSelection(item.id, { metric: event.target.value })} className="mt-1 block w-full rounded-sm border border-slate-300 bg-white p-2 text-sm disabled:opacity-50">{(!selection.aggregation || selection.aggregation === 'count') && <option value="__rows__">Joined rows</option>}{measures.map(({ source, column }) => <option key={`${source.id}::${column}`} value={`${source.id}::${column}`}>{source.sourcePath || source.name} · {column}</option>)}</select></label>
                  <label className="text-xs font-semibold text-slate-700">Group by<select aria-label="Group by" value={selection.dimension || ''} onChange={(event) => updateAnalysisSelection(item.id, { dimension: event.target.value })} className="mt-1 block w-full rounded-sm border border-slate-300 bg-white p-2 text-sm"><option value="">No grouping</option>{dimensions.map(({ source, column }) => <option key={`${source.id}::${column}`} value={`${source.id}::${column}`}>{source.sourcePath || source.name} · {column}</option>)}</select></label>
                </div>
                <label className="mt-3 block text-xs font-semibold text-slate-700">Measure grain<select aria-label="Measure grain" value={selection.measureGrain || 'source'} onChange={(event) => updateAnalysisSelection(item.id, { measureGrain: event.target.value })} className="mt-1 block rounded-sm border border-slate-300 bg-white p-2 text-sm"><option value="source">Unique source rows; reject repeated measures</option><option value="joined">Joined rows; explicitly allow repeated measure weighting</option></select></label>
                <button type="button" disabled={selection.loading} onClick={() => runCrossAnalysis(item)} className="mt-3 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{selection.loading ? 'Calculating…' : 'Run analysis'}</button>
                {selection.error && <p role="alert" className="mt-2 text-sm text-red-700">{selection.error}</p>}
                {selection.result && <div aria-live="polite" className="mt-3 border-t border-slate-200 pt-3 text-sm">
                  <p className="font-semibold text-slate-900">{selection.result.aggregation} {selection.result.metric}{selection.result.dimension ? ` by ${selection.result.dimension}` : ''}</p>
                  <p className="text-slate-600">Sources: {selection.result.sources.join(' + ')}. Matched joined rows: {selection.result.matchedRows.toLocaleString()}; rows after filters: {selection.result.filteredRows.toLocaleString()}. Filters: {selection.result.filters.length ? selection.result.filters.map(({ column, value }) => `${column} = ${value}`).join('; ') : 'none'}.</p>
                  <p className="mt-2 text-xs text-slate-500">Showing {Math.min(50, selection.result.results.length)} of {selection.result.results.length.toLocaleString()} groups.</p>
                  <ul className="mt-2 max-h-48 overflow-auto">{selection.result.results.slice(0, 50).map(({ group, missingGroup, value, rowCount }) => <li key={missingGroup ? 'missing' : `value:${group}`} className="flex justify-between gap-3"><span className="truncate">{missingGroup ? 'Missing grouping value' : group}</span><span className="font-semibold">{value === null ? 'No numeric values' : typeof value === 'string' ? value : value.toLocaleString()} <span className="font-normal text-slate-500">({rowCount.toLocaleString()} rows)</span></span></li>)}</ul>
                  {selection.result.warnings.map((warning) => <p key={warning} className="mt-2 text-amber-800">Quality warning: {warning}</p>)}
                </div>}
              </div>;
            })()}
          </article>)}
        </div>
      </section>
      {(dataset.importFailures?.length > 0 || dataset.ignoredFileCount > 0) && (
        <details className="mt-3 text-sm text-amber-900">
          <summary className="cursor-pointer font-semibold">{dataset.importFailures?.length || 0} files could not be read; {dataset.ignoredFileCount || 0} unsupported files ignored</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {(dataset.importFailures || []).map(({ path, message }) => <li key={path}>{path}: {message}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

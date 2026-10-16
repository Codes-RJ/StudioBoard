import { useEffect, useRef, useState } from 'react';
import { runLocalTransform } from '../../utils/localTransforms';
import { qualityRevisionKey } from '../../utils/qualityReview';
import { encodeDatasetPayload } from '../../utils/datasetWorkerPayload';
const fieldsOf = (source) => (source?.columns || []).map((column) => typeof column === 'string' ? column : column.name);

export default function ManualRelationshipReview({ sources, onCandidate, loadSources = async (items) => items }) {
  const [leftId, setLeftId] = useState(''); const [rightId, setRightId] = useState('');
  const [pairs, setPairs] = useState([{ left: '', right: '' }]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const request = useRef(null); const version = JSON.stringify(sources.map((source) => [source.id, qualityRevisionKey(source)]));
  const currentVersion = useRef(version); currentVersion.current = version;
  useEffect(() => { setBusy(false); setError(''); return () => { request.current?.abort(); request.current = null; }; }, [version]);
  const left = sources.find((source) => source.id === leftId); const right = sources.find((source) => source.id === rightId);
  const cancel = () => { request.current?.abort(); request.current = null; setBusy(false); setError(''); };
  const selectSource = (side, value) => { cancel(); (side === 'left' ? setLeftId : setRightId)(value); setPairs([{ left: '', right: '' }]); };
  const updatePair = (index, side, value) => { cancel(); setPairs((current) => current.map((pair, i) => i === index ? { ...pair, [side]: value } : pair)); };
  const preview = async () => {
    const controller = new AbortController(); request.current?.abort(); request.current = controller; setBusy(true); setError('');
    try {
      const loaded = [left, right].some((source) => source.metadataOnly && !source.storageRevision) ? await loadSources([left, right]) : [left, right];
      if (controller.signal.aborted || currentVersion.current !== version) return;
      const candidate = await runLocalTransform('review-relationship', {
        datasets: encodeDatasetPayload({ datasets: loaded }).datasets,
        leftDatasetId: leftId, rightDatasetId: rightId, leftColumns: pairs.map((pair) => pair.left), rightColumns: pairs.map((pair) => pair.right),
      }, { signal: controller.signal });
      if (!controller.signal.aborted && currentVersion.current === version) onCandidate(candidate);
    } catch (failure) { if (!controller.signal.aborted && currentVersion.current === version) setError(failure.message); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <details className="mt-4 rounded-xl border border-slate-200 p-3">
    <summary className="cursor-pointer text-sm font-semibold">Review a custom or composite key</summary>
    <p className="mt-2 text-xs text-slate-600">Choose keys in matching order. The preview counts all source rows and preserves identifiers. Review the result below before approving a join.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">{['left', 'right'].map((side) => <label key={side} className="text-sm">{side === 'left' ? 'Left source' : 'Right source'}
      <select aria-label={`${side} relationship source`} value={side === 'left' ? leftId : rightId} onChange={(event) => selectSource(side, event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2">
        <option value="">Choose source</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.sourcePath || source.name}{source.sheetName ? ` / ${source.sheetName}` : ''}</option>)}
      </select></label>)}</div>
    {pairs.map((pair, index) => <div key={index} className="mt-3 grid gap-3 sm:grid-cols-2">{[['left', left], ['right', right]].map(([side, source]) => <label key={side} className="text-sm">{side === 'left' ? 'Left' : 'Right'} key {index + 1}
      <select aria-label={`${side} key ${index + 1}`} value={pair[side]} onChange={(event) => updatePair(index, side, event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2">
        <option value="">Choose field</option>{fieldsOf(source).map((field) => <option key={field} value={field}>{field}</option>)}
      </select></label>)}</div>)}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={pairs.length >= 6 || busy} onClick={() => setPairs((current) => [...current, { left: '', right: '' }])} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Add key pair</button>
      <button type="button" disabled={pairs.length <= 1 || busy} onClick={() => setPairs((current) => current.slice(0, -1))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Remove last pair</button>
      <button type="button" disabled={busy || !left || !right || leftId === rightId || pairs.some((pair) => !pair.left || !pair.right)} onClick={preview} className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Checking keys…' : 'Preview key relationship'}</button>
      {busy && <button type="button" onClick={cancel} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Stop preview</button>}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </details>;
}

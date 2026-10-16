import { useEffect, useRef, useState } from 'react';
import { runLocalTransform } from '../../utils/localTransforms';
export default function SourceGrainReview({ dataset, onReview }) {
  const [description, setDescription] = useState(dataset.rowGrain?.description || '');
  const [fields, setFields] = useState(dataset.rowGrain?.fields || []);
  const [result, setResult] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), [dataset]);
  const reset = () => { request.current?.abort(); setBusy(false); setResult(null); setError(''); };
  const preview = async () => {
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try { const reviewed = await runLocalTransform('review-source-grain', { dataset, options: { fields, description } }, { signal: controller.signal }); if (!controller.signal.aborted) setResult(reviewed); }
    catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
    finally { if (request.current === controller) { setBusy(false); request.current = null; } }
  };
  return <details className="rounded-xl border border-slate-200 p-3 text-xs">
    <summary className="cursor-pointer font-semibold">Review what one row represents</summary>
    <p className="mt-2">Record the business grain, such as one order line or one daily observation. Keys are checked across every row. Repeated keys remain intact; a grain description does not authorize summing repeated measures.</p>
    <label className="mt-2 block">Row meaning<input aria-label="Source row meaning" value={description} maxLength={300} onChange={(event) => { reset(); setDescription(event.target.value); }} className="mt-1 block w-full rounded-sm border p-2" /></label>
    <div className="mt-2 flex flex-wrap gap-3">{dataset.columns.map((column) => typeof column === 'string' ? column : column.name).map((field) => <label key={field}><input type="checkbox" checked={fields.includes(field)} disabled={!fields.includes(field) && fields.length >= 6} onChange={() => { reset(); setFields((current) => current.includes(field) ? current.filter((value) => value !== field) : [...current, field]); }} /> {field}</label>)}</div>
    <button type="button" disabled={busy || !description.trim()} onClick={preview} className="mt-3 rounded-sm border px-3 py-2">Check grain</button>
    {busy && <button type="button" onClick={reset} className="ml-2 rounded-sm border px-3 py-2">Stop checking</button>}
    {error && <p role="alert">{error}</p>}
    {result && <div className="mt-2" role="status"><p>{result.rows} rows; {result.missingKeyRows} missing keys; {result.repeatedKeyRows} repeated keys. {result.unique ? 'The selected key is unique.' : 'Uniqueness is not established.'}</p><button type="button" onClick={() => { onReview(result); setResult(null); }} className="mt-2 rounded-sm bg-indigo-700 px-3 py-2 text-white">Save reviewed grain</button></div>}
  </details>;
}

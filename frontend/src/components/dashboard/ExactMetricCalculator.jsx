import { useEffect, useRef, useState } from 'react';
import { qualityRevisionKey } from '../../utils/qualityReview';
export default function ExactMetricCalculator({ dataset, filters }) {
  const fields = Object.keys(dataset.columnOverrides || {}).filter((field) => dataset.columnOverrides[field].precision === 'exact' && dataset.columnOverrides[field].role === 'measure');
  const [metric, setMetric] = useState(fields[0] || ''); const [dimension, setDimension] = useState(''); const [aggregation, setAggregation] = useState('sum');
  const [result, setResult] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const request = useRef(null);
  const revision = qualityRevisionKey(dataset); const scope = JSON.stringify(filters || {});
  useEffect(() => { setResult(null); setError(''); setBusy(false); setMetric((current) => fields.includes(current) ? current : fields[0] || ''); return () => request.current?.abort(); }, [revision, scope]);
  if (!fields.length) return null;
  const calculate = async () => {
    const controller = new AbortController(); request.current = controller; setBusy(true); setResult(null); setError('');
    try { const { runAIAnalysis } = await import('../../utils/localAI/client'); const result = await runAIAnalysis('calculate', { dataset, options: { metric, dimension, aggregation, filters: filters || {}, limit: 100 } }, { signal: controller.signal }); if (!controller.signal.aborted) setResult(result); }
    catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <details className="rounded-xl border border-indigo-200 p-3 text-xs"><summary className="cursor-pointer font-semibold">Exact decimal calculator — no model download</summary>
    <p className="mt-2">Uses every eligible working row and dashboard filters. Repeating fractions remain unrounded; units are labels without conversion.</p>
    <div className="mt-3 flex flex-wrap gap-3"><label>Measure<select aria-label="Exact measure" value={metric} onChange={(event) => { request.current?.abort(); setMetric(event.target.value); setResult(null); }} className="ml-2 rounded-sm border p-2">{fields.map((field) => <option key={field}>{field}</option>)}</select></label>
      <label>Group<select aria-label="Exact grouping" value={dimension} onChange={(event) => { request.current?.abort(); setDimension(event.target.value); setResult(null); }} className="ml-2 rounded-sm border p-2"><option value="">All rows</option>{dataset.columns.map((column) => typeof column === 'string' ? column : column.name).filter((field) => dataset.columnOverrides?.[field]?.role !== 'ignore').map((field) => <option key={field}>{field}</option>)}</select></label>
      <label>Operation<select aria-label="Exact aggregation" value={aggregation} onChange={(event) => { request.current?.abort(); setAggregation(event.target.value); setResult(null); }} className="ml-2 rounded-sm border p-2">{['sum', 'average', 'median', 'min', 'max'].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
      <button type="button" disabled={busy} onClick={calculate} className="rounded-sm bg-indigo-700 px-3 py-2 text-white">Calculate exact values</button>{busy && <button type="button" onClick={() => request.current?.abort()} className="rounded-sm border p-2">Stop calculation</button>}</div>
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    {result && <div role="status" className="mt-3"><p>{result.eligibleRows} eligible rows; {result.contributingRows} contribute; {result.missingRows} missing values; {result.imputedMeasureRows} reviewed filled measures. {result.unit || ''}</p><ul>{result.results.map((entry, index) => <li key={index}>{entry.group ?? '(Missing group)'}: {entry.value ?? 'uncomputable'}</li>)}</ul></div>}
  </details>;
}

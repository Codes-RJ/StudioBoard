import { useEffect, useRef, useState } from 'react';
import { MODEL_INFO } from '../../utils/localAI/models';
import { getLocalAIState, subscribeLocalAI, loadLocalModel, stopLocalModels, clearLocalModelCache } from '../../utils/localAI/runtime';
import { qualityRevisionKey } from '../../utils/qualityReview';
import { experimentalLocalLLM } from '../../utils/localAI/releasePolicy';

export default function LocalAIControls({ mode, onModeChange, busy, dataset, filters = {}, onIndexBusy = () => {}, inline = false }) {
  const [state, setState] = useState(getLocalAIState);
  const [storage, setStorage] = useState(null);
  const [cacheStatus, setCacheStatus] = useState('');
  const loadRef = useRef(null);
  const indexRef = useRef(null); const [indexStatus, setIndexStatus] = useState(''); const [indexing, setIndexing] = useState(false);
  const indexScope = `${qualityRevisionKey(dataset)}:${JSON.stringify(filters)}`;
  const scopeRef = useRef(indexScope); scopeRef.current = indexScope;
  const busyCallbackRef = useRef(onIndexBusy); busyCallbackRef.current = onIndexBusy;
  useEffect(() => {
    setIndexStatus(''); setIndexing(false); busyCallbackRef.current(false);
    return () => { indexRef.current?.abort(); indexRef.current = null; busyCallbackRef.current(false); };
  }, [indexScope]);
  useEffect(() => subscribeLocalAI(setState), []);
  useEffect(() => () => loadRef.current?.abort(), []);
  // A runtime failure must not switch conversation scope while its error is
  // being returned. Explicit Stop/Delete still switches modes below.
  useEffect(() => { if (['rag', 'agent'].includes(mode) && !experimentalLocalLLM) onModeChange('rules'); }, [mode, onModeChange]);
  const load = async (kind) => {
    loadRef.current = new AbortController();
    try { await loadLocalModel(kind, { signal: loadRef.current.signal }); } catch { /* Runtime state shows the error. */ }
    finally { loadRef.current = null; }
  };
  const inspectCache = async () => {
    const estimate = await navigator.storage?.estimate?.(); setStorage(estimate || null);
    const names = globalThis.caches ? await caches.keys() : [];
    // Include only the dedicated model caches, never imported dataset storage.
    const modelCaches = names.filter((name) => /transformers|webllm|web-llm|mlc/i.test(name));
    let bytes = 0; let unknown = 0;
    for (const name of modelCaches) for (const request of await (await caches.open(name)).keys()) {
      const response = await (await caches.open(name)).match(request);
      const length = Number(response?.headers.get('content-length'));
      if (length > 0) bytes += length; else unknown += 1;
    }
    setCacheStatus(`Model cache: ${(bytes / 1024 ** 2).toFixed(1)} MB in known response sizes${unknown ? `; ${unknown} entries have unknown sizes` : ''}.`);
  };
  const buildIndex = async () => {
    const scope = indexScope;
    const controller = new AbortController(); indexRef.current = controller; setIndexing(true); onIndexBusy(true);
    try {
      const { buildCompleteSemanticIndex } = await import('../../utils/localAI/client');
      await buildCompleteSemanticIndex(dataset, filters, { signal: controller.signal, onProgress: ({ completedRows, totalRows, records, complete }) => {
        if (scopeRef.current === scope && !controller.signal.aborted) setIndexStatus(`${complete ? 'Semantic index complete' : 'Indexing'}: ${completedRows.toLocaleString()} of ${totalRows.toLocaleString()} source positions; ${records.toLocaleString()} evidence chunks.`);
      } });
    } catch (error) { if (scopeRef.current === scope) setIndexStatus(error.name === 'AbortError' ? 'Indexing stopped. Completed pages are retained. Reload semantic search if the active model was unloaded, then resume.' : error.message); }
    finally { if (indexRef.current === controller) { indexRef.current = null; setIndexing(false); onIndexBusy(false); } }
  };
  const buildEntities = async () => {
    const scope = indexScope; const controller = new AbortController(); indexRef.current = controller; setIndexing(true); onIndexBusy(true);
    try { const { buildCompleteEntityIndex } = await import('../../utils/localAI/client');
      await buildCompleteEntityIndex(dataset, { signal: controller.signal, onProgress: ({ completedRows, totalRows, records, complete }) => {
        if (scopeRef.current === scope && !controller.signal.aborted) setIndexStatus(`${complete ? 'Entity index complete' : 'Indexing entities'}: ${completedRows} of ${totalRows} source positions; ${records} identifier occurrences.`);
      } });
    } catch (error) { if (scopeRef.current === scope) setIndexStatus(error.name === 'AbortError' ? 'Entity indexing stopped; completed pages retained for resume.' : error.message); }
    finally { if (indexRef.current === controller) { indexRef.current = null; setIndexing(false); onIndexBusy(false); } }
  };
  const Container = inline ? 'div' : 'details';
  return <Container data-model-lifecycle={experimentalLocalLLM ? JSON.stringify({ loading: state.loading, embeddings: state.embeddings,
    llm: state.llm, hasError: Boolean(state.error), indexing, renderedAt: Date.now() }) : undefined} className="rounded-2xl border border-indigo-100 bg-white/75 px-4 py-3">
    {!inline && <summary className="cursor-pointer text-xs font-bold text-indigo-900">Browser AI and local search</summary>}
    <div className="mt-3 space-y-3 text-xs text-slate-700">
      <label className="flex items-center gap-3">Assistant mode
        <select aria-label="Assistant mode" value={mode} disabled={busy || indexing || state.loading} onChange={(event) => onModeChange(event.target.value)} className="rounded-lg border border-slate-300 bg-white p-2">
          <option value="rules">Deterministic calculations</option>
          <option value="search">Evidence search / RAG retrieval</option>
          {experimentalLocalLLM && <option value="rag" disabled={!state.llm}>Local LLM + RAG</option>}
          {experimentalLocalLLM && <option value="agent" disabled={!state.llm}>Local LLM + AgenticRAG / GraphRAG</option>}
        </select>
      </label>
      <p>Search works without downloading a model. Semantic search uses WASM; generation requires a compatible WebGPU device. Downloads fetch model assets; tables, filenames and prompts stay in this browser. No cloud inference fallback.</p>
      <p>{experimentalLocalLLM ? 'LLM answers and agent planning are experimental and can fail to finish. Use deterministic calculations for supported numerical questions, and review generated interpretations against their cited evidence.' : 'This release provides deterministic calculations and evidence search. Experimental LLM generation is unavailable.'}</p>
      <div className="grid gap-3 md:grid-cols-2">{Object.entries(MODEL_INFO).filter(([kind]) => kind !== 'llm' || experimentalLocalLLM).map(([kind, info]) => <div key={kind} className="rounded-xl border border-slate-200 p-3">
        <p className="font-semibold">{info.label}</p><p className="mt-1">{info.download}. {info.memory}</p>
        <a href={info.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">Model and {info.license} license</a>
        <button type="button" disabled={state.loading || busy || indexing || state[kind]} onClick={() => load(kind)} className="mt-2 block rounded-lg bg-indigo-600 px-3 py-2 font-semibold text-white disabled:opacity-50">{state[kind] ? 'Loaded' : `Download / load ${kind === 'llm' ? 'LLM' : 'semantic search'}`}</button>
      </div>)}</div>
      <p role="status" aria-live="polite">{state.progress}</p>
      <p>Lexical search scans all eligible rows and fields. A complete semantic index can take substantial time and browser storage; it runs in saved pages and can resume after stopping.</p>
      <button type="button" disabled={!state.embeddings || state.loading || busy || indexing} onClick={buildIndex} className="rounded-lg border border-slate-300 px-3 py-2">Build / resume full semantic index</button>
      <button type="button" disabled={state.loading || busy || indexing} onClick={buildEntities} className="ml-2 rounded-lg border border-slate-300 px-3 py-2">Build / resume identifier entity index</button>
      <p>Entity indexing needs no model. It covers every occurrence in up to 16 reviewed identifier fields, preserves exact values and row citations, and does not infer people or organizations from prose.</p>
      {indexing && <button type="button" onClick={() => indexRef.current?.abort()} className="ml-2 rounded-lg border border-slate-300 px-3 py-2">Stop indexing</button>}
      {indexStatus && <p role="status">{indexStatus}</p>}
      {state.error && <p role="alert" className="text-rose-700">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { indexRef.current?.abort(); stopLocalModels(); onModeChange('rules'); }} className="rounded-lg border border-slate-300 px-3 py-2">Stop / unload models</button>
        <button type="button" disabled={busy || state.loading} onClick={() => inspectCache().catch(() => setCacheStatus('Cache sizes are unavailable in this browser.'))} className="rounded-lg border border-slate-300 px-3 py-2">Check model cache and storage</button>
        <button type="button" disabled={busy || indexing || state.loading} onClick={() => { onModeChange('rules'); clearLocalModelCache().then(() => setCacheStatus('Model caches deleted. Source data and conversations retained.')).catch((error) => setCacheStatus(error.message)); }} className="rounded-lg border border-slate-300 px-3 py-2">Delete downloaded models</button>
      </div>
      {cacheStatus && <p role="status">{cacheStatus}</p>}
      {storage && <p>Browser origin storage: {(storage.usage / 1024 ** 2).toFixed(1)} MB used of {(storage.quota / 1024 ** 2).toFixed(1)} MB estimated quota. Storage persistence is best effort.</p>}
    </div>
  </Container>;
}

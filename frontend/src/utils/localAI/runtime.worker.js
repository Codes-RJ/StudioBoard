import { EMBEDDING_MODEL, EMBEDDING_REVISION, LLM_MODEL, LLM_ASSET_BASE, LLM_LIBRARY_URL } from './models';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { isAllowedModelAsset } from './assetPolicy';
import { embedTextWindows } from './embeddingWindows';
import { deleteModelAssetCaches } from './modelCache';
import { generateToolAction } from './generation';
import { requireLocalLLM } from './releasePolicy';

const assetFetch = self.fetch.bind(self);
const localAssets = [wasmUrl, wasmModuleUrl].map((url) => new URL(url, self.location.href).href);
self.fetch = (input, init = {}) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url || String(input), self.location.href).href;
  const options = { method: init.method || request?.method || 'GET', body: init.body ?? request?.body };
  if (!isAllowedModelAsset(url, options, localAssets)) throw new Error('The model worker only permits fixed model asset downloads.');
  return assetFetch(input, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' });
};

let embedder = null; let engine = null; let webllm = null;
const progress = (id, status) => self.postMessage({ id, progress: status });
// This worker has no inference endpoint. Network is only fixed runtime/model assets.
self.onmessage = async ({ data: { id, operation, payload = {} } }) => {
  try {
    if (operation === 'load-llm' || operation === 'generate') requireLocalLLM();
    let result;
    if (operation === 'load-embeddings') {
      if (!embedder) {
        const { pipeline, env } = await import('@huggingface/transformers');
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        // Pipeline discovery/progress probes in Transformers 4.3.0 do not
        // forward revision. Pin their template too, instead of allowing main.
        env.remotePathTemplate = `{model}/resolve/${EMBEDDING_REVISION}/`;
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.proxy = false;
        env.backends.onnx.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
        embedder = await pipeline('feature-extraction', EMBEDDING_MODEL, { revision: EMBEDDING_REVISION, device: 'wasm', dtype: 'q8', progress_callback: (status) => progress(id, status) });
      }
      result = { ready: true, model: EMBEDDING_MODEL };
    } else if (operation === 'load-llm') {
      if (!self.navigator?.gpu || !await self.navigator.gpu.requestAdapter()) throw new Error('WebGPU is unavailable. Use local search and deterministic calculations on this device.');
      webllm ||= await import('@mlc-ai/web-llm');
      if (!engine) {
        const selectedModel = webllm.prebuiltAppConfig.model_list.find((model) => model.model_id === LLM_MODEL);
        if (!selectedModel) throw new Error('The pinned LLM is absent from this runtime catalogue.');
        engine = new webllm.MLCEngine({ appConfig: { model_list: [{ ...selectedModel, model: LLM_ASSET_BASE, model_lib: LLM_LIBRARY_URL }], cacheBackend: 'cache' },
          initProgressCallback: (status) => progress(id, status) });
        try { await engine.reload(LLM_MODEL); }
        catch (error) { await engine.unload().catch(() => {}); engine = null; throw error; }
      }
      result = { ready: true, model: LLM_MODEL };
    } else if (operation === 'embed') {
      if (!embedder) throw new Error('Load the semantic search model first.');
      if (!Array.isArray(payload.texts) || payload.texts.length > 16 || payload.texts.some((t) => typeof t !== 'string' || t.length > 2_000)) throw new Error('Invalid embedding batch.');
      result = await embedTextWindows(payload.texts, embedder);
    } else if (operation === 'generate') {
      if (!engine) throw new Error('Load the local LLM first.');
      if (!Array.isArray(payload.messages) || payload.messages.length > 8 || payload.messages.some((message) => !['system', 'user', 'assistant'].includes(message?.role) || typeof message.content !== 'string')
        || JSON.stringify(payload.messages).length > 20_000) throw new Error('Conversation context exceeds the local model limit or has unsupported messages.');
      result = await generateToolAction((request) => engine.chat.completions.create(request), payload.messages, payload.schemaContext,
        { onDiagnostic: (event) => progress(id, { status: 'planning', ...event }) });
    } else if (operation === 'clear-cache') {
      await engine?.unload(); engine = null;
      await embedder?.dispose(); embedder = null;
      // The library's per-model deletion fetches tensor-cache.json even when
      // this LLM was never downloaded. Delete our dedicated namespaces locally.
      await deleteModelAssetCaches(self.caches);
      result = { cleared: true };
    } else throw new Error('Unsupported model operation.');
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error?.message || 'Local model processing failed. Reload after a GPU/device failure.' }); }
};

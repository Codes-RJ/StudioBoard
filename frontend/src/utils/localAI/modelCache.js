// These are model-only Cache API namespaces. Dataset/conversation IndexedDB
// and unrelated caches are never accessed. Deletion must work without a network.
export const MODEL_CACHE_NAMES = ['transformers-cache', 'webllm/model', 'webllm/config', 'webllm/wasm'];
export const deleteModelAssetCaches = async (storage) => {
  if (!storage) throw new Error('Model cache storage is unavailable in this browser.');
  for (const name of MODEL_CACHE_NAMES) await storage.delete(name);
};

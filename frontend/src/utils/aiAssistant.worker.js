import { analyzePreparedQuery, buildDatasetProfile, getDatasetRevision } from './aiQueryEngine';
import { decodeDatasetPayload } from './datasetWorkerPayload';
import { withWorkerDatabase, readDatasetHeader, loadWorkerDataset } from './datasetWorkerReader';
import { assertTransformMemoryPolicy } from './transformMemoryPolicy';

const MAX_CACHE_ENTRIES = 50;
let dataset = null;
let profile = null;
let reference = null;
const resultCache = new Map();

const remember = (key, value) => {
  if (resultCache.has(key)) resultCache.delete(key);
  resultCache.set(key, value);
  if (resultCache.size > MAX_CACHE_ENTRIES) {
    resultCache.delete(resultCache.keys().next().value);
  }
};

self.onmessage = async ({ data }) => {
  const { id, operation } = data || {};
  try {
    if (operation === 'initialize') {
      reference = data.dataset?.kind === 'local-dataset-reference' ? data.dataset : null;
      assertTransformMemoryPolicy('quality', { dataset: data.dataset });
      dataset = (await decodeDatasetPayload({ dataset: data.dataset }, (sourceId, options) => loadWorkerDataset(sourceId, { ...options, workingOnly: true }))).dataset;
      profile = buildDatasetProfile(dataset);
      resultCache.clear();
      self.postMessage({ id, result: { revision: profile.revision, rowCount: profile.rowCount } });
      return;
    }
    if (operation === 'query') {
      if (!dataset || !profile || profile.revision !== data.revision || getDatasetRevision(dataset) !== data.revision) {
        throw new Error('The assistant dataset changed. Please ask again.');
      }
      const validate = () => reference ? withWorkerDatabase((database) => readDatasetHeader(database, reference.id,
        { expectedRevision: reference.revision, expectedStorageRevision: reference.storageRevision })) : Promise.resolve();
      await validate();
      const cacheKey = `${String(data.query || '').trim().toLowerCase().replace(/\s+/g, ' ')}::${JSON.stringify(data.scopeFilters || {})}::${JSON.stringify(data.context || null)}`;
      const cached = resultCache.get(cacheKey);
      if (cached) {
        resultCache.delete(cacheKey);
        resultCache.set(cacheKey, cached);
        self.postMessage({ id, result: { ...cached, cached: true } });
        return;
      }
      const result = analyzePreparedQuery(data.query, dataset, profile, {
        scopeFilters: data.scopeFilters,
        context: data.context
      });
      await validate();
      remember(cacheKey, result);
      self.postMessage({ id, result });
      return;
    }
    throw new Error('Unsupported assistant worker operation.');
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Assistant analysis failed.' });
  }
};

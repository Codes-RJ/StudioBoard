// @ts-check
/** @typedef {import('./datasetContracts').DatasetRecord} DatasetRecord */
/** @typedef {import('./datasetContracts').DatasetReference} DatasetReference */
/** @typedef {import('./datasetContracts').DatasetLoader} DatasetLoader */
/** @typedef {import('./datasetContracts').DataRow} DataRow */
/** @typedef {{ reference: DatasetReference, rows: DataRow[], sourceRows?: DataRow[] }} StoredDataset */
import { qualityRevisionKey } from './qualityReview';

/** @type {WeakMap<object, StoredDataset>} */
const datasets = new WeakMap();
/** @type {WeakMap<object, DatasetReference>} */
const rowArrays = new WeakMap();
/** @param {DatasetRecord | undefined} source @returns {string | undefined} */
export const getStoredDatasetVersion = (source) => source && (datasets.get(source)?.reference.storageRevision || source.storageRevision);
/** @param {DatasetRecord} source @param {string} [storageRevision] @returns {DatasetRecord} */
export const rememberStoredDataset = (source, storageRevision = source?.storageRevision) => {
  if (!source?.rawRows) return source;
  /** @type {DatasetReference} */
  const reference = { kind: 'local-dataset-reference', id: source.id, revision: qualityRevisionKey(source), storageRevision };
  datasets.set(source, { reference, rows: source.rawRows, sourceRows: source.sourceRows });
  /** @type {import('./datasetContracts').RowStream[]} */
  const fields = ['rawRows', 'sourceRows'];
  for (const field of fields) if (source[field]) rowArrays.set(source[field], { ...reference, field });
  return source;
};

// Only replace arrays/records registered after a successful storage read/write.
// Unsaved and filtered data stays explicit so it cannot acquire saved-row scope.
/** @param {Record<string, unknown>} payload @returns {Record<string, unknown>} */
export const encodeDatasetPayload = (payload) => {
  /** @param {unknown} value @returns {unknown} */
  const encode = (value) => {
    if (!value || typeof value !== 'object') return value;
    const source = /** @type {DatasetRecord} */ (value);
    if (source.metadataOnly && source.storageRevision) return { kind: 'local-dataset-reference', id: source.id, revision: source.revisionKey, storageRevision: source.storageRevision };
    const saved = datasets.get(value);
    if (saved && saved.rows === source.rawRows && saved.sourceRows === source.sourceRows
      && saved.reference.revision === qualityRevisionKey(source)) return saved.reference;
    if (rowArrays.has(value)) return rowArrays.get(value);
    if (Array.isArray(value)) return value.some((entry) => entry?.rawRows || entry?.metadataOnly) ? value.map(encode) : value;
    return value;
  };
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, encode(value)]));
};

/** @param {Record<string, unknown>} payload @param {DatasetLoader} load @returns {Promise<Record<string, unknown>>} */
export const decodeDatasetPayload = async (payload, load) => {
  /** @type {Map<string, Promise<DatasetRecord>>} */
  const cache = new Map();
  /** @param {unknown} value @returns {Promise<unknown>} */
  const decode = async (value) => {
    const reference = /** @type {DatasetReference | null | undefined} */ (value);
    if (reference?.kind === 'local-dataset-reference') {
      const key = `${reference.id}:${reference.revision}:${reference.storageRevision || ''}`;
      if (!cache.has(key)) cache.set(key, load(reference.id, { expectedRevision: reference.revision, expectedStorageRevision: reference.storageRevision }).then((source) => {
        if (!source) throw new Error('This source was deleted. Reload the workspace before continuing.');
        return source;
      }));
      const source = await cache.get(key);
      if (!source) throw new Error('This source was deleted. Reload the workspace before continuing.');
      if (reference.field && !Array.isArray(source[reference.field])) throw new Error('The saved row stream is unavailable.');
      return reference.field ? source[reference.field] : source;
    }
    if (Array.isArray(value) && value.some((entry) => entry?.kind === 'local-dataset-reference')) return Promise.all(value.map(decode));
    return value;
  };
  const entries = await Promise.all(Object.entries(payload).map(async ([key, value]) => [key, await decode(value)]));
  return Object.fromEntries(entries);
};

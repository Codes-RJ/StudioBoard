import { scanWorkerDatasetRows } from '../datasetWorkerReader';
import { createEvidenceIndexBuilder, createSourceEvidenceRetriever, buildEvidenceIndex, retrieveSourceEvidence } from './evidence';

export const runSavedEvidence = async (operation, payload, { signal, onProgress, scan = scanWorkerDatasetRows } = {}) => {
  if (!['index', 'retrieve-source'].includes(operation)) throw new Error('Unsupported evidence operation.');
  const { dataset, filters, index, query, options } = payload;
  if (dataset?.kind !== 'local-dataset-reference') return operation === 'index'
    ? buildEvidenceIndex(dataset, filters) : retrieveSourceEvidence(dataset, index, query, options);
  if (dataset.field) throw new Error('Evidence search requires a dataset reference.');
  let builder;
  await scan(dataset.id, (rows, info) => {
    builder ||= operation === 'index' ? createEvidenceIndexBuilder(info.header, filters) : createSourceEvidenceRetriever(info.header, index, query, options);
    builder.consume(rows, info);
  }, { signal, onProgress, includeSourceRows: true, expectedRevision: dataset.revision, expectedStorageRevision: dataset.storageRevision });
  return builder.finish();
};

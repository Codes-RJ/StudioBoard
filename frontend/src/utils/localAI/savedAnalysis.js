import { createScopedMetricAccumulator, computeScopedMetric } from '../analysisScope';
import { scanWorkerDatasetRows } from '../datasetWorkerReader';

// Keep unsaved/filtered records explicit. Only registered persisted references
// may substitute a database scan for their original worker payload.
export const calculateDatasetPayload = async (dataset, options, { signal, onProgress, scan = scanWorkerDatasetRows } = {}) => {
  if (dataset?.kind !== 'local-dataset-reference') return computeScopedMetric(dataset, options);
  if (dataset.field) throw new Error('Calculation requires a dataset, not a row-stream reference.');
  let accumulator;
  const status = await scan(dataset.id, (rows, info) => {
    accumulator ||= createScopedMetricAccumulator(info.header, options);
    accumulator.consume(rows, { sourceRows: info.sourceRows });
  }, { signal, onProgress, includeSourceRows: true, expectedRevision: dataset.revision, expectedStorageRevision: dataset.storageRevision });
  return accumulator.finish(status.total);
};

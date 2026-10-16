import { scanWorkerDatasetRows } from './datasetWorkerReader';
import { computeScopedDatasetMetrics, createScopedDatasetMetricsAccumulator } from './localDataEngine';

export const computeScopedMetricsPayload = async ({ dataset, filters }, { signal, onProgress, scan = scanWorkerDatasetRows } = {}) => {
  if (dataset?.kind !== 'local-dataset-reference') return computeScopedDatasetMetrics(dataset, filters);
  if (dataset.field) throw new Error('Dashboard metrics require a dataset reference.');
  let accumulator;
  await scan(dataset.id, (rows, info) => {
    accumulator ||= createScopedDatasetMetricsAccumulator(info.header, filters);
    accumulator.consume(rows);
  }, { signal, onProgress, expectedRevision: dataset.revision, expectedStorageRevision: dataset.storageRevision });
  return accumulator.finish();
};

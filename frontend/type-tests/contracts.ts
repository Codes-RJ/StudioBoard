import { addFinite } from '../src/utils/finiteArithmetic';
import { createExactMetric, formatExact } from '../src/utils/exactDecimal';
import { decodeDatasetPayload, rememberStoredDataset } from '../src/utils/datasetWorkerPayload';
import type { DatasetReference, DatasetLoader } from '../src/utils/datasetContracts';

const reference: DatasetReference = {
  kind: 'local-dataset-reference', id: 'fixture', revision: 'quality-r1', storageRevision: 'storage-r1', field: 'rawRows',
};
const load: DatasetLoader = async (id, options) => ({ id, storageRevision: options.expectedStorageRevision, rawRows: [] });
void decodeDatasetPayload({ dataset: reference }, load);
rememberStoredDataset({ id: 'fixture', rawRows: [{ value: '9007199254740993' }] }, 'storage-r1');
const exact = createExactMetric('average'); exact.consume('0.1');
const result = exact.result(); if (result) formatExact(result);
addFinite(1, 2);

// @ts-expect-error Storage generations are strings, never row counts.
rememberStoredDataset({ id: 'fixture', rawRows: [] }, 2);
// @ts-expect-error Worker decoding requires a loader with revision options.
void decodeDatasetPayload({ dataset: reference }, async (id: number) => ({ id }));
// @ts-expect-error A reference can only select one of the stored row streams.
const invalidStream: DatasetReference = { ...reference, field: 'unknownRows' };
// @ts-expect-error Exact values cannot mix binary64 denominators with BigInt.
formatExact({ n: 1n, d: 3 });
// @ts-expect-error Arbitrary operation names cannot select a metric contract.
createExactMetric('approximate');
// @ts-expect-error Native finite addition does not accept numeric text.
addFinite('1', 2);
void invalidStream;

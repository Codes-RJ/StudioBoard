import { getDatasetRevision } from './aiDatasetIdentity';
import { qualityRevisionKey } from './qualityReview';
import { getStoredDatasetVersion } from './datasetWorkerPayload';

// An allowlist keeps source rows, cleaning snapshots and value distributions
// out of the catalog. These summaries are never calculation inputs.
const fields = ['id', 'name', 'revision', 'storageRevision', 'checksum', 'createdAt', 'updatedAt',
  'isLocal', 'columns', 'columnOverrides', 'qualityReview', 'qualityReviewRequired',
  'sourceId', 'sourceFile', 'sourcePath', 'sheetName', 'folderId', 'folderName',
  'isFolderOverview', 'collectionKind', 'sourceFileCount', 'totalSourceRows',
  'relationships', 'importFailures', 'ignoredFileCount', 'document', 'rowGrain'];

export const datasetCatalogMetadata = (dataset) => {
  if (dataset.metadataOnly) return dataset;
  const metadata = Object.fromEntries(fields.filter((field) => dataset[field] !== undefined)
    .map((field) => [field, dataset[field]]));
  // Successful saves register the new generation in a WeakMap without mutating
  // the React source. Keep that generation when evicting rows into metadata.
  return { ...metadata, storageRevision: getStoredDatasetVersion(dataset), metadataOnly: true, rowCount: dataset.rawRows?.length ?? dataset.rowStorage?.streams?.rawRows?.length,
    datasetRevision: getDatasetRevision(dataset), revisionKey: qualityRevisionKey(dataset),
    metrics: { columnGroups: dataset.metrics?.columnGroups,
      completeness: dataset.metrics?.completeness, missingValues: dataset.metrics?.missingValues } };
};

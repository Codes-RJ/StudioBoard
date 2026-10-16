export type DataRow = Record<string, unknown>;
export type RowStream = 'rawRows' | 'sourceRows';

export interface DatasetRecord {
  id: string;
  rawRows?: DataRow[];
  sourceRows?: DataRow[];
  storageRevision?: string;
  revisionKey?: string;
  metadataOnly?: boolean;
  [key: string]: unknown;
}

export interface DatasetReference {
  kind: 'local-dataset-reference';
  id: string;
  revision: string;
  storageRevision?: string;
  field?: RowStream;
}

export type DatasetLoader = (
  id: string,
  options: { expectedRevision: string; expectedStorageRevision?: string },
) => Promise<DatasetRecord | null>;

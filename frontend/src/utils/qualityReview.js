import { getDatasetRevision } from './aiDatasetIdentity';

export const newDatasetRevision = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}_${Math.random().toString(36).slice(2)}`;

// Include reviewed roles/types so changing a column cannot reuse approval.
export const qualityRevisionKey = (dataset) => dataset?.metadataOnly ? dataset.revisionKey : `${getDatasetRevision(dataset)}::${JSON.stringify(
  Object.entries(dataset?.columnOverrides || {}).sort(([a], [b]) => a.localeCompare(b))
)}${dataset?.rowGrain ? `::grain:${JSON.stringify(dataset.rowGrain)}` : ''}`;

export const isQualityApproved = (dataset) => Boolean(dataset?.qualityReview?.approvedAt
  && dataset.qualityReview.revisionKey === qualityRevisionKey(dataset)
  && dataset.qualityReview.rows === (dataset.metadataOnly ? dataset.rowCount : dataset.rawRows?.length ?? dataset.rowStorage?.streams?.rawRows?.length));

export const approveQualityRevision = (dataset) => ({
  ...dataset,
  qualityReviewRequired: true,
  qualityReview: { approvedAt: new Date().toISOString(), revisionKey: qualityRevisionKey(dataset), rows: dataset.rawRows.length },
});

export const sourceRowIdentity = (dataset, rowIndex) => `${dataset.sourceId || dataset.id}:row:${rowIndex + 1}`;

// Recipes/logged operations preserve cell lineage without storing a second
// row-sized change log for every imputed value. The source snapshot is exact.
export const getCellProvenance = (dataset, rowIndex, column) => {
  let sourceColumn = column;
  for (const entry of [...(dataset.cleaningLog || [])].reverse()) {
    for (const operation of [...(entry.operations || [])].reverse()) {
      if (operation.kind === 'headers') sourceColumn = Object.entries(operation.renamed).find(([, name]) => name === sourceColumn)?.[0] || sourceColumn;
    }
  }
  const original = (dataset.sourceRows || dataset.rawRows)?.[rowIndex]?.[sourceColumn];
  let activeColumn = sourceColumn;
  let value = original;
  const steps = [];
  for (const [index, entry] of (dataset.cleaningLog || []).entries()) {
    for (const operation of entry.operations || []) {
      const before = value;
      if (operation.kind === 'headers') activeColumn = operation.renamed[activeColumn] || activeColumn;
      if (operation.kind === 'trim' && typeof value === 'string' && !(operation.protectedColumns || []).includes(activeColumn)) value = value.trim();
      if (operation.kind === 'fill' && operation.column === activeColumn
        && (value == null || (typeof value === 'string' && !value.trim()))) value = operation.value;
      if (!Object.is(before, value)) steps.push({ step: index + 1, method: operation.method || operation.kind, before, after: value });
    }
  }
  return { sourceRowId: sourceRowIdentity(dataset, rowIndex), column, original, current: dataset.rawRows?.[rowIndex]?.[column], steps };
};

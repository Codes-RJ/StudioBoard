import { describe, expect, it } from 'vitest';
import { datasetCatalogMetadata } from '../datasetCatalogMetadata';
import { approveQualityRevision, isQualityApproved, qualityRevisionKey } from '../qualityReview';
import { getDatasetRevision } from '../aiDatasetIdentity';
import { assertReviewed } from '../localAI/evidence';
import { encodeDatasetPayload, rememberStoredDataset } from '../datasetWorkerPayload';

describe('catalog summaries', () => {
  it('preserves identity and review readiness without making rows available to computation', () => {
    const source = approveQualityRevision({ id: 'source', revision: 'r1', isLocal: true,
      columns: ['ID'], rawRows: [{ ID: '001', undeclared: 'retained' }],
      columnOverrides: { ID: { role: 'identifier' } } });
    const summary = datasetCatalogMetadata(source);
    expect(summary).not.toHaveProperty('rawRows');
    expect(getDatasetRevision(summary)).toBe(getDatasetRevision(source));
    expect(qualityRevisionKey(summary)).toBe(qualityRevisionKey(source));
    expect(isQualityApproved(summary)).toBe(true);
    expect(assertReviewed.bind(null, summary)).toThrow('No local source rows');
    expect(isQualityApproved(datasetCatalogMetadata({ ...source, revision: 'r2' }))).toBe(false);
  });
  it('retains the committed generation after approval and row eviction so other saved sources remain available to graph tools', () => {
    const source = approveQualityRevision({ id: 'other-source', revision: 'r1', isLocal: true,
      storageRevision: 'prior-generation', columns: ['ID'], rawRows: [{ ID: '001' }] });
    rememberStoredDataset(source, 'committed-generation');
    const summary = datasetCatalogMetadata(source);
    expect(summary.storageRevision).toBe('committed-generation');
    expect(() => assertReviewed(summary, { allowSavedMetadata: true })).not.toThrow();
    expect(encodeDatasetPayload({ datasets: [summary] }).datasets).toEqual([{ kind: 'local-dataset-reference', id: source.id,
      revision: qualityRevisionKey(source), storageRevision: 'committed-generation' }]);
    expect(summary).not.toHaveProperty('rawRows');
  });
});

import { expect, it } from 'vitest';
import { approveQualityRevision } from '../qualityReview';
import { buildEvidenceIndex, retrieveSourceEvidence } from '../localAI/evidence';

const dataset = approveQualityRevision({ id: 'support-corpus', name: 'support.csv', isLocal: true, revision: 'r1',
  columns: ['ID', 'Region', 'Notes'].map((name) => ({ name, type: 'string' })),
  rawRows: [{ ID: '001', Region: 'West', Notes: 'Invoice cancellation accepted; refund is pending.' },
    { ID: '002', Region: 'East', Notes: 'Invoice cancellation declined; refund is not approved.' },
    { ID: '003', Region: 'West', Notes: 'The warehouse printer requires a paper refill.' }] });
const search = (query, filters = {}) => retrieveSourceEvidence(dataset, buildEvidenceIndex(dataset, filters), query);
it.each(['Find a row about unicorn spacecraft and cite it.', 'Please tell me about volcanic penguins.', 'Which record contains neutron lasers?'])('does not mistake question boilerplate for supporting evidence: %s', (query) => {
  expect(search(query).hits.filter((hit) => hit.kind === 'row')).toHaveLength(0);
});
it('does not return every row solely because a question mentions the Notes header', () => {
  expect(search('Find the row whose Notes contain neutron lasers.').hits.filter((hit) => hit.kind === 'row')).toHaveLength(0);
});
it('retains opposing records instead of resolving a conflict by invention', () => {
  expect(new Set(search('Invoice cancellation refund').hits.filter((hit) => hit.kind === 'row').map((hit) => hit.sourceRowId)))
    .toEqual(new Set(['support-corpus:row:1', 'support-corpus:row:2']));
});
it('respects row filters and retrieves the exact supporting source identity', () => {
  const result = search('Invoice cancellation refund', { Region: 'East' });
  expect(result.hits.filter((hit) => hit.kind === 'row').map((hit) => hit.sourceRowId)).toEqual(['support-corpus:row:2']);
  expect(result.coverage).toMatchObject({ completeRows: true, eligibleRows: 1 });
});

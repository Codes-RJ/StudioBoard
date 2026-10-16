import { expect, it } from 'vitest';
import { collectionModelCases, independentModelCases } from '../../../fixtures/modelCollection.mjs';
import { scoreModelAnswer, findFreshEvaluationAnswer } from '../../../scripts/model-evaluation-score.mjs';
import { selectEvaluationCases } from '../../../scripts/model-evaluation-options.mjs';
it('keeps bounded diagnostic questions distinct from a complete evaluation', () => {
  const cases = collectionModelCases();
  expect(selectEvaluationCases(cases, [])).toEqual({ selected: cases, diagnostic: false });
  const diagnostic = selectEvaluationCases(cases, ['--collection', '--case-limit=6']);
  expect(diagnostic.diagnostic).toBe(true); expect(diagnostic.selected).toHaveLength(6); expect(cases).toHaveLength(34);
  for (const arg of ['--case-limit=0', '--case-limit=-1', '--case-limit=1.5', '--case-limit=35', '--case-limit=Infinity'])
    expect(() => selectEvaluationCases(cases, [arg])).toThrow();
  expect(() => selectEvaluationCases(cases, ['--case-limit=1', '--case-limit=2'])).toThrow();
  expect(selectEvaluationCases(cases, ['--case-ids=research-events,energy-zones']).selected.map((spec) => spec.id)).toEqual(['energy-zones', 'research-events']);
  expect(() => selectEvaluationCases(cases, ['--case-ids=unknown'])).toThrow();
  expect(() => selectEvaluationCases(cases, ['--case-ids=energy-zones', '--case-limit=1'])).toThrow();
});
it('covers thirty sources with live graph, follow-up, clarification and proposal cases', () => {
  const cases = collectionModelCases(); expect(new Set(cases.map((spec) => spec.dataset.id)).size).toBe(30);
  expect(cases.filter((spec) => spec.graph)).toHaveLength(5); expect(cases.some((spec) => spec.followUp)).toBe(true);
  expect(cases.some((spec) => spec.requiresProposal)).toBe(true); expect(cases.filter((spec) => spec.requiresClarification)).toHaveLength(5);
  expect(cases.filter((spec) => spec.mode === 'rag')).toHaveLength(2);
});
it('keeps independent challenges separate and rejects evidence on a no-answer question', () => {
  const independent = independentModelCases();
  expect(independent).toHaveLength(11);
  expect(independent.every((item) => item.id.startsWith('independent-'))).toBe(true);
  expect(collectionModelCases()).toHaveLength(34);
  expect(scoreModelAnswer({ requiresNoEvidence: true }, { computations: [], citations: [] }, []).passed).toBe(true);
  expect(scoreModelAnswer({ requiresNoEvidence: true }, { citations: [{ id: 'unrelated' }] }, []).passed).toBe(false);
});
it('does not grade generic unverified boilerplate, errors or extra groups as successful answers', () => {
  expect(scoreModelAnswer({ requiresClarification: true }, { directAnswer: 'No verified answer yet. Clarify the field.', modelNarrative: 'Calculated 999.' }, []).passed).toBe(false);
  expect(scoreModelAnswer({ requiresClarification: true }, { error: 'failure', modelNarrative: 'Which field?' }, []).passed).toBe(false);
  expect(scoreModelAnswer({ requiresClarification: true }, { modelNarrative: 'Which available measure do you mean?' }, []).passed).toBe(true);
  expect(scoreModelAnswer({ metric: 'x', dimension: 'g', aggregation: 'sum', groups: { a: 2 } }, { computations: [{ metric: 'x', dimension: 'g', aggregation: 'sum', results: [{ group: 'a', value: 2 }, { group: 'extra', value: 9 }] }] }, []).passed).toBe(false);
  const spec = { metric: 'x', aggregation: 'sum', value: 2, expectedGraphSources: 30, expectedGraphEdges: 20 };
  const answer = { computations: [{ metric: 'x', dimension: '', aggregation: 'sum', results: [{ value: 2 }] }], graphCoverage: { approvedSources: 1, acceptedEdges: 0, excludedEdges: 20 } };
  expect(scoreModelAnswer(spec, answer, []).passed).toBe(false);
  expect(scoreModelAnswer(spec, { ...answer, graphCoverage: { approvedSources: 30, acceptedEdges: 20, excludedEdges: 0 } }, []).passed).toBe(true);
});
it('never borrows an old answer from another mode, source, scope or occurrence of the same question', () => {
  const thread = (revision, mode, id, value, filters = '[]') => ({ id: 'conversation:' + JSON.stringify([revision, filters, mode, 'graph']),
    messages: [{ role: 'user', id, text: 'Same question' }, { role: 'assistant', result: { value } }] });
  const threads = [thread('r1', 'agent', 'old', 999), thread('r2', 'rag', 'other-source', 999),
    thread('r1', 'rag', 'filtered', 999, '[["Region","East"]]'), thread('r1', 'rag', 'fresh', 42)];
  expect(findFreshEvaluationAnswer(threads, { sourceRevision: 'r1', mode: 'rag', query: 'Same question', previousUserIds: ['old'] })).toEqual({ value: 42 });
  expect(findFreshEvaluationAnswer(threads, { sourceRevision: 'r1', mode: 'rag', query: 'Same question', previousUserIds: ['old', 'fresh'] })).toBeNull();
  expect(scoreModelAnswer({ metric: 'Amount', aggregation: 'sum', value: 42, expectedDatasetId: 'a' }, {
    computations: [{ datasetId: 'b', metric: 'Amount', dimension: '', aggregation: 'sum', results: [{ value: 42 }] }]
  }, []).passed).toBe(false);
});

it('requires the intended graph path and current joined source revisions, not only graph inventory', () => {
  const sources = ['events', 'entities', 'zones', 'unrelated'].map((id) => ({ id, revisionKey: 'r1', columns: ['Value', 'Zone'], rowCount: 3 }));
  const spec = { graph: true, expectedDatasetId: 'events', expectedPathSourceIds: ['events', 'entities', 'zones'],
    metric: 'events::Value', dimension: 'zones::Zone', aggregation: 'sum', groups: { North: 8 } };
  const computation = { metric: spec.metric, dimension: spec.dimension, aggregation: 'sum', evidenceId: 'calculation:1', results: [{ group: 'North', value: 8 }],
    joins: [{ from: 'events', to: 'entities' }, { from: 'entities', to: 'zones' }], sourceRevisions: sources.slice(0, 3).map(({ id, revisionKey }) => ({ id, revision: revisionKey })) };
  expect(scoreModelAnswer(spec, { computations: [{ ...computation, joins: [] }] }, sources).passed).toBe(false);
  expect(scoreModelAnswer(spec, { computations: [{ ...computation, joins: [{ from: 'events', to: 'unrelated' }, { from: 'unrelated', to: 'zones' }] }] }, sources).passed).toBe(false);
  expect(scoreModelAnswer(spec, { computations: [{ ...computation, sourceRevisions: [{ id: 'events', revision: 'old' }] }] }, sources).passed).toBe(false);
  const citation = { id: 'calculation:1', kind: 'calculation', datasetId: 'events', revision: 'r1', fields: ['Value'] };
  expect(scoreModelAnswer(spec, { computations: [computation], citations: [citation] }, sources).passed).toBe(true);
});

it('rejects extra scalar results and unbound or fabricated calculation citations', () => {
  const spec = { metric: 'Amount', aggregation: 'sum', value: 42, expectedDatasetId: 'a' };
  const source = { id: 'a', revisionKey: 'r1', columns: ['Amount'], rowCount: 2 };
  const computation = { datasetId: 'a', metric: 'Amount', dimension: '', aggregation: 'sum', results: [{ value: 42 }], evidenceId: 'calculation:1' };
  const citation = { id: 'calculation:1', kind: 'calculation', datasetId: 'a', revision: 'r1', fields: ['Amount'] };
  expect(scoreModelAnswer(spec, { computations: [computation], citations: [citation] }, [source]).passed).toBe(true);
  expect(scoreModelAnswer(spec, { computations: [{ ...computation, evidenceId: undefined }], citations: [] }, [source]).passed).toBe(false);
  expect(scoreModelAnswer(spec, { computations: [{ ...computation, results: [{ value: 42 }, { value: 99 }] }], citations: [citation] }, [source]).passed).toBe(false);
  expect(scoreModelAnswer(spec, { computations: [computation], citations: [{ ...citation, id: 'fabricated' }] }, [source]).passed).toBe(false);
  expect(scoreModelAnswer(spec, { computations: [computation], citations: [{ ...citation, revision: 'old' }] }, [source]).passed).toBe(false);
});

export function scoreModelAnswer(spec, answer, sources) {
  const sameNumber = (actual, expected) => typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) < 1e-10;
  const computation = answer.computations?.find((item) => item.metric === spec.metric && item.aggregation === spec.aggregation && item.dimension === (spec.dimension || ''));
  const passed = !answer.error && (spec.requiresNoEvidence ? !answer.computations?.length && !answer.citations?.length
    : spec.requiresClarification
    ? !answer.computations?.length && /clarif|which|what|provide|specify|missing|unavailable|not (?:present|available|exist)/i.test(answer.clarification || answer.modelNarrative || '')
    : spec.citationText ? answer.citations?.some((citation) => (!spec.expectedDatasetId || citation.datasetId === spec.expectedDatasetId)
      && citation.text.includes(spec.citationText) && citation.sourceRowId?.endsWith(spec.sourceRowIdSuffix))
    : spec.groups ? Boolean(computation && computation.results.length === Object.keys(spec.groups).length && Object.entries(spec.groups).every(([group, value]) => computation.results.some((result) => result.group === group && sameNumber(result.value, value))))
    : Boolean(computation && computation.results.length === 1 && sameNumber(computation.results[0]?.value, spec.value)));
  const invalidCitations = (answer.citations || []).filter((citation) => {
    const source = sources.find((source) => source.id === citation.datasetId);
    if (!source || citation.revision !== source.revisionKey || !citation.id) return true;
    if (citation.kind === 'calculation' && !answer.computations?.some((item) => item.evidenceId === citation.id)) return true;
    const fields = source.columns.map((column) => typeof column === 'string' ? column : column.name);
    if ((citation.fields || []).some((field) => {
      if (fields.includes(field) || field === '__rows__') return false;
      if (!citation.joins?.length) return true;
      const owner = sources.find((item) => field.startsWith(`${item.id}::`));
      return !owner?.columns.some((column) => (typeof column === 'string' ? column : column.name) === field.slice(owner.id.length + 2));
    })) return true;
    if (citation.sourceRowId) {
      const prefix = `${source.sourceId || source.id}:row:`; const suffix = citation.sourceRowId.slice(prefix.length);
      if (!citation.sourceRowId.startsWith(prefix) || !/^[1-9]\d*$/.test(suffix) || Number(suffix) > source.rowCount) return true;
    }
    return false;
  }).map(({ id }) => id);
  const proposal = !spec.requiresProposal || (answer.recommendedCard?.chartType === 'bar' && answer.recommendedCard.preferredX === spec.dimension
    && answer.recommendedCard.preferredY === spec.metric && answer.recommendedCard.aggregation === spec.aggregation && answer.computations?.some((item) => item.evidenceId === answer.recommendedCard.evidenceId));
  const graphScope = !spec.expectedGraphSources || (answer.graphCoverage?.approvedSources === spec.expectedGraphSources
    && answer.graphCoverage?.acceptedEdges === spec.expectedGraphEdges && answer.graphCoverage?.excludedEdges === 0);
  const sourceScope = !spec.expectedDatasetId || !computation || spec.graph || computation.datasetId === spec.expectedDatasetId;
  const pathScope = !spec.expectedPathSourceIds || (computation?.joins?.length === spec.expectedPathSourceIds.length - 1
    && computation.joins.every((join, index) => join.from === spec.expectedPathSourceIds[index] && join.to === spec.expectedPathSourceIds[index + 1])
    && computation.sourceRevisions?.length === spec.expectedPathSourceIds.length
    && spec.expectedPathSourceIds.every((id) => computation.sourceRevisions.some((item) => item.id === id && item.revision === sources.find((source) => source.id === id)?.revisionKey)));
  const boundCalculation = !spec.expectedDatasetId || !computation || (typeof computation.evidenceId === 'string' && computation.evidenceId.length > 0
    && answer.citations?.some((citation) => citation.id === computation.evidenceId && citation.kind === 'calculation'));
  return { passed: Boolean(passed && proposal && graphScope && sourceScope && pathScope && boundCalculation) && !invalidCitations.length, numericCase: Boolean(spec.metric), invalidCitations };
}

export function findFreshEvaluationAnswer(threads, { query, previousUserIds, mode, sourceRevision }) {
  const seen = new Set(previousUserIds);
  for (const thread of threads) {
    let scope; try { scope = JSON.parse(thread.id.slice('conversation:'.length)); } catch { continue; }
    if (scope[0] !== sourceRevision || scope[2] !== mode || scope[1] !== '[]') continue;
    const index = thread.messages?.findIndex((message, position) => message.role === 'user' && message.text === query && !seen.has(message.id)
      && thread.messages[position + 1]?.role === 'assistant');
    if (index === undefined || index < 0 || thread.messages[index + 1]?.role !== 'assistant') continue;
    return thread.messages[index + 1].result;
  }
  return null;
}

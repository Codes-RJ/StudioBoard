// Bind only explicit, literal requests. This is a syntax guard around model
// planning, not a general-language parser or a source of computed answers.
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const questionRequirements = (question, sources, previousCalculation) => {
  const fields = sources.flatMap((source) => source.columns.map((column) => ({ sourceId: source.id, field: typeof column === 'string' ? column : column.name })))
    .filter(({ field }) => typeof field === 'string' && field.length);
  const qualityFields = /\bhow many\b[^?!]{0,120}\bmissing\s+or\s+nonnumeric\b/i.test(question)
    ? fields.filter(({ field }) => new RegExp("\\bmissing\\s+or\\s+nonnumeric\\s+[\"']?" + escape(field) + "(?![\\p{L}\\p{N}_])\\s+values?\\b", 'iu').test(question)) : [];
  const comparison = /\b(?:which\s+has\s+the\s+higher|compare\s+the)\s+average\b/i.test(question)
    ? (() => {
      const named = fields.filter(({ field }) => new RegExp('\\b' + escape(field) + '(?![\\p{L}\\p{N}_])', 'iu').test(question));
      return named.length === 2 && named[0].sourceId === named[1].sourceId ? named : null;
    })() : null;
  const operations = { sum: 'sum', total: 'sum', 'add up': 'sum', average: 'average', mean: 'average', median: 'median',
    min: 'min', minimum: 'min', smallest: 'min', lowest: 'min', max: 'max', maximum: 'max', largest: 'max', highest: 'max', count: 'count' };
  const operationPattern = '(add\\s+up|sum|total|average|mean|median|min|minimum|smallest|lowest|max|maximum|largest|highest|count)';
  const measures = fields.flatMap(({ sourceId, field }) => {
    const match = new RegExp('\\b' + operationPattern + '\\s+(?:(?:of|the|recorded)\\s+){0,2}["\']?' + escape(field) + '(?![\\p{L}\\p{N}_])', 'iu').exec(question);
    if (match) return [{ sourceId, field, aggregation: ['average', 'mean'].includes(match[1].toLowerCase())
      && (/\bweighted\s*$/i.test(question.slice(0, match.index)) || /\bweighted\s+by\b/i.test(question)) ? 'weighted_average' : operations[match[1].toLowerCase().replace(/\s+/g, ' ')] }];
    return new RegExp('\\b(?:calculate|compute)\\s+(?:the\\s+)?["\']?' + escape(field) + '(?![\\p{L}\\p{N}_])', 'iu').test(question)
      ? [{ sourceId, field, aggregation: null }] : [];
  });
  const clause = /\b(?:calculate|compute)\s+([^.,;?!\r\n]{1,160})(?:[.,;?!]|$)/iu.exec(question)?.[1].trim();
  let missingMetric = !measures.length && clause && /^[\p{L}][\p{L}\p{N}_ -]{0,79}$/u.test(clause)
    && !/\b(?:the|sum|total|average|mean|median|min|minimum|max|maximum|count|across|grouped|by|rows|records|and|then|all|of|that|same)\b/i.test(clause) ? clause : null;
  if (!measures.length && !missingMetric) {
    const requested = new RegExp('\\b' + operationPattern + '\\s+(?:(?:of|the|recorded)\\s+){0,2}["\']?([^.,;?!\\r\\n]{1,80}?)(?=\\s+(?:across|grouped|by|per|where|from|in|using|and|then)\\b|[.,;?!]|$)', 'iu').exec(question)?.[2].replace(/["']$/, '').trim();
    if (requested && !/\b(?:rows?|records?|all|that|same|measure|metric)\b/i.test(requested)
      && !fields.some(({ field }) => field.toLowerCase() === requested.toLowerCase())) missingMetric = requested;
  }
  if (!measures.length && /\b(?:(?:that|the)\s+same|that)\s+(?:measure|metric)\b/i.test(question)) {
    const previous = fields.find((field) => field.sourceId === previousCalculation?.sourceId && field.field === previousCalculation?.metric);
    const operation = /\b(sum|total|average|mean|median|min|minimum|max|maximum|count)\b/i.exec(question)?.[1];
    if (previous) measures.push({ ...previous, aggregation: operation ? operations[operation.toLowerCase()] : null });
    else missingMetric = 'the previous measure';
  }
  const groups = sources.flatMap((source) => source.columns.flatMap((column) => {
    const field = typeof column === 'string' ? column : column.name;
    if (typeof field !== 'string' || !field.length) return [];
    const match = new RegExp('\\b(?:group(?:ed)?\\s+by|by|per|for\\s+each)\\s+(?:the\\s+)?["\']?' + escape(field) + '(?![\\p{L}\\p{N}_])', 'iu').exec(question)
      || new RegExp('\\bwhich\\s+["\']?' + escape(field) + '(?![\\p{L}\\p{N}_])\\s+has\\s+(?:the\\s+)?highest\\b', 'iu').exec(question);
    return match && !/\bweighted\s*$/i.test(question.slice(0, match.index))
      ? [{ sourceId: source.id, field }] : [];
  }));
  const unknownGroup = !groups.length && /\b(?:group(?:ed)?\s+by|(?<!weighted\s)by|per|for\s+each)\s+(?:the\s+)?["']?([^.,;?!\r\n]{1,80}?)(?=\s+(?:across|using|through|from|in|where|and|then|excluding)\b|[.,;?!]|$)/iu.exec(question)?.[1].replace(/["']$/, '').trim();
  const chart = /\bpropose\s+(?:an?\s+)?(bar|line|pie|table)\s+(?:chart|plot)\b/i.exec(question);
  const negated = chart && /\b(?:do\s+not|don't|never|not)\s*$/i.test(question.slice(0, chart.index));
  return { grouping: groups.length === 1 ? groups[0] : null, ambiguousGrouping: groups.length > 1,
    ...(qualityFields.length === 1 ? { qualityField: qualityFields[0] } : {}),
    ...(comparison ? { comparison } : {}),
    ...(measures.length > 1 ? { ambiguousMetric: true } : {}),
    ...(unknownGroup ? { missingGrouping: unknownGroup } : {}),
    metric: qualityFields.length === 1 ? qualityFields[0] : measures.length === 1 ? { sourceId: measures[0].sourceId, field: measures[0].field } : null,
    aggregation: qualityFields.length === 1 ? 'average' : measures.length === 1 ? measures[0].aggregation : null, missingMetric,
    chartType: chart && !negated ? chart[1].toLowerCase() : null };
};

// Keep complete JSON objects within the model budget, with explicit omissions.
// Character limits are conservative transport bounds, not token guarantees.
const identityFields = new Set(['id', 'sourceId', 'datasetId', 'sourceRowId', 'name', 'field', 'fields', 'preferredX', 'preferredY', 'revision', 'revisionKey', 'edgeIds', 'evidenceId', 'evidenceIds']);
const compact = (value, depth = 0, textLimit = 600, arrayLimit = 12, field = '') => {
  if (typeof value === 'string') return !identityFields.has(field) && value.length > textLimit ? `${value.slice(0, textLimit)} [text shortened]` : value;
  if (value == null || typeof value !== 'object') return value;
  if (depth >= 5) return '[nested data omitted]';
  if (Array.isArray(value)) return value.slice(0, arrayLimit).map((item) => compact(item, depth + 1, textLimit, arrayLimit, field)).concat(value.length > arrayLimit ? [{ omittedItems: value.length - arrayLimit }] : []);
  const entries = Object.entries(value); const result = Object.fromEntries(entries.slice(0, 24).map(([key, item]) => [key, compact(item, depth + 1, textLimit, arrayLimit, key)]));
  if (entries.length > 24) result.omittedFields = entries.length - 24;
  return result;
};
export const modelJson = (value, limit = 6_000) => {
  for (const [textLimit, arrayLimit] of [[600, 12], [300, 12], [120, 6], [60, 3]]) {
    const serialized = JSON.stringify(compact(value, 0, textLimit, arrayLimit));
    if (serialized.length <= limit) return serialized;
  }
  return JSON.stringify({ contextOmitted: true, reason: 'Payload exceeds model context allowance. Request a narrower field, result or schema page.' });
};
export const fitModelMessages = (messages, maxChars = 18_000) => {
  const result = messages.map((message) => ({ ...message }));
  while (JSON.stringify(result).length > maxChars && result.length > 4) result.splice(2, Math.min(2, result.length - 4));
  if (JSON.stringify(result).length > maxChars) throw new Error('Question and schema exceed the local context budget. Narrow the question.');
  return result;
};
export const describeSource = (source) => ({ id: source.id, name: String(source.sourcePath || source.name || source.id).slice(0, 160),
  rows: source.rawRows?.length ?? source.rowCount ?? source.rowStorage?.streams?.rawRows?.length, fields: source.columns.length });
export const inspectSourceSchema = (source, { query = '', offset = 0, limit = 40 } = {}) => {
  if (typeof query !== 'string' || query.length > 200 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid schema page.');
  const fields = source.columns.map((column) => typeof column === 'string' ? { name: column } : column)
    .map((column) => ({ ...column, ...source.columnOverrides?.[column.name] }))
    .filter((column) => column.name.toLowerCase().includes(query.toLowerCase()));
  return { sourceId: source.id, totalFields: fields.length, offset, nextOffset: offset + limit < fields.length ? offset + limit : null, fields: fields.slice(offset, offset + limit) };
};

const mentioned = (question, name) => typeof name === 'string' && name.length > 0
  && new RegExp('(?<![\\p{L}\\p{N}_])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'iu').test(question);
export const sourceMentioned = (source, question) => [source.id, source.sourcePath, source.name]
  .filter((name) => typeof name === 'string').some((name) => mentioned(question, name) || mentioned(question, name.replaceAll('\\', '/').split('/').at(-1)));

// Preserve literal identities and all fields' discoverability. A question that
// names field 119 should not start with only the first twenty unrelated fields.
export const inspectQuestionSchema = (source, question, limit = 20) => {
  const columns = source.columns.map((column, index) => ({ column, index,
    named: mentioned(question, typeof column === 'string' ? column : column.name) }));
  columns.sort((a, b) => Number(b.named) - Number(a.named) || a.index - b.index);
  return inspectSourceSchema({ ...source, columns: columns.map(({ column }) => column) }, { limit });
};
export const promptSources = (datasets, selectedId, question) => datasets.map((source, index) => ({ source, index,
  priority: source.id === selectedId ? 0 : sourceMentioned(source, question) ? 1 : 2 }))
  .sort((a, b) => a.priority - b.priority || a.index - b.index).slice(0, 8).map(({ source }) => source);

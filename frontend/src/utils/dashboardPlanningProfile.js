const SAMPLE_LIMIT = 2_000;
const missing = (value) => value == null || typeof value === 'string' && !value.trim();

/** Bounded, evenly spaced decision profile. Charts still use eligible rows. */
export const profileDashboardPlanning = (dataset, groups) => {
  const rows = dataset?.rawRows;
  if (!Array.isArray(rows) || !rows.length) return groups;
  const size = Math.min(rows.length, SAMPLE_LIMIT);
  const fields = [...new Set([...(groups.measures || []), ...(groups.dimensions || []), ...(groups.date || [])])];
  const states = new Map(fields.map((field) => [field, { populated: 0, numeric: 0, distinct: new Set(), min: Infinity, max: -Infinity }]));
  for (let index = 0; index < size; index += 1) {
    const row = rows[Math.floor(index * rows.length / size)];
    for (const [field, state] of states) {
      const value = Object.hasOwn(row, field) ? row[field] : undefined;
      if (missing(value)) continue;
      state.populated += 1;
      const text = String(value);
      // Long text is unsuitable for compact category labels. Mark it high-cardinality
      // without retaining its contents or claiming exact uniqueness.
      if (text.length > 128) state.longText = true;
      else if (state.distinct.size < 65) state.distinct.add(text);
      const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
      if (Number.isFinite(number)) {
        state.numeric += 1;
        state.min = Math.min(state.min, number);
        state.max = Math.max(state.max, number);
      }
    }
  }
  const profiles = Object.fromEntries([...states].map(([field, state]) => [field, {
    populated: state.populated, numeric: state.numeric, distinct: state.longText ? 65 : state.distinct.size,
    min: state.numeric ? state.min : null, max: state.numeric ? state.max : null,
  }]));
  return { ...groups, planningProfile: { sampledRows: size, totalRows: rows.length, complete: size === rows.length, fields: profiles } };
};

/** Bounded, keyboard-readable values for all supported Plotly trace families. */
export const plotDataAlternative = (traces, limit = 100) => {
  const rows = [];
  const append = (row) => { if (rows.length < limit) rows.push(row); };
  for (const trace of traces) {
    if (rows.length >= limit || trace.hoverinfo === 'skip') continue;
    const series = trace.name || trace.type || 'Series';
    if (Array.isArray(trace.z?.[0])) {
      for (let y = 0; y < trace.z.length && rows.length < limit; y++) for (let x = 0; x < trace.z[y].length && rows.length < limit; x++) append({ series, x: trace.x?.[x] ?? x, y: trace.y?.[y] ?? y, z: trace.z[y][x] });
    } else if (trace.dimensions) {
      const count = Math.min(limit - rows.length, ...trace.dimensions.map((dimension) => dimension.values.length));
      for (let i = 0; i < count; i++) append({ series, record: i + 1, ...Object.fromEntries(trace.dimensions.map((dimension) => [dimension.label, dimension.values[i]])) });
    } else if (trace.labels) {
      for (let i = 0; i < trace.labels.length && rows.length < limit; i++) append({ series, label: trace.labels[i], parent: trace.parents?.[i], value: trace.values?.[i] });
    } else {
      const count = Math.max(trace.x?.length || 0, trace.y?.length || 0, trace.z?.length || 0);
      for (let i = 0; i < count && rows.length < limit; i++) append({ series, x: trace.x?.[i], y: trace.y?.[i],
        ...(trace.z ? { z: trace.z[i] } : {}), ...(trace.text ? { label: trace.text[i] } : {}),
        ...(trace.open ? { open: trace.open[i], high: trace.high?.[i], low: trace.low?.[i], close: trace.close?.[i] } : {}) });
    }
  }
  return { rows, fields: [...new Set(rows.flatMap(Object.keys))] };
};

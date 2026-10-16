const hexToRgb = (hex) => hex.match(/[a-f\d]{2}/gi).map((channel) => parseInt(channel, 16));
const interpolate = (start, end, amount) => {
  const left = hexToRgb(start); const right = hexToRgb(end);
  return `rgb(${left.map((channel, index) => Math.round(channel + (right[index] - channel) * amount)).join(',')})`;
};

/** Seaborn-style continuous coolwarm scale centered at zero. */
export const correlationColor = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '#e2e8f0';
  const normalized = Math.max(-1, Math.min(1, value));
  return normalized < 0
    ? interpolate('#3b4cc0', '#f7f7f7', normalized + 1)
    : interpolate('#f7f7f7', '#b40426', normalized);
};

export default function CorrelationHeatmap({ columns, matrix, title = 'Correlation heatmap' }) {
  const count = columns.length;
  // Keep the viewBox tight so a small matrix uses the card instead of being
  // dwarfed by fixed label gutters. The SVG still scales as one unit, which
  // keeps cells, annotations, and legend aligned while the card is resized.
  const cell = 56;
  const left = 82;
  const top = 52;
  const colorBarWidth = 12;
  const matrixSize = count * cell;
  const width = left + matrixSize + 54;
  const height = top + matrixSize + 12;

  return (
    <div className="h-full min-h-0 w-full overflow-auto rounded-xl bg-white" role="img" aria-label={`${title}, annotated Pearson correlation matrix`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        data-testid="correlation-heatmap"
      >
        <title>{title}: correlations range from negative one in blue to positive one in red</title>
        {columns.map((column, index) => (
          <text
            key={`x-${column}`}
            x={left + index * cell + cell / 2}
            y={top - 9}
            textAnchor="start"
            transform={`rotate(-34 ${left + index * cell + cell / 2} ${top - 9})`}
            fontSize="10"
            fontWeight="600"
            fill="#334155"
          >
            {String(column).slice(0, 18)}
          </text>
        ))}
        {matrix.map((row, rowIndex) => (
          <g key={row.key}>
            <text x={left - 8} y={top + rowIndex * cell + cell / 2 + 3} textAnchor="end" fontSize="10" fontWeight="600" fill="#334155">
              {String(row.key).slice(0, 18)}
            </text>
            {row.values.map((entry, columnIndex) => {
              const value = typeof entry.value === 'number' && Number.isFinite(entry.value) ? entry.value : null;
              const annotation = value === null ? 'N/A' : value.toFixed(2);
              const pairs = Number.isInteger(entry.pairCount) ? `${entry.pairCount} complete pairs` : 'complete pair count unavailable';
              const description = `${row.key} and ${entry.key}: ${annotation}; ${pairs}`;
              return (
                <g key={`${row.key}-${entry.key}`} aria-label={description}>
                  <title>{description}</title>
                  <rect
                    x={left + columnIndex * cell}
                    y={top + rowIndex * cell}
                    width={cell}
                    height={cell}
                    fill={correlationColor(value)}
                    stroke="#ffffff"
                    strokeWidth="1"
                  />
                  <text
                    x={left + columnIndex * cell + cell / 2}
                    y={top + rowIndex * cell + cell / 2 + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill={Math.abs(value) >= 0.55 ? '#ffffff' : '#172033'}
                  >
                    {annotation}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
        {Array.from({ length: 40 }, (_, index) => {
          const value = 1 - (index / 39) * 2;
          return <rect key={index} x={left + matrixSize + 20} y={top + index * matrixSize / 40} width={colorBarWidth} height={matrixSize / 40 + 0.5} fill={correlationColor(value)} />;
        })}
        {[['1', top + 4], ['0', top + matrixSize / 2 + 3], ['-1', top + matrixSize]].map(([label, y]) => (
          <text key={label} x={left + matrixSize + 36} y={y} fontSize="9" fill="#475569">{label}</text>
        ))}
      </svg>
    </div>
  );
}

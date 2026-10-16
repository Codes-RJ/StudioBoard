export const CHART_TYPE_VALUES = [
  'line', 'stepLine', 'spline', 'smoothArea', 'multiSpline', 'streamgraph',
  'rangeArea', 'waveform', 'sineWave', 'bar', 'horizontalBar', 'stackedBar',
  'pie', 'donut', 'area', 'waterfall', 'scatter', 'bubble', 'heatmap', 'density', 'contour',
  'histogram', 'box', 'violin', 'strip', 'ecdf', 'radar', 'polarScatter',
  'radialBar', 'scatter3d', 'surface3d', 'mesh3d', 'bubble4d',
  'parallelCoordinates', 'candlestick', 'gauge', 'funnel', 'treemap',
  'sunburst', 'sankey', 'kpi', 'table'
];

const LABEL_OVERRIDES = {
  kpi: 'KPI',
  ecdf: 'ECDF',
  scatter3d: '3D scatter',
  surface3d: '3D surface',
  mesh3d: '3D mesh',
  bubble4d: '4D bubble',
  spline: 'Spline / smooth line',
  multiSpline: 'Multi-series spline',
  sineWave: 'Sine wave generator'
};

export const formatChartTypeLabel = (value = '') => (
  LABEL_OVERRIDES[value] || value
    .replace(/3d/gi, ' 3D')
    .replace(/4d/gi, ' 4D')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase())
    .trim()
);

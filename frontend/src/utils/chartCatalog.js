import { CHART_TYPE_VALUES, formatChartTypeLabel } from './chartTypes';

const CHART_CATEGORIES = {
  stepLine: 'Core', horizontalBar: 'Core', stackedBar: 'Core', donut: 'Core', waterfall: 'Core',
  spline: 'Wave & curves', smoothArea: 'Wave & curves', multiSpline: 'Wave & curves',
  streamgraph: 'Wave & curves', rangeArea: 'Wave & curves', waveform: 'Wave & curves', sineWave: 'Wave & curves',
  bubble: 'Relationships', heatmap: 'Relationships', density: 'Relationships', contour: 'Relationships',
  histogram: 'Statistical', box: 'Statistical', violin: 'Statistical', strip: 'Statistical', ecdf: 'Statistical',
  radar: 'Polar', polarScatter: 'Polar', radialBar: 'Polar',
  scatter3d: '3D / 4D', surface3d: '3D / 4D', mesh3d: '3D / 4D', bubble4d: '3D / 4D',
  parallelCoordinates: 'Multivariate', candlestick: 'Specialized', gauge: 'Specialized', funnel: 'Specialized',
  treemap: 'Hierarchy / flow', sunburst: 'Hierarchy / flow', sankey: 'Hierarchy / flow',
  kpi: 'Data', table: 'Data'
};

const LABELS = {
  bubble: 'Bubble (3-variable)', heatmap: 'Correlation heatmap', density: '2D density',
  kpi: 'KPI', ecdf: 'ECDF',
  bubble4d: '4D bubble', scatter3d: '3D scatter', surface3d: '3D surface', mesh3d: '3D mesh',
  parallelCoordinates: 'Parallel coordinates', polarScatter: 'Polar scatter', radialBar: 'Radial bar',
  horizontalBar: 'Horizontal bar', stackedBar: 'Stacked bar', stepLine: 'Step line', box: 'Box plot', violin: 'Violin plot',
  spline: 'Spline / smooth line', smoothArea: 'Smooth area', multiSpline: 'Multi-series spline',
  streamgraph: 'Streamgraph', rangeArea: 'Range area / confidence band', waveform: 'Real-time waveform',
  sineWave: 'Sine wave generator'
};

export const CHART_TYPE_OPTIONS = CHART_TYPE_VALUES.map((value) => ({
  value,
  label: LABELS[value] || formatChartTypeLabel(value),
  category: CHART_CATEGORIES[value] || (['scatter'].includes(value) ? 'Relationships' : 'Core')
}));

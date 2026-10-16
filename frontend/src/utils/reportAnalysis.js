import { computeTrendChange } from './aiQueryEngine';
import { analyzeDataQuality, computeColumnStats } from './dataCleaner';
import { toNumber } from './chartDataTransforms';
import { dateGroupKey } from './dateSemantics';

const columnName = (column) => (typeof column === 'string' ? column : column?.name);

export const createReportInsightsAccumulator = (dataset, reserve = () => {}) => {
  const columns = (dataset?.columns || []).map(columnName).filter(Boolean);
  const groups = dataset?.metrics?.columnGroups || {};
  const numeric = (groups.numeric || []).filter((field) => dataset.columnOverrides?.[field]?.precision !== 'exact');
  const dimensions = groups.dimensions || [];
  const dates = groups.date || [];
  const dateColumn = dates[0] || columns.find((column) => /date|month|year|day|period/i.test(column));
  const primaryMetric = numeric[0];
  const categoryColumn = dimensions.find((column) => !dates.includes(column) && column !== dateColumn);
  const trendFields = [...new Set([primaryMetric, dateColumn, categoryColumn].filter(Boolean))];

  const trendRows = []; const tally = new Map();
  return {
    consume: (rows) => {
      for (const row of rows) {
        if (primaryMetric && dateColumn) {
          const projected = Object.fromEntries(trendFields.map((field) => [field, row?.[field]]));
          if (dataset.columnOverrides?.[dateColumn]?.dateKind) projected[dateColumn] = dateGroupKey(projected[dateColumn], dataset.columnOverrides[dateColumn]);
          reserve('trend', 1, JSON.stringify(projected).length * 2);
          trendRows.push(projected);
        }
        if (categoryColumn && primaryMetric) {
          const key = row?.[categoryColumn] != null && String(row[categoryColumn]).trim() !== '' ? String(row[categoryColumn]) : 'Unknown';
          const value = toNumber(row?.[primaryMetric]);
          if (value !== null) {
            if (!tally.has(key)) reserve('groups', 1, key.length * 2);
            tally.set(key, (tally.get(key) || 0) + value);
          }
        }
      }
    },
    finish: () => {
      const insights = [];
      if (primaryMetric && dateColumn) {
        const trend = computeTrendChange(trendRows, primaryMetric, dateColumn, categoryColumn || null);
        insights.push({
          kind: 'trend',
          primaryMetric,
          direction: trend.direction,
          pctChange: trend.pctChange,
          firstCount: trend.firstCount,
          firstTotal: trend.firstTotal,
          secondCount: trend.secondCount,
          secondTotal: trend.secondTotal,
          delta: trend.delta,
          topDecliner: trend.topDecliners[0]?.name || null,
          topGrower: trend.topGrowers[0]?.name || null,
        });
      }

      if (categoryColumn && numeric.length) {
        const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
        if (top) {
          insights.push({
            kind: 'category', dimension: categoryColumn, metric: numeric[0], category: top[0], value: top[1],
            total: [...tally.values()].reduce((sum, value) => sum + value, 0), segmentCount: tally.size,
          });
        }
      }
      return insights;
    },
  };
};

export const analyzeReportDataset = (dataset) => {
  const rows = dataset?.rawRows || [];
  const columns = (dataset?.columns || []).map(columnName).filter(Boolean);
  const insights = createReportInsightsAccumulator(dataset);
  insights.consume(rows);

  return {
    columns,
    quality: analyzeDataQuality(dataset),
    stats: computeColumnStats(rows, columns, dataset.columnOverrides),
    insights: insights.finish(),
  };
};

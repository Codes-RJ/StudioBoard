import { describe, expect, it } from 'vitest';
import { computeAdvancedChartPayload } from '../savedAdvancedChart';
import { buildAdvancedPlot } from '../advancedChartData';
import { computeChartSeriesPayload } from '../savedChartSeries';
import { computeChartSeries } from '../chartComputation';

const rows = Array.from({ length: 1027 }, (_, i) => ({ category: `C${i % 5}`, group: `G${i % 3}`, value: i % 11 ? i / 10 : null, x: i, y: i % 7, irrelevant: 'x'.repeat(2000) }));
const reference = { kind: 'local-dataset-reference', id: 'source', field: 'rawRows', revision: 'r1', storageRevision: 'g1' };
const scan = async (_, visit) => { for (let i = 0; i < rows.length; i += 512) await visit(rows.slice(i, i + 512), { offset: i, total: rows.length }); };
const input = { rows, selectedX: 'category', selectedY: 'value', preferredGroup: 'group', metricKey: 'value', aggregation: 'sum', visibleItems: 4,
  seriesColor: '#123456', palette: [], columnGroups: { numeric: ['x', 'y', 'value'] }, categoricalSeries: [] };
describe('saved chart field projections', () => {
  it.each(['stackedBar', 'multiSpline', 'streamgraph', 'box', 'violin', 'sunburst', 'strip', 'bubble', 'scatter3d', 'parallelCoordinates', 'candlestick'])('preserves %s traces and complete coverage', async (chartType) => {
    const payload = { ...input, chartType };
    expect(await computeAdvancedChartPayload({ ...payload, rows: reference }, { scan })).toEqual(buildAdvancedPlot(payload));
  });
  it.each(['histogram', 'ecdf', 'density', 'surface3d', 'mesh3d', 'contour'])('preserves %s distribution or point scope', async (chartType) => {
    const payload = { ...input, selectedX: 'x', selectedY: 'y', preferredZ: 'value', chartType };
    expect(await computeAdvancedChartPayload({ ...payload, rows: reference }, { scan })).toEqual(buildAdvancedPlot(payload));
  });
  it('rejects retained distributions above policy while running stacks retain no row table', async () => {
    await expect(computeAdvancedChartPayload({ ...input, chartType: 'box', rows: reference }, { scan, limits: { rows: 10, bytes: 1024 * 1024 } })).rejects.toThrow('memory policy');
    expect(await computeAdvancedChartPayload({ ...input, chartType: 'stackedBar', rows: reference }, { scan, limits: { rows: 0, bytes: 1024 * 1024 } })).toEqual(buildAdvancedPlot({ ...input, chartType: 'stackedBar' }));
  });
  it.each(['median', 'sum'])('preserves %s median/heatmap/sankey chart preparation without irrelevant fields', async (aggregation) => {
    for (const chartType of ['bar', 'heatmap', 'sankey']) {
      const payload = { ...input, chartType, aggregation, heatmapColumns: ['x', 'y'] };
      expect(await computeChartSeriesPayload({ ...payload, rows: reference }, { scan })).toEqual(computeChartSeries(payload));
    }
  });
});

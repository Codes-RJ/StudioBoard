import { useEffect, useMemo, useState } from 'react';
import PlotlyChart from './PlotlyChart';
import { runLocalTransform } from '../../utils/localTransforms';
import { buildAdvancedPlot } from '../../utils/advancedChartData';
import ChartDataAlternative from './ChartDataAlternative';
import { plotDataAlternative } from '../../utils/plotDataAlternative';

export default function AdvancedChart(props) {
  const { chartType, rows, filters, columnOverrides, categoricalSeries, columnGroups, selectedX, selectedY, preferredZ, preferredSize, preferredGroup, preferredOpen, preferredHigh, preferredLow, metricKey, aggregation, visibleItems, seriesColor, palette, showLegend, title } = props;
  const input = useMemo(() => ({ chartType, rows, filters, columnOverrides, categoricalSeries, columnGroups, selectedX, selectedY, preferredZ, preferredSize, preferredGroup, preferredOpen, preferredHigh, preferredLow, metricKey, aggregation, visibleItems, seriesColor, palette, showLegend, title }),
    [chartType, rows, filters, columnOverrides, categoricalSeries, columnGroups, selectedX, selectedY, preferredZ, preferredSize, preferredGroup, preferredOpen, preferredHigh, preferredLow, metricKey, aggregation, visibleItems, seriesColor, palette, showLegend, title]);
  const [computed, setComputed] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setComputed(null); setError('');
    if (typeof Worker === 'undefined') {
      if (rows.length <= 2000) setComputed({ input, result: buildAdvancedPlot(input) });
      else setError('Background processing is required for this chart scope.');
      return;
    }
    const controller = new AbortController();
    runLocalTransform('advanced-chart', input, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setComputed({ input, result }); })
      .catch((reason) => { if (reason.name !== 'AbortError') setError(reason.message); });
    return () => controller.abort();
  }, [input]);
  if (error) return <p role="alert" className="p-4 text-sm text-rose-700">{error}</p>;
  const plot = computed?.input === input ? computed.result : null;
  if (!plot) return <p role="status" className="p-4 text-sm text-slate-600">Preparing full-scope chart data?</p>;
  return <div className="flex h-full min-h-0 flex-col">
    {plot.coverage.plottedRows < plot.coverage.sourceRows && <p className="mb-1 text-xs text-slate-600">Plot preview: first {plot.coverage.plottedRows.toLocaleString()} of {plot.coverage.sourceRows.toLocaleString()} eligible rows.</p>}
    {plot.coverage.fullStatistics && <p className="mb-1 text-xs text-slate-600">Statistics use all {plot.coverage.sourceRows.toLocaleString()} eligible rows; visible groups may be limited.</p>}
    <div className="min-h-0 flex-1"><PlotlyChart traces={plot.traces} layout={plot.layout} renderer={plot.renderer} ariaLabel={`${title || 'Untitled chart'} interactive visualization`} /></div>
    <ChartDataAlternative label={title || 'Advanced chart'} {...plotDataAlternative(plot.traces)} />
  </div>;
}

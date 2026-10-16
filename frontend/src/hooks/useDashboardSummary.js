import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { runLocalTransform } from '../utils/localTransforms';
import { describeApiError } from '../utils/apiError';

export default function useDashboardSummary({ selectedDataset, liveSnapshot, globalFilters }) {
  const [kpiData, setKpiData] = useState({});
  const [loading, setLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const kpiAbortRef = useRef(null);
  useEffect(() => {
    if (selectedDataset && liveSnapshot?.datasetId === selectedDataset.id) {
      setAnalyticsError('');
      setKpiData(liveSnapshot.metrics || {});
      setLoading(false);
      return;
    }

    if (selectedDataset) {
      fetchKpiData();
      return;
    }

    setKpiData({});
  }, [selectedDataset, liveSnapshot, globalFilters]);

  useEffect(() => () => kpiAbortRef.current?.abort(), []);

  const fetchKpiData = async () => {
    if (!selectedDataset) return;
    kpiAbortRef.current?.abort();
    const controller = new AbortController();
    kpiAbortRef.current = controller;
    setLoading(true);
    try {
      if (selectedDataset.isLocal || selectedDataset.rawRows) {
        const metrics = await runLocalTransform('scoped-metrics', { dataset: selectedDataset, filters: globalFilters || {} }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setAnalyticsError('');
        setKpiData({
          rows: metrics.rows ?? selectedDataset.rowCount,
          columns: metrics.columns || (selectedDataset.columns?.length || 0),
          numericColumns: metrics.numericColumns || 0,
          categoricalColumns: metrics.categoricalColumns || 0,
          missingValues: metrics.missingValues || 0,
          completeness: metrics.completeness,
          primaryMean: metrics.primaryMean
        });
        return;
      }

      const { data } = await api.post('/analytics/descriptive', { 
        datasetId: selectedDataset.id 
      }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setAnalyticsError('');
      const statsEntries = Object.entries(data);
      const numericColumns = statsEntries.filter(([, value]) => typeof value?.mean === 'number');
      const totalMissing = statsEntries.reduce(
        (sum, [, value]) => sum + (typeof value?.missing === 'number' ? value.missing : 0),
        0
      );

      setKpiData({
        rows: selectedDataset.rowCount,
        columns: selectedDataset?.columns?.length || statsEntries.length,
        numericColumns: numericColumns.length,
        categoricalColumns: statsEntries.length - numericColumns.length,
        missingValues: totalMissing,
        primaryMean: numericColumns[0]?.[1]?.mean ?? null
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setAnalyticsError(describeApiError(error, 'Failed to load analytics summary.').text);
      setKpiData({
        rows: selectedDataset.rowCount,
        columns: selectedDataset?.columns?.length || 0
      });
    } finally {
      if (kpiAbortRef.current === controller) setLoading(false);
    }
  };

  return { kpiData, loading, analyticsError, fetchKpiData };
}

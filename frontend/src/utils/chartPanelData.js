import api from '../services/api';
import { describeApiError } from './apiError';
import { getStoredDatasetVersion } from './datasetWorkerPayload';

const MAX_SERVER_CHART_ROWS = 500;

export const loadChartPanelData = async ({ dataset, chartType, dataScope, sortBy, sortOrder, getLocalData, isFullTable, visibleItems, dataLimit, tablePage, dataPage, columns, setLoading, setData, setTableTotalRows, setError, setTablePage, setColumns }) => {
    if (!dataset) return;
    setLoading(true);
    try {
      if (dataset.isLocal || dataset.rawRows) {
        if (chartType !== 'table' && dataScope === 'full' && !sortBy && typeof Worker !== 'undefined' && getStoredDatasetVersion(dataset)) {
          setData(dataset.rawRows); setTableTotalRows(dataset.rawRows.length); setError(''); return;
        }
        const localResult = getLocalData(dataset.id, {
          limit: isFullTable ? visibleItems : dataScope === 'full' ? 0 : Math.max(1, Number(dataLimit || 180)),
          page: isFullTable ? tablePage : dataScope === 'full' ? 1 : Math.max(1, Number(dataPage || 1)),
          sort: sortBy || undefined,
          order: sortOrder || 'asc'
        });
        setError('');
        setData(localResult.data || []);
        setTableTotalRows(isFullTable ? Number(localResult.total || 0) : Number(localResult.data?.length || 0));
        if (isFullTable && localResult.total > 0) {
          setTablePage((currentPage) => Math.min(currentPage, Math.ceil(localResult.total / visibleItems)));
        }
        return;
      }

      const { data: response } = await api.get(`/datasets/${dataset.id}/data`, {
        params: {
          // Server datasets are paged. Avoid a zero-limit request that would
          // either violate the API contract or return an unbounded file.
          limit: isFullTable ? visibleItems : dataScope === 'full' ? MAX_SERVER_CHART_ROWS : Math.max(1, Number(dataLimit || 180)),
          page: isFullTable ? tablePage : dataScope === 'full' ? 1 : Math.max(1, Number(dataPage || 1)),
          sort: sortBy || undefined,
          order: sortOrder || 'asc'
        }
      });
      setError('');
      setData(response.data || []);
      if (columns.length === 0 && Array.isArray(response.columns)) setColumns(response.columns);
      setTableTotalRows(isFullTable ? Number(response.total || 0) : Number(response.data?.length || 0));
      if (isFullTable && response.total > 0) {
        setTablePage((currentPage) => Math.min(currentPage, Math.ceil(response.total / visibleItems)));
      }
    } catch (requestError) {
      setData([]);
      setTableTotalRows(0);
      setError(describeApiError(requestError, 'Failed to load chart data.').text);
      console.error('Failed to fetch chart data', requestError);
    } finally {
      setLoading(false);
    }
  };


import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { FiChevronDown, FiChevronUp, FiDownload, FiFilter, FiRefreshCw } from 'react-icons/fi';
import { useFilters, usePagination, useSortBy, useTable } from 'react-table';
import api from '../../services/api';
import ColumnFilter from '../tables/ColumnFilter';
import { useDashboard } from '../../context/DashboardContext';
import { exportLocalDataset } from '../../utils/localDataEngine';
import { describeApiError } from '../../utils/apiError';

const LIVE_BADGE_STYLES = {
  live: 'bg-green-100 text-green-800 border-green-700',
  polling: 'bg-amber-100 text-amber-800 border-amber-700',
  connecting: 'bg-blue-100 text-blue-800 border-blue-700',
  paused: 'bg-slate-100 text-slate-700 border-slate-500',
  error: 'bg-red-100 text-red-800 border-red-700'
};

function formatCellValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString() : '-';
  }
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '-' : value.toLocaleString();
  if (typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);
      return serialized.length > 250 ? `${serialized.slice(0, 247)}...` : serialized;
    } catch {
      return '-';
    }
  }
  return String(value);
}

function DataTable({ dataset, refreshSignal, liveStatus = 'idle' }) {
  const { getLocalData } = useDashboard();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [remoteColumns, setRemoteColumns] = useState([]);
  const [showFilters, setShowFilters] = useState(false);

  const tableContainerRef = useRef();

  // Columns derived with useMemo — rebuilding them (and resetting react-table
  // column state) on every sort/filter change caused visible flicker.
  const columns = useMemo(() => {
    if (!dataset) return [];
    const cols = Array.isArray(dataset.columns) && dataset.columns.length > 0
      ? dataset.columns
      : remoteColumns;
    return cols
      .map((col) => {
        const colName = typeof col === 'string' ? col : col?.name;
        // react-table stores values in ordinary objects. Keep its internal IDs
        // distinct from source keys such as __proto__, and avoid path accessors
        // so a literal dotted header is still read as one source field.
        return colName ? { Header: colName, id: `field:${colName}`, sourceField: colName,
          accessor: (row) => Object.hasOwn(row, colName) ? row[colName] : null, Filter: ColumnFilter } : null;
      })
      .filter(Boolean);
  }, [dataset, remoteColumns]);

  // Server datasets may need their schema fetched once per dataset.
  useEffect(() => {
    setRemoteColumns([]);
    if (!dataset || dataset.isLocal || (Array.isArray(dataset.columns) && dataset.columns.length > 0)) {
      return;
    }
    let cancelled = false;
    api.get(`/datasets/${dataset.id}`)
      .then(({ data }) => {
        if (!cancelled && Array.isArray(data?.columns)) {
          setRemoteColumns(data.columns);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(describeApiError(requestError, 'Failed to load dataset columns.').text);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataset?.id]);

  const fetchData = async (pageIndex, tableSortBy = [], tableFilters = []) => {
    if (!dataset) return;
    setLoading(true);
    try {
      const sourceFields = new Map(columns.map((column) => [column.id, column.sourceField]));
      const activeFilters = Object.fromEntries(tableFilters
        .filter((filter) => sourceFields.has(filter?.id) && filter.value !== undefined && filter.value !== null && filter.value !== '')
        .map((filter) => [sourceFields.get(filter.id), filter.value]));
      const sort = sourceFields.get(tableSortBy[0]?.id);

      if (dataset.isLocal || dataset.rawRows) {
        const localResult = getLocalData(dataset.id, {
          page: pageIndex + 1,
          limit: pageSize,
          sort,
          order: tableSortBy[0]?.desc ? 'desc' : 'asc',
          filters: activeFilters
        });
        setError('');
        setData(localResult.data || []);
        setTotalRows(localResult.total || 0);
        setPageCount(Math.ceil((localResult.total || 0) / pageSize));
        return;
      }

      const params = {
        page: pageIndex + 1,
        limit: pageSize,
        sort,
        order: tableSortBy[0]?.desc ? 'desc' : 'asc',
        filters: JSON.stringify(activeFilters)
      };

      const { data } = await api.get(`/datasets/${dataset.id}/data`, { params });
      setError('');
      setData(data.data);
      setTotalRows(data.total);
      setPageCount(Math.ceil(data.total / pageSize));
    } catch (error) {
      setError(describeApiError(error, 'Failed to load dataset rows. Check that the analytics engine is running.').text);
      setData([]);
      setTotalRows(0);
      setPageCount(0);
      console.error('Failed to fetch data', error);
    } finally {
      setLoading(false);
    }
  };

  const {
    getTableProps,
    getTableBodyProps,
    headerGroups,
    prepareRow,
    page,
    canPreviousPage,
    canNextPage,
    pageOptions,
    gotoPage,
    nextPage,
    previousPage,
    setPageSize: setTablePageSize,
    state: { pageIndex, sortBy: tableSortBy, filters: tableFilters },
  } = useTable(
    {
      columns,
      data,
      initialState: { pageIndex: 0, pageSize },
      manualPagination: true,
      pageCount,
      manualSortBy: true,
      manualFilters: true,
      disableFilters: !showFilters,
      autoResetPage: false,
      autoResetSortBy: false,
      autoResetFilters: false
    },
    useFilters,
    useSortBy,
    usePagination
  );

  const fetchTimeoutRef = useRef(null);
  const prevFilterSortRef = useRef({ tableSortBy, tableFilters });

  useEffect(() => {
    if (!dataset?.id) return;

    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    fetchTimeoutRef.current = setTimeout(() => {
      fetchData(pageIndex, tableSortBy, tableFilters);
    }, 60);

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, [dataset?.id, dataset?.updatedAt, dataset?.rawRows, pageIndex, pageSize, tableSortBy, tableFilters, refreshSignal]);

  useEffect(() => {
    if (pageIndex !== 0) {
      gotoPage(0);
    }
  }, [pageSize, tableSortBy, tableFilters]);

  // Virtual rows
  const rowVirtualizer = useVirtualizer({
    count: page.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 35,
    overscan: 5
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  const handleExport = async (format) => {
    if (!dataset) return;
    if (dataset.isLocal || dataset.rawRows) {
      await exportLocalDataset(dataset, format);
      return;
    }
    try {
      const response = await api.post(`/datasets/${dataset.id}/export`, 
        { format },
        { responseType: 'blob' }
      );
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `export.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setError(describeApiError(error, 'Failed to export this dataset.').text);
      console.error('Export failed', error);
    }
  };

  if (!dataset) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
        Select a dataset to view data
      </div>
    );
  }

  return (
    <div className="data-preview overflow-hidden">
      {/* Table Controls */}
      <div className="data-preview-header flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Data Preview</h3>
          <span className="text-xs text-slate-500">
            {totalRows.toLocaleString()} rows total
          </span>
          {liveStatus !== 'idle' && (
            <span className={`text-xs font-black uppercase px-2 py-1 border-2 rounded-sm ${LIVE_BADGE_STYLES[liveStatus] || LIVE_BADGE_STYLES.paused}`}>
              {liveStatus === 'live' ? 'Live Sync' : liveStatus}
            </span>
          )}
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={e => {
              setPageSize(Number(e.target.value));
              setTablePageSize(Number(e.target.value));
            }}
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700"
          >
            {[50, 100, 200, 500, 1000].map(size => (
              <option key={size} value={size}>{size} rows</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-lg border border-slate-200 hover:bg-slate-50 ${showFilters ? 'bg-slate-100 text-slate-900' : 'text-slate-600'}`}
            title="Toggle filters"
            aria-label="Toggle table filters"
          >
            <FiFilter />
          </button>
          <button
            onClick={() => handleExport('csv')}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
            title="Export spreadsheet-safe CSV; formula-like text receives an apostrophe prefix. Original files and JSON retain values."
            aria-label="Export table CSV"
          >
            <FiDownload />
          </button>
          <button
            onClick={() => fetchData(pageIndex, tableSortBy, tableFilters)}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
            title="Refresh"
            aria-label="Refresh table"
          >
            <FiRefreshCw />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-rose-50 text-rose-800 font-medium">
          <span>{error}</span>
          <button type="button" onClick={() => void fetchData(pageIndex, tableSortBy, tableFilters)} className="shrink-0 border border-current bg-white px-3 py-1.5 text-xs font-semibold">
            Retry
          </button>
        </div>
      )}

      {/* Pagination Controls */}
      <div className="px-4 py-3 border-b border-slate-100 bg-white flex flex-wrap gap-3 justify-between items-center text-slate-700 font-medium">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => gotoPage(0)}
            disabled={!canPreviousPage}
            className="px-3 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            First
          </button>
          <button
            onClick={previousPage}
            disabled={!canPreviousPage}
            className="px-3 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            Prev
          </button>
          <span className="px-3 py-1 flex items-center">
            Page <strong>{pageIndex + 1} of {pageOptions.length}</strong>
          </span>
          <button
            onClick={nextPage}
            disabled={!canNextPage}
            className="px-3 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => gotoPage(pageCount - 1)}
            disabled={!canNextPage}
            className="px-3 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            Last
          </button>
        </div>
        <div className="text-sm text-slate-500">
          Showing {pageIndex * pageSize + 1} - {Math.min((pageIndex + 1) * pageSize, totalRows)} of {totalRows}
        </div>
      </div>

      {/* Virtualized Table */}
      <div 
        ref={tableContainerRef} 
        className="overflow-auto max-w-full"
        style={{ height: '500px', maxHeight: '500px' }}
      >
        <table {...getTableProps()} className="min-w-full divide-y divide-slate-200">
          <thead className="bg-white text-slate-900 sticky top-0 z-10 border-b border-slate-200">
            {headerGroups.map(headerGroup => (
              <tr {...headerGroup.getHeaderGroupProps()}>
                {headerGroup.headers.map(column => (
                  <th
                    {...column.getHeaderProps(column.getSortByToggleProps())}
                    className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 cursor-pointer border-r border-slate-100 last:border-r-0"
                  >
                    <div className="flex items-center gap-1">
                      {column.render('Header')}
                      {column.isSorted && (
                        <span>
                          {column.isSortedDesc ? <FiChevronDown /> : <FiChevronUp />}
                        </span>
                      )}
                    </div>
                    {showFilters && column.canFilter && column.render('Filter')}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody {...getTableBodyProps()} className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-8">
                  <div className="flex justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                  </div>
                </td>
              </tr>
            ) : (
              <>
                {/*
                  Spacer rows instead of translateY: transforms are ignored by
                  table-row layout, which made rows overlap and broke scrolling.
                */}
                {virtualRows.length > 0 && virtualRows[0].start > 0 && (
                  <tr aria-hidden="true" style={{ height: `${virtualRows[0].start}px` }}>
                    <td colSpan={columns.length} style={{ padding: 0, border: 'none' }} />
                  </tr>
                )}
                {virtualRows.map(virtualRow => {
                  const row = page[virtualRow.index];
                  if (!row) return null;
                  prepareRow(row);
                  return (
                    <tr
                      {...row.getRowProps()}
                      style={{ height: `${virtualRow.size}px` }}
                      className="hover:bg-gray-50"
                    >
                      {row.cells.map(cell => {
                        const numericCol = dataset?.metrics?.columnGroups?.numeric?.includes(cell.column.sourceField);
                        return (
                          <td
                            {...cell.getCellProps()}
                            className={`tabular-nums ${
                              `px-5 py-3 whitespace-nowrap text-sm text-slate-600${numericCol ? ' text-right font-medium' : ''}`
                            }`}
                          >
                            {formatCellValue(cell.value)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {(() => {
                  const last = virtualRows[virtualRows.length - 1];
                  if (!last) return null;
                  const bottomPad = rowVirtualizer.getTotalSize() - (last.start + last.size);
                  return bottomPad > 0 ? (
                    <tr aria-hidden="true" style={{ height: `${bottomPad}px` }}>
                      <td colSpan={columns.length} style={{ padding: 0, border: 'none' }} />
                    </tr>
                  ) : null;
                })()}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default memo(DataTable);

import useDashboardSummary from '../hooks/useDashboardSummary';
import { useSearchParams } from 'react-router-dom';
import DashboardToolbar from '../components/dashboard/DashboardToolbar';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import ChartPanel from '../components/dashboard/ChartPanel';
import DataTable from '../components/dashboard/DataTable';
import KpiCard from '../components/dashboard/KpiCard';
import LayoutSelector from '../components/dashboard/LayoutSelector';
import AskDataAssistant from '../components/dashboard/AskDataAssistant';
import LayoutHistoryControls from '../components/dashboard/LayoutHistoryControls';
import FilterBar from '../components/dashboard/FilterBar';
import { DEFAULT_LAYOUT_ITEMS, useDashboard } from '../context/DashboardContext';
import useRealtimeDataset from '../hooks/useRealtimeDataset';
import useDatasetExport from '../hooks/useDatasetExport';
import toast from 'react-hot-toast';
import { MAX_LOCAL_DATASET_BYTES, SAMPLE_DATASETS } from '../utils/localDataEngine';
import { importLocalFileWorkspace } from '../utils/folderImport';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { useOperationStatus } from '../context/OperationStatusContext';
import { describeApiError, reportExpectedDegradation } from '../utils/apiError';
import {
  addLayoutCard,
  buildResponsiveLayouts,
  duplicateLayoutCard,
  moveLayoutCard,
  reorderLayoutCard,
  removeLayoutCard,
  resizeLayoutCard,
  resetLayoutCard
} from '../utils/layoutModel';
import { CHART_TYPE_VALUES, formatChartTypeLabel } from '../utils/chartTypes';
import { getDatasetColumnGroups, getGraphTypeCompatibility, repairGraphConfiguration } from '../utils/graphConfiguration';
import { CHART_PALETTES, normalizeDashboardColor } from '../utils/chartAppearance';
import { SERVER_WORKSPACE_ENABLED } from '../config/workspace';
import { qualityRevisionKey } from '../utils/qualityReview';
import DashboardSourceGate from '../components/dashboard/DashboardSourceGate';

const ResponsiveGridLayout = WidthProvider(Responsive);
const DashboardEditorDrawer = lazy(() => import('../components/dashboard/DashboardEditorDrawer'));
const DataQualityPanel = lazy(() => import('../components/dashboard/SavedDataQualityPanel'));
const FolderOverviewPanel = lazy(() => import('../components/dashboard/FolderOverviewPanel'));
const GRID_COLUMNS_BY_BREAKPOINT = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

const loadStoredChartPalette = () => {
  try {
    return normalizeDashboardColor(localStorage.getItem('dashboard-chart-palette'));
  } catch (error) {
    reportExpectedDegradation('Chart palette preference could not be restored.', error);
    return 'blue';
  }
};

const formatLiveStatus = (status) => {
  switch (status) {
    case 'live':
      return 'Streaming';
    case 'polling':
      return 'Polling';
    case 'connecting':
      return 'Connecting';
    case 'paused':
      return 'Paused';
    case 'error':
      return 'Attention';
    default:
      return 'Idle';
  }
};

export default function Dashboard() {
  const { settings } = useSiteSettings();
  const { addLocalDataset } = useDashboard();
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('sample') !== 'saas' || !settings.sections.showDashboard) return;
    // Use the existing explicit sample-import path: catalogue restore merges
    // saved sources rather than replacing this selection or deleting files.
    addLocalDataset(SAMPLE_DATASETS[0]);
    const next = new URLSearchParams(params);
    next.delete('sample');
    setParams(next, { replace: true });
  }, [addLocalDataset, params, setParams, settings.sections.showDashboard]);
  return <DashboardSourceGate settings={settings}><DashboardWorkspace settings={settings} /></DashboardSourceGate>;
}

function DashboardWorkspace({ settings }) {
  const { startOperation } = useOperationStatus();
  const { 
    layouts,
    currentLayout, 
    setCurrentLayout,
    selectLayout,
    applyLayoutChange,
    beginLayoutEditSession,
    cancelLayoutEditSession,
    commitLayoutEditSession,
    undoLayoutChange,
    redoLayoutChange,
    generateSmartLayout,
    selectedDataset,
    setSelectedDataset,
    datasets,
    updateLocalDataset,
    addLocalDatasets,
    loadLocalDatasets,
    globalFilters
  } = useDashboard();
  
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [chartPalette, setChartPalette] = useState(loadStoredChartPalette);
  const [isDashboardEditing, setIsDashboardEditing] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [activeGridBreakpoint, setActiveGridBreakpoint] = useState('lg');
  const [configurationRequest, setConfigurationRequest] = useState({ id: null, version: 0 });
  const layoutPlanRequestRef = useRef(null);
  const fileInputRef = useRef(null);
  const editorReturnFocusRef = useRef(null);
  const reportAbortRef = useRef(null);

  const beginDashboardEditing = useCallback((openDrawer = true) => {
    beginLayoutEditSession();
    setIsDashboardEditing(true);
    if (openDrawer) setIsEditorOpen(true);
  }, [beginLayoutEditSession]);

  const saveDashboardEditing = useCallback(() => {
    setIsEditorOpen(false);
    setIsDashboardEditing(false);
    void commitLayoutEditSession();
  }, [commitLayoutEditSession]);

  const cancelDashboardEditing = useCallback(() => {
    cancelLayoutEditSession();
    setIsEditorOpen(false);
    setIsDashboardEditing(false);
  }, [cancelLayoutEditSession]);

  // Local datasets live entirely in browser memory — there is nothing to
  // stream from a server, so polling/SSE is disabled to avoid constant
  // failing requests and re-renders every few seconds.
  const isLocalActive = Boolean(selectedDataset && (selectedDataset.isLocal || selectedDataset.rawRows));
  const isDemoDataset = SAMPLE_DATASETS.some(({ id }) => id === selectedDataset?.id);

  const {
    snapshot: liveSnapshot,
    status: liveStatus,
    error: liveError,
    lastUpdated,
    refresh: refreshLiveSnapshot
  } = useRealtimeDataset(selectedDataset?.id, {
    enabled: liveEnabled && Boolean(selectedDataset) && !isLocalActive,
    intervalMs: 8000
  });

  const { kpiData, loading, analyticsError, fetchKpiData } = useDashboardSummary({ selectedDataset, liveSnapshot, globalFilters });

  useEffect(() => () => {
    reportAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    reportAbortRef.current?.abort();
    reportAbortRef.current = null;
  }, [selectedDataset?.id]);

  useEffect(() => {
    try {
      localStorage.setItem('dashboard-chart-palette', chartPalette);
    } catch (error) {
      reportExpectedDegradation('Chart palette preference could not be saved.', error);
    }
  }, [chartPalette]);

  useEffect(() => {
    if (!selectedDataset || !currentLayout) {
      return;
    }

    if (currentLayout.source !== 'planner') {
      return;
    }

    if (currentLayout.sourceDatasetId === selectedDataset.id) {
      return;
    }

    let cancelled = false;
    const datasetRevision = qualityRevisionKey(selectedDataset);

    const planLayout = async () => {
      // Re-renders can replace the dataset object while a plan is pending.
      // Every current effect must be able to await that same request.
      const request = layoutPlanRequestRef.current?.datasetId === selectedDataset.id
        && layoutPlanRequestRef.current.datasetRevision === datasetRevision
        ? layoutPlanRequestRef.current
        : { datasetId: selectedDataset.id, datasetRevision, promise: generateSmartLayout(selectedDataset.id) };
      layoutPlanRequestRef.current = request;

      try {
        const plannedLayout = await request.promise;

        if (!cancelled) {
          selectLayout(plannedLayout);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(describeApiError(error, 'Failed to generate smart layout.').text);
        }
      } finally {
        if (layoutPlanRequestRef.current === request) {
          layoutPlanRequestRef.current = null;
        }
      }
    };

    planLayout();

    return () => {
      cancelled = true;
    };
  }, [selectedDataset?.id, currentLayout?.name, currentLayout?.source, currentLayout?.sourceDatasetId, generateSmartLayout, selectLayout]);

  const handleDirectFileOpen = async (e) => {
    if (!settings.features.localUpload) {
      toast.error('Local dataset import is currently unavailable');
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOCAL_DATASET_BYTES) {
      toast.error('The selected file exceeds the 100 MB browser limit.');
      e.target.value = '';
      return;
    }
    const operation = startOperation('Importing local dataset');
    operation.update('Parsing the file in your browser…');
    try {
      const workspace = await importLocalFileWorkspace(file);
      addLocalDatasets(workspace.datasets, workspace.selected, { persisted: true });
      const sourceCount = workspace.datasets.filter((dataset) => !dataset.isFolderOverview).length;
      operation.succeed(`Loaded ${sourceCount} dataset${sourceCount === 1 ? '' : 's'} from ${file.name} in this browser.`);
    } catch (err) {
      operation.fail(err.message || 'Failed to parse file');
    } finally {
      e.target.value = '';
    }
  };

  const handleGridLayoutChange = useCallback((layout) => {
    if (currentLayout) {
      const sourceColumns = GRID_COLUMNS_BY_BREAKPOINT[activeGridBreakpoint] || 12;
      const scale = 12 / sourceColumns;
      const mergedLayout = (currentLayout.layout || DEFAULT_LAYOUT_ITEMS).map((item) => {
        const nextPosition = layout.find((layoutItem) => layoutItem.i === item.i);
        if (!nextPosition) return item;
        return {
          ...item,
          ...nextPosition,
          x: Math.round(nextPosition.x * scale),
          w: Math.round(nextPosition.w * scale)
        };
      });
      const updatedLayout = { ...currentLayout, layout: mergedLayout };
      applyLayoutChange(updatedLayout);
    }
  }, [activeGridBreakpoint, applyLayoutChange, currentLayout]);

  // Stable identities so memoized ChartPanels skip re-renders they don't need.
  const handleCardConfigChange = useCallback((itemId, patch, { automatic = false } = {}) => {
    const updateCard = (activeLayout) => {
      if (!activeLayout) return activeLayout;
      const updatedItems = activeLayout.layout.map(item =>
        item.i === itemId ? { ...item, ...patch } : item
      );
      return { ...activeLayout, layout: updatedItems };
    };
    if (automatic) setCurrentLayout(updateCard);
    else applyLayoutChange(updateCard);
  }, [applyLayoutChange, setCurrentLayout]);

  const handleChartTypeChange = useCallback((itemId, chartType) => {
    handleCardConfigChange(itemId, { chartType });
  }, [handleCardConfigChange]);

  const showUndoToast = useCallback((message) => {
    toast((toastInstance) => (
      <span className="flex items-center gap-3">
        {message}
        <button
          type="button"
          className="font-semibold text-indigo-800 underline underline-offset-4 hover:text-indigo-950"
          onClick={() => {
            undoLayoutChange();
            toast.dismiss(toastInstance.id);
          }}
        >
          Undo
        </button>
      </span>
    ), { duration: 6000 });
  }, [undoLayoutChange]);

  const focusDashboardCard = useCallback((itemId) => {
    setIsEditorOpen(false);
    window.requestAnimationFrame(() => {
      const card = document.getElementById(`dashboard-card-${itemId}`);
      card?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      card?.focus({ preventScroll: true });
    });
  }, []);

  const handleAddGraph = useCallback((chartType = 'line') => {
    if (!currentLayout) return;
    const label = formatChartTypeLabel(chartType) || 'Line';
    const compatibleConfiguration = repairGraphConfiguration({
      chartType,
      preferredX: '',
      preferredY: ''
    }, getDatasetColumnGroups(selectedDataset));
    const nextItems = addLayoutCard(currentLayout.layout, {
      ...compatibleConfiguration,
      title: `${label} chart`
    });
    applyLayoutChange({ ...currentLayout, layout: nextItems });
    const addedCard = nextItems.at(-1);
    setIsDashboardEditing(true);
    setConfigurationRequest((current) => ({ id: addedCard.i, version: current.version + 1 }));
    focusDashboardCard(addedCard.i);
    showUndoToast(`${label} graph added.`);
  }, [applyLayoutChange, currentLayout, focusDashboardCard, selectedDataset, showUndoToast]);

  const handleDuplicateCard = useCallback((itemId) => {
    if (!currentLayout) return;
    const nextItems = duplicateLayoutCard(currentLayout.layout, itemId);
    if (nextItems.length === currentLayout.layout.length) return;
    applyLayoutChange({ ...currentLayout, layout: nextItems });
    showUndoToast('Card duplicated.');
  }, [applyLayoutChange, currentLayout, showUndoToast]);

  const handleResetCard = useCallback((itemId) => {
    if (!currentLayout) return;
    applyLayoutChange({
      ...currentLayout,
      layout: resetLayoutCard(currentLayout.layout, itemId)
    });
    showUndoToast('Card reset.');
  }, [applyLayoutChange, currentLayout, showUndoToast]);

  const handleReorderCard = useCallback((itemId, direction) => {
    if (!currentLayout) return;
    applyLayoutChange({
      ...currentLayout,
      layout: reorderLayoutCard(currentLayout.layout, itemId, direction)
    });
  }, [applyLayoutChange, currentLayout]);

  const handleResetDashboard = useCallback(() => {
    if (!currentLayout || !window.confirm('Reset every dashboard card to the default layout?')) return;
    const columnGroups = getDatasetColumnGroups(selectedDataset);
    const compatibleTypes = CHART_TYPE_VALUES
      .filter((type) => getGraphTypeCompatibility(type, columnGroups).compatible);
    const resetItems = DEFAULT_LAYOUT_ITEMS.map((item) => {
      const chartType = getGraphTypeCompatibility(item.chartType, columnGroups).compatible
        ? item.chartType
        : (compatibleTypes[0] || 'table');
      return repairGraphConfiguration({ ...item, chartType }, columnGroups);
    });
    applyLayoutChange({ ...currentLayout, layout: resetItems });
    showUndoToast('Dashboard reset.');
  }, [applyLayoutChange, currentLayout, selectedDataset, showUndoToast]);

  const handleKeyboardMoveCard = useCallback((itemId, deltaX, deltaY) => {
    if (!currentLayout) return;
    applyLayoutChange({
      ...currentLayout,
      layout: moveLayoutCard(currentLayout.layout, itemId, deltaX, deltaY)
    });
  }, [applyLayoutChange, currentLayout]);

  const handleKeyboardResizeCard = useCallback((itemId, deltaWidth, deltaHeight) => {
    if (!currentLayout) return;
    applyLayoutChange({
      ...currentLayout,
      layout: resizeLayoutCard(currentLayout.layout, itemId, deltaWidth, deltaHeight)
    });
  }, [applyLayoutChange, currentLayout]);

  const handleConfigureCard = useCallback((itemId) => {
    setIsDashboardEditing(true);
    setConfigurationRequest((current) => ({ id: itemId, version: current.version + 1 }));
    focusDashboardCard(itemId);
  }, [focusDashboardCard]);

  const handleRemoveCard = useCallback((itemId) => {
    if (!currentLayout) return;

    const updatedLayout = {
      ...currentLayout,
      layout: removeLayoutCard(currentLayout.layout, itemId)
    };
    applyLayoutChange(updatedLayout);
    showUndoToast('Card removed.');
  }, [applyLayoutChange, currentLayout, showUndoToast]);

  useEffect(() => {
    const handleHistoryShortcut = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      if (target?.matches?.('input, textarea, select, [contenteditable="true"]')) return;

      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoLayoutChange();
        else undoLayoutChange();
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redoLayoutChange();
      }
    };

    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [redoLayoutChange, undoLayoutChange]);

  const [showQualityPanel, setShowQualityPanel] = useState(false);
  const { exportFormat, setExportFormat, handleExportSnapshot, isLocalDataset } = useDatasetExport(selectedDataset, globalFilters || {});

  const handleGenerateReport = async () => {
    if (!settings.features.reports) {
      toast.error('Report generation is currently unavailable');
      return;
    }
    if (!selectedDataset?.rawRows?.length) {
      toast.error('Select a local dataset first to generate a report');
      return;
    }
    reportAbortRef.current?.abort();
    const controller = new AbortController();
    reportAbortRef.current = controller;
    const operation = startOperation('Generating report');
    operation.update('Capturing charts and analyzing the dataset…');
    let reportWindow;
    try {
      reportWindow = window.open('', '_blank');
      if (!reportWindow) throw new Error('Popup blocked — allow popups to generate the report.');
      const { generateDetailedReport } = await import('../utils/reportGenerator');
      if (controller.signal.aborted) throw new DOMException('Report cancelled.', 'AbortError');
      await generateDetailedReport(selectedDataset, { signal: controller.signal, reportWindow, scopeFilters: globalFilters || {},
        onProgress: ({ phase, scanned, total }) => operation.update(`${phase === 'statistics' ? 'Calculating exact statistics' : 'Checking report quality'}: ${scanned.toLocaleString()} of ${total.toLocaleString()} source rows`),
      });
      operation.succeed('Report opened. Choose Save as PDF in the print dialog.');
    } catch (err) {
      reportWindow?.close();
      if (err?.name === 'AbortError') operation.cancel();
      else operation.fail(err.message || 'Failed to generate report');
    } finally {
      if (reportAbortRef.current === controller) {
        reportAbortRef.current = null;
      }
    }
  };

  const activePalette = CHART_PALETTES.find((palette) => palette.value === chartPalette) || CHART_PALETTES[0];
  const liveDatasetSnapshot = isLocalActive ? null : (liveEnabled ? liveSnapshot : null);
  const effectiveStatus = isLocalActive ? 'local' : (liveEnabled ? liveStatus : 'paused');
  const liveStatusLabel = isLocalActive ? 'In-Browser' : formatLiveStatus(effectiveStatus);
  const workspaceError = analyticsError || (
    liveError && !isLocalActive
      ? describeApiError(liveError, 'Live updates are temporarily unavailable.').text
      : ''
  );
  const retryWorkspaceError = () => {
    if (analyticsError) {
      void fetchKpiData();
    } else {
      void refreshLiveSnapshot();
    }
  };
  const isSmartLayout = currentLayout?.source === 'planner';
  const smartPanels = currentLayout?.layout || DEFAULT_LAYOUT_ITEMS;
  const responsiveGridLayouts = useMemo(
    () => buildResponsiveLayouts(currentLayout?.layout || DEFAULT_LAYOUT_ITEMS),
    [currentLayout?.layout]
  );

  const smartMetricCards = [
    { label: 'Rows', value: kpiData.rows },
    { label: 'Columns', value: kpiData.columns },
    { label: 'Completeness', value: kpiData.completeness ?? liveDatasetSnapshot?.metrics?.completeness ?? null, suffix: '%' },
    { label: 'Missing', value: kpiData.missingValues },
  ];

  const renderMetricCard = (card) => <KpiCard key={card.label} title={card.label} value={card.value} loading={loading} format={card.suffix ? 'percentage' : 'number'} />;

  const renderDashboardEditor = () => isEditorOpen && (
    <Suspense fallback={<p role="status">Opening dashboard editor…</p>}>
      <DashboardEditorDrawer
        open
        returnFocusRef={editorReturnFocusRef}
        currentLayout={currentLayout}
        dataset={selectedDataset}
        onClose={() => setIsEditorOpen(false)}
        onAddGraph={handleAddGraph}
        onViewCard={focusDashboardCard}
        onConfigureCard={handleConfigureCard}
        onDuplicateCard={handleDuplicateCard}
        onResetCard={handleResetCard}
        onRemoveCard={handleRemoveCard}
        onMoveCard={handleReorderCard}
        onResizeCard={handleKeyboardResizeCard}
        onResetDashboard={handleResetDashboard}
        onSave={saveDashboardEditing}
        onCancel={cancelDashboardEditing}
      />
    </Suspense>
  );

  const renderWorkspaceControls = () => <DashboardToolbar
    dataset={selectedDataset} datasets={datasets} onDatasetChange={setSelectedDataset}
    onOpenFile={() => fileInputRef.current?.click()} fileInputRef={fileInputRef} onDirectFileOpen={handleDirectFileOpen}
    onQuality={() => setShowQualityPanel(true)} onReport={handleGenerateReport}
    exportFormat={exportFormat} onExportFormatChange={setExportFormat} onExport={() => handleExportSnapshot()}
    isLocalDataset={isLocalDataset} palette={chartPalette} onPaletteChange={setChartPalette}
    liveEnabled={liveEnabled} onLiveChange={() => setLiveEnabled(value => !value)} statusLabel={liveStatusLabel}
    onRefresh={() => refreshLiveSnapshot()} lastUpdated={lastUpdated} settings={settings} isDemo={isDemoDataset}
  ><LayoutSelector compact /><LayoutHistoryControls compact
    isEditing={isDashboardEditing}
    onOpenEditor={(event) => { editorReturnFocusRef.current = event.currentTarget; beginDashboardEditing(true); }}
    onDoneEditing={saveDashboardEditing} onCancelEditing={cancelDashboardEditing}
  /></DashboardToolbar>;

  const renderSmartDashboard = () => (
    <div className="workspace-page">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        {renderWorkspaceControls()}
        {selectedDataset?.folderId && <Suspense fallback={<p role="status">Loading folder overview…</p>}><FolderOverviewPanel dataset={selectedDataset} datasets={datasets} onSelect={setSelectedDataset} onUpdate={updateLocalDataset} loadSources={loadLocalDatasets} /></Suspense>}
        {selectedDataset && settings.features.dataAssistant && <AskDataAssistant compact dataset={selectedDataset} onCardAdded={focusDashboardCard} />}
        <FilterBar />

        {workspaceError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            <span>{workspaceError}</span>
            <button type="button" onClick={retryWorkspaceError} className="border border-rose-300 bg-white px-3 py-1.5 font-semibold hover:bg-rose-100">Retry</button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {smartMetricCards.map(renderMetricCard)}
        </div>

        <div className="min-w-0">
          <ResponsiveGridLayout
            className={`layout ${isDashboardEditing ? 'dashboard-grid-editing' : ''}`}
            layouts={responsiveGridLayouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={100}
            isDraggable={isDashboardEditing}
            isResizable={isDashboardEditing}
            draggableHandle=".drag-handle"
            onDragStop={isDashboardEditing ? handleGridLayoutChange : undefined}
            onResizeStop={isDashboardEditing ? handleGridLayoutChange : undefined}
            compactType="vertical"
            margin={[16, 16]}
            onBreakpointChange={setActiveGridBreakpoint}
          >
            {smartPanels.map((item) => (
              <div key={item.i} id={`dashboard-card-${item.i}`} className="min-w-0" tabIndex={-1}>
                <ChartPanel
                  id={item.i}
                  title={item.title}
                  chartType={item.chartType}
                  gridWidth={item.w}
                  gridHeight={item.h}
                  dataset={selectedDataset}
                  liveSnapshot={liveDatasetSnapshot}
                  liveStatus={effectiveStatus}
                  preferredX={item.preferredX}
                  preferredY={item.preferredY}
                  preferredZ={item.preferredZ}
                  preferredSize={item.preferredSize}
                  preferredColor={item.preferredColor}
                  preferredGroup={item.preferredGroup}
                  preferredOpen={item.preferredOpen}
                  preferredHigh={item.preferredHigh}
                  preferredLow={item.preferredLow}
                  dataScope={item.dataScope}
                  dataLimit={item.dataLimit}
                  dataPage={item.dataPage}
                  sortBy={item.sortBy}
                  sortOrder={item.sortOrder}
                  aggregation={item.aggregation}
                  topN={item.topN}
                  palette={activePalette.colors}
                  colorPalette={item.colorPalette}
                  seriesColor={item.seriesColor}
                  showLegend={item.showLegend}
                  showDataLabels={item.showDataLabels}
                  numberFormat={item.numberFormat}
                  decimalPlaces={item.decimalPlaces}
                  currency={item.currency}
                  variant="editorial"
                  showControls={isDashboardEditing}
                  isEditing={isDashboardEditing}
                  openConfigRequest={configurationRequest.id === item.i ? configurationRequest.version : 0}
                  onChartTypeChange={(type) => handleChartTypeChange(item.i, type)}
                  onConfigChange={(patch, options) => handleCardConfigChange(item.i, patch, options)}
                  onDuplicate={() => handleDuplicateCard(item.i)}
                  onReset={() => handleResetCard(item.i)}
                  onKeyboardMove={(deltaX, deltaY) => handleKeyboardMoveCard(item.i, deltaX, deltaY)}
                  onKeyboardResize={(deltaWidth, deltaHeight) => handleKeyboardResizeCard(item.i, deltaWidth, deltaHeight)}
                  onRemove={() => handleRemoveCard(item.i)}
                />
              </div>
            ))}
          </ResponsiveGridLayout>
        </div>

        <div className="data-preview-card">
          <DataTable
          dataset={selectedDataset}
          liveStatus={effectiveStatus}
          refreshSignal={liveDatasetSnapshot?.meta?.generatedAt}
          variant="editorial"
        />
        </div>
      </div>
      {showQualityPanel && selectedDataset && (
        <Suspense fallback={null}>
          <DataQualityPanel dataset={selectedDataset} onClose={() => setShowQualityPanel(false)} />
        </Suspense>
      )}
      {renderDashboardEditor()}
    </div>
  );

  return (
    isSmartLayout ? renderSmartDashboard() : (
    <div className="workspace-page">
      <div className="mx-auto w-full max-w-[1600px]">
      {renderWorkspaceControls()}
      <div className="mb-5 space-y-4">
        {selectedDataset?.folderId && <Suspense fallback={<p role="status">Loading folder overview…</p>}><FolderOverviewPanel dataset={selectedDataset} datasets={datasets} onSelect={setSelectedDataset} onUpdate={updateLocalDataset} loadSources={loadLocalDatasets} /></Suspense>}
        {selectedDataset && settings.features.dataAssistant && <AskDataAssistant compact dataset={selectedDataset} onCardAdded={focusDashboardCard} />}
        <FilterBar />
      </div>

      {/* KPI Cards */}
      {workspaceError && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800 shadow-xs">
          <span>{workspaceError}</span>
          <button type="button" onClick={retryWorkspaceError} className="border border-rose-300 bg-white px-3 py-1.5 font-semibold hover:bg-rose-100">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-6 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard 
          title="Rows" 
          value={kpiData.rows} 
          loading={loading}
          format="number"
        />
        <KpiCard 
          title="Columns" 
          value={kpiData.columns} 
          loading={loading}
          format="number"
        />
        <KpiCard 
          title="Numeric Fields" 
          value={kpiData.numericColumns} 
          format="number"
          loading={loading}
        />
        <KpiCard 
          title="Text Fields" 
          value={kpiData.categoricalColumns} 
          format="number"
          loading={loading}
        />
        <KpiCard 
          title="Missing Values" 
          value={kpiData.missingValues} 
          format="number"
          loading={loading}
        />
        <KpiCard 
          title="Primary Mean" 
          value={kpiData.primaryMean} 
          loading={loading}
        />
      </div>

      {/* Resizable Grid */}
      {currentLayout && (
        <ResponsiveGridLayout
          className={`layout ${isDashboardEditing ? 'dashboard-grid-editing' : ''}`}
          layouts={responsiveGridLayouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={100}
          onDragStop={handleGridLayoutChange}
          onResizeStop={handleGridLayoutChange}
          onBreakpointChange={setActiveGridBreakpoint}
          isDraggable={isDashboardEditing}
          isResizable={isDashboardEditing}
          draggableHandle=".drag-handle"
        >
          {(currentLayout.layout || DEFAULT_LAYOUT_ITEMS).map((item) => (
          <div key={item.i} id={`dashboard-card-${item.i}`} className="min-w-0" tabIndex={-1}>
              <ChartPanel
                id={item.i}
                title={item.title}
                chartType={item.chartType}
                gridWidth={item.w}
                gridHeight={item.h}
                dataset={selectedDataset}
                liveSnapshot={liveDatasetSnapshot}
                liveStatus={liveEnabled ? liveStatus : 'paused'}
                preferredX={item.preferredX}
                preferredY={item.preferredY}
                preferredZ={item.preferredZ}
                preferredSize={item.preferredSize}
                preferredColor={item.preferredColor}
                preferredGroup={item.preferredGroup}
                preferredOpen={item.preferredOpen}
                preferredHigh={item.preferredHigh}
                preferredLow={item.preferredLow}
                dataScope={item.dataScope}
                dataLimit={item.dataLimit}
                dataPage={item.dataPage}
                sortBy={item.sortBy}
                sortOrder={item.sortOrder}
                aggregation={item.aggregation}
                topN={item.topN}
                palette={activePalette.colors}
                colorPalette={item.colorPalette}
                seriesColor={item.seriesColor}
                showLegend={item.showLegend}
                showDataLabels={item.showDataLabels}
                numberFormat={item.numberFormat}
                decimalPlaces={item.decimalPlaces}
                currency={item.currency}
                isEditing={isDashboardEditing}
                openConfigRequest={configurationRequest.id === item.i ? configurationRequest.version : 0}
                onChartTypeChange={(type) => handleChartTypeChange(item.i, type)}
                onConfigChange={(patch, options) => handleCardConfigChange(item.i, patch, options)}
                onDuplicate={() => handleDuplicateCard(item.i)}
                onReset={() => handleResetCard(item.i)}
                onKeyboardMove={(deltaX, deltaY) => handleKeyboardMoveCard(item.i, deltaX, deltaY)}
                onKeyboardResize={(deltaWidth, deltaHeight) => handleKeyboardResizeCard(item.i, deltaWidth, deltaHeight)}
                onRemove={() => handleRemoveCard(item.i)}
              />
            </div>
          ))}
        </ResponsiveGridLayout>
      )}

      {/* Data Table */}
      <div className="data-preview-card mt-6">
        <DataTable
          dataset={selectedDataset}
          liveStatus={effectiveStatus}
          refreshSignal={liveDatasetSnapshot?.meta?.generatedAt}
          variant="default"
        />
      </div>
      {showQualityPanel && selectedDataset && (
        <Suspense fallback={null}>
          <DataQualityPanel dataset={selectedDataset} onClose={() => setShowQualityPanel(false)} />
        </Suspense>
      )}
      {renderDashboardEditor()}
      </div>
    </div>
    )
  );
}

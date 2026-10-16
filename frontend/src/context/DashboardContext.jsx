import useDatasetSelection from '../hooks/useDatasetSelection';
import useLayoutEditing from '../hooks/useLayoutEditing';
import { createContext, useState, useContext, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import api from '../services/api';
import { SERVER_WORKSPACE_ENABLED, requireServerWorkspace } from '../config/workspace';
import toast from 'react-hot-toast';
import {
  SAMPLE_DATASETS,
  filterAndPaginateLocalData,
  planLocalSmartLayout,
  computeDatasetMetrics
} from '../utils/localDataEngine';
import useLocalDatasetCatalog from '../hooks/useLocalDatasetCatalog';
import { describeApiError, reportExpectedDegradation } from '../utils/apiError';
import {
  DEFAULT_LAYOUT_ITEMS,
  normalizeLayoutItem,
  normalizeLayoutItems
} from '../utils/layoutModel';
import {
  createClientLayoutId,
  createSerialTaskQueue,
  resolveServerLayoutId
} from '../utils/layoutPersistence';
import { createLayoutHistory } from '../utils/layoutHistory';
import { readGuestLayoutState, loadGuestLayoutState, saveGuestLayoutState, subscribeGuestLayoutChanges } from '../utils/guestLayoutStore';

const DashboardContext = createContext();

const readDefaultLayoutId = () => {
  try {
    return localStorage.getItem('dashboard-default-layout-id') || '';
  } catch {
    return '';
  }
};

// Keep this aligned with the server-side `/datasets` validation limit. The
// dashboard currently loads the complete permitted page; pagination can be
// introduced here later without changing the API contract.
export const SERVER_DATASET_PAGE_SIZE = 100;

export { DEFAULT_LAYOUT_ITEMS, normalizeLayoutItem, normalizeLayoutItems };

export const useDashboard = () => {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within DashboardProvider');
  }
  return context;
};

export const DashboardProvider = ({ children }) => {
  const { isAuthenticated: authenticatedSession } = useAuth();
  const isAuthenticated = SERVER_WORKSPACE_ENABLED && authenticatedSession;
  const [layouts, setLayouts] = useState([]);
  const layoutsRef = useRef(layouts);
  const [defaultLayoutId, setDefaultLayoutIdState] = useState(readDefaultLayoutId);
  const [guestLayoutsReady, setGuestLayoutsReady] = useState(false);
  const guestRevisionRef = useRef(null);
  const guestEpochRef = useRef(0);
  const guestPendingRef = useRef(0);
  const guestQueueRef = useRef(createSerialTaskQueue());
  const guestConflictRef = useRef(null);
  const [layoutConflict, setLayoutConflict] = useState(null);
  
  const [serverDatasets, setServerDatasets] = useState([]);
  const selectDatasetRef = useRef(null);
  const handleLocalDatasetRestore = useCallback((restoredDatasets) => {
    selectDatasetRef.current?.((current) => (
      restoredDatasets.find((dataset) => dataset.id === current?.id)
        || restoredDatasets.find((dataset) => dataset.id === currentLayoutRef.current?.sourceDatasetId)
          || restoredDatasets.find((dataset) => dataset.isFolderOverview)
          || restoredDatasets[0]
    ));
  }, []);
  const handleDiscardedLegacyDatasets = useCallback((discardedCount) => {
    toast.error(`${discardedCount} partial local dataset${discardedCount === 1 ? '' : 's'} could not be restored. Please import the original file again.`);
  }, []);
  const handleLocalPersistenceError = useCallback((error, phase = 'save') => {
    reportExpectedDegradation(
      phase === 'restore'
        ? 'Local datasets could not be restored from IndexedDB.'
        : phase === 'storage'
          ? 'Browser storage usage could not be inspected.'
          : 'Local datasets could not be persisted to IndexedDB.',
      error
    );
    if (phase === 'save') toast.error(error.code === 'DATASET_CONFLICT' ? error.message : 'Local changes could not be saved in this browser.');
  }, []);
  const handleLocalStoragePressure = useCallback(() => {
    toast.error('Browser storage is almost full. Remove unused local datasets or export them before continuing.');
  }, []);
  const {
    localDatasets,
    addLocalDatasetRecord,
    addLocalDatasetRecords,
    updateLocalDatasetRecord,
    commitLocalDatasetRecord,
    removeLocalDatasetRecord,
    loadLocalDatasetRecord,
    retainLocalDatasetRecord,
    localSaveConflicts,
    reloadSavedLocalDataset,
    preserveLocalDatasetCopy
  } = useLocalDatasetCatalog({
    initialDatasets: SAMPLE_DATASETS,
    onRestore: handleLocalDatasetRestore,
    onDiscardedLegacy: handleDiscardedLegacyDatasets,
    onPersistenceError: handleLocalPersistenceError,
    onStoragePressure: handleLocalStoragePressure
  });
  const { selectedDataset, selectedDatasetRef, setSelectedDataset, datasetLoadState } = useDatasetSelection({
    initialDataset: SAMPLE_DATASETS[0], loadLocalDatasetRecord, retainLocalDatasetRecord
  });
  selectDatasetRef.current = setSelectedDataset;
  const loadLocalDatasets = useCallback((sources) => Promise.all(sources.map((source) =>
    loadLocalDatasetRecord(typeof source === 'string' ? source : source.id))), [loadLocalDatasetRecord]);
  const [loading, setLoading] = useState(false);
  const [globalFilters, setGlobalFilters] = useState({});
  const layoutSaveQueueRef = useRef(null);
  const persistedLayoutIdsRef = useRef(new Set());
  const layoutIdAliasesRef = useRef(new Map());
  const layoutServerVersionsRef = useRef(new Map());
  const layoutSaveVersionsRef = useRef(new Map());
  const layoutEditVersionRef = useRef(0);
  const layoutAutosaveTimeoutRef = useRef(null);
  const layoutEditSessionRef = useRef(null);

  if (!layoutSaveQueueRef.current) {
    layoutSaveQueueRef.current = createSerialTaskQueue();
  }

  useEffect(() => {
    layoutsRef.current = layouts;
  }, [layouts]);

  const [currentLayout, setCurrentLayoutState] = useState(() => {
    try {
      const guestState = readGuestLayoutState();
      const selected = guestState?.layouts.find(({ id }) => id === guestState.selectedId);
      if (selected?.layout.length) {
        return { ...selected, layout: normalizeLayoutItems(selected.layout) };
      }
    } catch (error) {
      reportExpectedDegradation('Saved dashboard layout could not be restored.', error);
    }

    const initDs = SAMPLE_DATASETS[0];
    const planned = planLocalSmartLayout(initDs.id, initDs.metrics?.columnGroups || {});
    return {
      id: `layout_${initDs.id}`,
      name: `${initDs.name} Smart Layout`,
      source: 'planner',
      localOnly: true,
      sourceDatasetId: initDs.id,
      layout: normalizeLayoutItems(planned)
    };
  });
  const currentLayoutRef = useRef(currentLayout);
  const lastSavedLayoutRef = useRef(currentLayout);
  const layoutHistoryRef = useRef(null);
  if (!layoutHistoryRef.current) {
    layoutHistoryRef.current = createLayoutHistory(currentLayout);
  }
  const [layoutHistoryState, setLayoutHistoryState] = useState(() => (
    layoutHistoryRef.current.snapshot()
  ));
  const [layoutPersistenceState, setLayoutPersistenceState] = useState({
    status: 'idle',
    error: '',
    lastSavedAt: null
  });
  const layoutStatusRef = useRef(layoutPersistenceState.status);
  layoutStatusRef.current = layoutPersistenceState.status;
  const persistGuestLayouts = useCallback((state) => {
    const epoch = guestEpochRef.current; guestPendingRef.current += 1;
    return guestQueueRef.current(async () => {
      if (epoch !== guestEpochRef.current) throw new DOMException('Old layout save discarded.', 'AbortError');
      if (guestConflictRef.current) throw guestConflictRef.current.error;
      try {
        if (guestRevisionRef.current === null) guestRevisionRef.current = (await loadGuestLayoutState()).revision;
        const saved = await saveGuestLayoutState(state, { expectedRevision: guestRevisionRef.current });
        guestRevisionRef.current = saved.revision; return saved;
      } catch (error) {
        if (epoch === guestEpochRef.current) {
          if (error.code === 'LAYOUT_CONFLICT') { const conflict = { draft: state, error }; guestConflictRef.current = conflict; setLayoutConflict(conflict); }
          setLayoutPersistenceState((previous) => ({ ...previous, status: 'error', error: error.message }));
        }
        throw error;
      }
    }).finally(() => { guestPendingRef.current -= 1; });
  }, []);

  const setCurrentLayout = useCallback((nextLayoutOrUpdater) => {
    const nextLayout = typeof nextLayoutOrUpdater === 'function'
      ? nextLayoutOrUpdater(currentLayoutRef.current)
      : nextLayoutOrUpdater;
    currentLayoutRef.current = nextLayout;
    layoutHistoryRef.current.replace(nextLayout);
    setCurrentLayoutState(nextLayout);
    return nextLayout;
  }, []);

  const syncLayoutHistoryState = useCallback((snapshot) => {
    setLayoutHistoryState({
      canUndo: snapshot.canUndo,
      canRedo: snapshot.canRedo,
      present: snapshot.present
    });
  }, []);

  const cancelScheduledLayoutSave = useCallback(() => {
    if (layoutAutosaveTimeoutRef.current) {
      window.clearTimeout(layoutAutosaveTimeoutRef.current);
      layoutAutosaveTimeoutRef.current = null;
    }
  }, []);

  const selectLayout = useCallback((nextLayout) => {
    if (!nextLayout) return null;
    cancelScheduledLayoutSave();
    layoutEditSessionRef.current = null;
    layoutEditVersionRef.current += 1;
    const normalizedLayout = {
      ...nextLayout,
      layout: normalizeLayoutItems(nextLayout.layout || DEFAULT_LAYOUT_ITEMS)
    };
    currentLayoutRef.current = normalizedLayout;
    lastSavedLayoutRef.current = normalizedLayout;
    syncLayoutHistoryState(layoutHistoryRef.current.reset(normalizedLayout));
    setCurrentLayoutState(normalizedLayout);
    setLayoutPersistenceState({ status: 'idle', error: '', lastSavedAt: null });
    return normalizedLayout;
  }, [cancelScheduledLayoutSave, syncLayoutHistoryState]);

  const hasUnsavedLayoutChanges = ['dirty', 'saving', 'error'].includes(layoutPersistenceState.status);

  const discardPendingLayoutChanges = useCallback(() => {
    if (layoutPersistenceState.status === 'saving') return false;
    cancelScheduledLayoutSave();
    layoutEditVersionRef.current += 1;
    const savedLayout = lastSavedLayoutRef.current;
    if (savedLayout) {
      currentLayoutRef.current = savedLayout;
      syncLayoutHistoryState(layoutHistoryRef.current.reset(savedLayout));
      setCurrentLayoutState(savedLayout);
    }
    setLayoutPersistenceState({ status: 'idle', error: '', lastSavedAt: null });
    return true;
  }, [cancelScheduledLayoutSave, layoutPersistenceState.status, syncLayoutHistoryState]);

  const confirmDiscardLayoutChanges = useCallback(() => {
    if (layoutPersistenceState.status === 'saving') {
      toast.error('A dashboard save is in progress. Please wait before leaving.');
      return false;
    }
    if (!['dirty', 'error'].includes(layoutPersistenceState.status)) return true;
    if (!window.confirm('Discard unsaved dashboard changes?')) return false;
    return discardPendingLayoutChanges();
  }, [discardPendingLayoutChanges, layoutPersistenceState.status]);

  useEffect(() => {
    if (!hasUnsavedLayoutChanges) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedLayoutChanges]);

  useEffect(() => () => cancelScheduledLayoutSave(), [cancelScheduledLayoutSave]);

  // Stable callbacks: consumers (charts, tables, chat) re-render whenever any
  // of these identities change, so they must be referentially stable.
  const setGlobalFilter = useCallback((column, value) => {
    if (!column) return;
    setGlobalFilters((prev) => {
      if (prev[column] === value) {
        const next = { ...prev };
        delete next[column];
        return next;
      }
      return { ...prev, [column]: value };
    });
  }, []);

  const removeGlobalFilter = useCallback((column) => {
    setGlobalFilters((prev) => {
      const next = { ...prev };
      delete next[column];
      return next;
    });
  }, []);

  const clearGlobalFilters = useCallback(() => {
    setGlobalFilters({});
  }, []);

  // Combined dataset list: local datasets first, then any server datasets
  const datasets = useMemo(() => {
    return [...localDatasets, ...serverDatasets];
  }, [localDatasets, serverDatasets]);

  const addLocalDataset = useCallback((dataset) => {
    addLocalDatasetRecord(dataset);
    setSelectedDataset(dataset);
    clearGlobalFilters();

    // Automatically plan smart layout for this dataset
    if (dataset.metrics?.columnGroups) {
      const planned = planLocalSmartLayout(dataset.id, dataset.metrics.columnGroups);
      const newLayout = {
        id: `layout_${dataset.id}`,
        name: `${dataset.name} Layout`,
        source: 'planner',
        localOnly: true,
        sourceDatasetId: dataset.id,
        layout: normalizeLayoutItems(planned)
      };
      selectLayout(newLayout);
    }
  }, [addLocalDatasetRecord, clearGlobalFilters, selectLayout]);

  const addLocalDatasets = useCallback((newDatasets, selected = newDatasets[0], { persisted = false } = {}) => {
    if (!newDatasets.length || !selected) return;
    addLocalDatasetRecords(newDatasets, { persisted });
    setSelectedDataset(selected);
    clearGlobalFilters();
    if (selected.metrics?.columnGroups) {
      selectLayout({
        id: `layout_${selected.id}`,
        name: `${selected.name} Layout`,
        source: 'planner',
        localOnly: true,
        sourceDatasetId: selected.id,
        layout: normalizeLayoutItems(planLocalSmartLayout(selected.id, selected.metrics.columnGroups)),
      });
    }
  }, [addLocalDatasetRecords, clearGlobalFilters, selectLayout]);

  const restoreLocalWorkspace = useCallback(async ({ dataset, datasets: backupDatasets, layout, layouts: backupLayouts, filters, persisted = false }) => {
    const restoredDatasets = backupDatasets?.length ? backupDatasets : [dataset];
    const restoredLayouts = (backupLayouts?.length ? backupLayouts : [layout]).map((item) => ({
      ...item,
      localOnly: true,
      sourceDatasetId: item.id === layout.id ? dataset.id : item.sourceDatasetId,
      layout: normalizeLayoutItems(item.layout)
    }));
    const restoredLayout = restoredLayouts.find((item) => item.id === layout.id);
    if (backupDatasets?.length || persisted) addLocalDatasetRecords(restoredDatasets, { persisted });
    else addLocalDatasetRecord(dataset);
    setSelectedDataset(dataset);
    setGlobalFilters(filters);
    const restoredIds = new Set(restoredLayouts.map((item) => item.id));
    const nextLayouts = [...layoutsRef.current.filter((item) => !restoredIds.has(item.id)), ...restoredLayouts];
    layoutsRef.current = nextLayouts;
    setLayouts(nextLayouts);
    selectLayout(restoredLayout);
    try {
      await persistGuestLayouts({
        layouts: nextLayouts.filter((item) => item.localOnly),
        selectedId: restoredLayout.id,
        defaultId: defaultLayoutId
      });
    } catch (error) {
      reportExpectedDegradation('Restored layout could not be saved in this browser.', error);
    }
  }, [addLocalDatasetRecord, addLocalDatasetRecords, defaultLayoutId, selectLayout]);

  const removeLocalDataset = useCallback(async (id) => {
    const remaining = localDatasets.filter((dataset) => dataset.id !== id);
    if (!await removeLocalDatasetRecord(id)) return;
    if (selectedDatasetRef.current?.id === id) {
      setSelectedDataset(null);
      setSelectedDataset(remaining[0] || serverDatasets[0] || null);
    }
    void import('../utils/localAI/client').then(({ clearMemoryEvidence }) => clearMemoryEvidence());
    void import('../utils/localAI/runtime').then(({ stopLocalModels }) => stopLocalModels());
    void import('../utils/aiQueryClient').then(({ cancelAssistantWork }) => cancelAssistantWork());
    // Remove layouts and reviewed relationships that reference the deleted source.
    const nextLayouts = layoutsRef.current.filter((layout) => layout.sourceDatasetId !== id);
    layoutsRef.current = nextLayouts;
    setLayouts(nextLayouts);
    if (currentLayoutRef.current?.sourceDatasetId === id) selectLayout(nextLayouts[0] || {
      id: `layout_empty_${Date.now()}`, name: 'New workspace', localOnly: true, sourceDatasetId: remaining[0]?.id || null, layout: []
    });
    try { await persistGuestLayouts({ layouts: nextLayouts.filter((layout) => layout.localOnly), selectedId: currentLayoutRef.current?.id || '',
      defaultId: defaultLayoutId }); }
    catch (error) { reportExpectedDegradation('Dataset deleted, but layout cleanup could not be saved.', error); }
    for (const source of remaining) {
      if (source.relationships?.some((edge) => edge.leftDatasetId === id || edge.rightDatasetId === id)) {
        try {
          const loaded = await loadLocalDatasetRecord(source.id);
          updateLocalDatasetRecord({ ...loaded, relationships: loaded.relationships.filter((edge) => edge.leftDatasetId !== id && edge.rightDatasetId !== id) });
        } catch (error) {
          reportExpectedDegradation('Dataset removed, but relationship cleanup could not be saved.', error);
          toast.error('Some relationship cleanup could not be saved. Reload the workspace.');
        }
      }
    }
  }, [localDatasets, removeLocalDatasetRecord, selectedDataset?.id, serverDatasets, selectLayout, defaultLayoutId, updateLocalDatasetRecord, loadLocalDatasetRecord, setSelectedDataset]);

  /** Replace an existing local dataset (e.g. after cleaning/preprocessing). */
  const overviewUpdateQueueRef = useRef(Promise.resolve());
  const updateLocalDataset = useCallback((updatedDataset, { persisted = false } = {}) => {
    if (!updatedDataset?.id) return;
    if (!persisted) updateLocalDatasetRecord(updatedDataset);
    if (updatedDataset.folderId && !updatedDataset.isFolderOverview) {
      const overview = localDatasets.find((item) => item.folderId === updatedDataset.folderId && item.isFolderOverview);
      if (overview) {
        overviewUpdateQueueRef.current = overviewUpdateQueueRef.current.then(async () => {
          const loadedOverview = await loadLocalDatasetRecord(overview.id);
          const sourceMetrics = updatedDataset.metrics || computeDatasetMetrics(
            updatedDataset.rawRows, updatedDataset.columns.map(({ name }) => name)
          );
          const rawRows = loadedOverview.rawRows.map((row) => (
            row.Source === updatedDataset.sourcePath && row.Worksheet === (updatedDataset.sheetName || '')
              ? {
                ...row,
                Rows: updatedDataset.rowCount,
                Columns: updatedDataset.columns.length,
                'Missing cells': sourceMetrics.missingValues,
                'Completeness %': sourceMetrics.completeness,
              }
              : row
          ));
          const columnNames = loadedOverview.columns.map(({ name }) => name);
          const updatedOverview = {
            ...loadedOverview,
            rawRows,
            relationships: (loadedOverview.relationships || []).map((relationship) => (
              relationship.leftDatasetId === updatedDataset.id || relationship.rightDatasetId === updatedDataset.id
                ? { ...relationship, status: 'needs_review' }
                : relationship
            )),
            metrics: computeDatasetMetrics(rawRows, columnNames),
            totalSourceRows: rawRows.reduce((sum, row) => sum + Number(row.Rows || 0), 0),
            updatedAt: new Date().toISOString(),
          };
          updateLocalDatasetRecord(updatedOverview);
          setSelectedDataset((current) => current?.id === overview.id ? updatedOverview : current);
        }).catch((error) => handleLocalPersistenceError(error));
      }
    }
    setSelectedDataset((prev) => (prev?.id === updatedDataset.id ? updatedDataset : prev));
    return overviewUpdateQueueRef.current;
  }, [localDatasets, updateLocalDatasetRecord, loadLocalDatasetRecord, setSelectedDataset, handleLocalPersistenceError]);

  const getLocalData = useCallback((datasetId, { page = 1, limit = 50, sort = null, order = 'asc', filters = {} } = {}) => {
    const ds = selectedDataset?.id === datasetId ? selectedDataset : localDatasets.find((d) => d.id === datasetId);
    if (!ds || !ds.rawRows) return { data: [], total: 0, page: 1, limit };
    const combinedFilters = { ...globalFilters, ...filters };
    return filterAndPaginateLocalData(ds.rawRows, { page, limit, sort, order, filters: combinedFilters });
  }, [localDatasets, globalFilters, selectedDataset]);

  const commitLocalDataset = useCallback(async (dataset, options) => {
    await commitLocalDatasetRecord(dataset, options);
    // Publish to selection/collection summaries only after IndexedDB commits.
    await updateLocalDataset(dataset, { persisted: true });
    return dataset;
  }, [commitLocalDatasetRecord, updateLocalDataset]);

  const createDefaultLayout = useCallback(async () => {
    const defaultObj = {
      id: 'default_guest_layout',
      name: 'Default Layout',
      localOnly: true,
      layout: DEFAULT_LAYOUT_ITEMS
    };

    if (isAuthenticated && !selectedDataset?.isLocal && !selectedDataset?.rawRows) {
      try {
        const { data } = await api.post('/layouts', {
          name: 'Default Layout',
          layout: DEFAULT_LAYOUT_ITEMS
        });
        const normalized = {
          ...data,
          version: Number.isInteger(data.version) ? data.version : 1,
          layout: normalizeLayoutItems(data.layout)
        };
        persistedLayoutIdsRef.current.add(normalized.id);
        layoutServerVersionsRef.current.set(normalized.id, normalized.version);
        setLayouts([normalized]);
        selectLayout(normalized);
        return normalized;
      } catch (error) {
        toast.error(describeApiError(error, 'Could not create the default server layout.').text);
      }
    }

    setLayouts([defaultObj]);
    selectLayout(defaultObj);
    return defaultObj;
  }, [isAuthenticated, selectedDataset?.isLocal, selectedDataset?.rawRows, selectLayout]);

  useEffect(() => {
    if (isAuthenticated) {
      setGuestLayoutsReady(false);
      fetchLayouts();
      fetchDatasets();
    } else {
      let cancelled = false;
      setGuestLayoutsReady(false);
      void loadGuestLayoutState().then((guestState) => {
        if (cancelled) return;
        guestRevisionRef.current = guestState.revision;
        if (guestState.layouts.length) {
          const normalizedLayouts = guestState.layouts.map((layout) => ({
            ...layout,
            layout: normalizeLayoutItems(layout.layout || DEFAULT_LAYOUT_ITEMS)
          }));
          setLayouts(normalizedLayouts);
          setDefaultLayoutIdState(guestState.defaultId);
          selectLayout(normalizedLayouts.find(({ id }) => id === guestState.selectedId) || normalizedLayouts[0]);
          setGuestLayoutsReady(true);
          return;
        }
      const guestDefault = {
        id: 'local_default_layout',
        name: 'Default Layout',
        source: 'planner',
        localOnly: true,
        sourceDatasetId: SAMPLE_DATASETS[0].id,
        layout: normalizeLayoutItems(planLocalSmartLayout(SAMPLE_DATASETS[0].id, SAMPLE_DATASETS[0].metrics.columnGroups))
      };
      setLayouts([guestDefault]);
      setDefaultLayoutIdState('');
      selectLayout(guestDefault);
      setGuestLayoutsReady(true);
      }).catch((error) => {
        if (!cancelled) setLayoutPersistenceState((previous) => ({ ...previous, status: 'error', error: error.message }));
        reportExpectedDegradation('Saved guest layout could not be restored.', error);
      });
      return () => { cancelled = true; };
    }
  }, [isAuthenticated, selectLayout]);

  useEffect(() => {
    if ((!isAuthenticated && !guestLayoutsReady) || !layouts.length) return;
    if (isAuthenticated && !currentLayout?.localOnly) return;
    void persistGuestLayouts({
        layouts: isAuthenticated ? layouts.filter((layout) => layout.localOnly) : layouts,
        selectedId: currentLayout?.id,
        defaultId: defaultLayoutId
      }).catch((error) => {
      reportExpectedDegradation('Guest layouts could not be saved in this browser.', error);
      });
  }, [isAuthenticated, guestLayoutsReady, layouts, currentLayout?.id, defaultLayoutId, persistGuestLayouts]);

  useEffect(() => {
    if (isAuthenticated || !guestLayoutsReady) return undefined;
    let cancelled = false;
    const unsubscribe = subscribeGuestLayoutChanges(() => {
      void loadGuestLayoutState().then((saved) => {
        if (cancelled || saved.revision === guestRevisionRef.current) return;
        if (guestPendingRef.current || layoutEditSessionRef.current || ['dirty', 'saving', 'error'].includes(layoutStatusRef.current)) {
          const error = new Error('Another tab changed the saved layouts. Reload saved layouts or keep your draft as a copy.'); error.code = 'LAYOUT_CONFLICT';
          const conflict = { draft: { layouts: layoutsRef.current, selectedId: currentLayoutRef.current?.id, defaultId: defaultLayoutId }, error };
          guestConflictRef.current = conflict; setLayoutConflict(conflict); cancelScheduledLayoutSave();
          setLayoutPersistenceState((previous) => ({ ...previous, status: 'error', error: error.message })); return;
        }
        guestRevisionRef.current = saved.revision; guestEpochRef.current += 1;
        layoutsRef.current = saved.layouts; setLayouts(saved.layouts); setDefaultLayoutIdState(saved.defaultId);
        // Adopt the canonical selection too. Keeping this tab's old selection
        // would echo it back through persistence and undo another tab's copy.
        const selected = saved.layouts.find((layout) => layout.id === saved.selectedId) || saved.layouts[0];
        selectLayout(selected || { id: createClientLayoutId(), name: 'New workspace', localOnly: true, layout: normalizeLayoutItems(DEFAULT_LAYOUT_ITEMS) });
      }).catch((error) => reportExpectedDegradation('Other-tab layout changes could not be read.', error));
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [isAuthenticated, guestLayoutsReady, defaultLayoutId, selectLayout, cancelScheduledLayoutSave]);

  const fetchLayouts = useCallback(async () => {
    if (!SERVER_WORKSPACE_ENABLED) return;
    try {
      const { data } = await api.get('/layouts');
      const localLayouts = (readGuestLayoutState()?.layouts || []).map((layout) => ({
        ...layout,
        localOnly: true,
        layout: normalizeLayoutItems(layout.layout || DEFAULT_LAYOUT_ITEMS)
      }));
      const localLayoutMap = new Map(localLayouts.map((layout) => [layout.id, layout]));
      layoutsRef.current.filter((layout) => layout.localOnly).forEach((layout) => localLayoutMap.set(layout.id, layout));
      if (data.length === 0 && localLayoutMap.size === 0) {
        await createDefaultLayout();
        return;
      }

      const serverLayouts = data.map((layout) => ({
        ...layout,
        version: Number.isInteger(layout.version) ? layout.version : 1,
        layout: normalizeLayoutItems(layout.layout)
      }));

      persistedLayoutIdsRef.current = new Set(serverLayouts.map(({ id }) => id));
      layoutServerVersionsRef.current = new Map(serverLayouts.map(({ id, version }) => [id, version]));
      const normalizedLayouts = [...localLayoutMap.values(), ...serverLayouts];
      setLayouts(normalizedLayouts);
      const previousLayout = currentLayoutRef.current;
      selectLayout(
        normalizedLayouts.find((layout) => layout.localOnly && layout.id === previousLayout?.id) ||
        normalizedLayouts.find((layout) => layout.id === defaultLayoutId) ||
        normalizedLayouts.find((layout) => layout.id === previousLayout?.id) ||
        normalizedLayouts[0]
      );
    } catch (error) {
      if (error.response?.status === 404) return;
      toast.error(describeApiError(error, 'Failed to load saved layouts.').text);
    }
  }, [createDefaultLayout, defaultLayoutId, selectLayout]);

  const fetchDatasets = useCallback(async () => {
    if (!SERVER_WORKSPACE_ENABLED) return;
    try {
      const { data } = await api.get('/datasets', { params: { limit: SERVER_DATASET_PAGE_SIZE } });
      setServerDatasets(data.datasets);
    } catch (error) {
      setServerDatasets([]);
      toast.error(describeApiError(error, 'Failed to load server datasets.').text);
    }
  }, []);

  const generateSmartLayout = useCallback(async (datasetId) => {
    const candidate = localDatasets.find((d) => d.id === datasetId);
    const localDs = candidate?.metrics?.columnGroups ? candidate : candidate ? await loadLocalDatasetRecord(datasetId, { workingOnly: true }) : null;
    if (localDs) {
      const source = selectedDataset?.id === datasetId ? selectedDataset : localDs;
      const [{ getDatasetColumnGroups }, { profileDashboardPlanning }] = await Promise.all([
        import('../utils/graphConfiguration'), import('../utils/dashboardPlanningProfile')
      ]);
      const groups = profileDashboardPlanning(source, getDatasetColumnGroups(source));
      const smartItems = planLocalSmartLayout(datasetId, groups);
      return {
        id: `layout_${datasetId}`,
        name: `${localDs.name} Smart Layout`,
        source: 'planner',
        localOnly: true,
        sourceDatasetId: datasetId,
        layout: normalizeLayoutItems(smartItems)
      };
    }

    requireServerWorkspace();
    const { data } = await api.get(`/datasets/${datasetId}/layout-plan`);
    return {
      ...data,
      layout: normalizeLayoutItems(data.layout)
    };
  }, [localDatasets, loadLocalDatasetRecord, selectedDataset]);

  const resetToDefaultLayout = useCallback(async () => {
    const defaultLayout = layouts.find((layout) => layout.name === 'Default Layout' && !layout.source);
    if (defaultLayout) {
      selectLayout(defaultLayout);
      return defaultLayout;
    }
    return createDefaultLayout();
  }, [layouts, createDefaultLayout, selectLayout]);

  const saveLayout = useCallback(async (layout) => {
    const { getDatasetColumnGroups, repairGraphConfiguration, validateGraphConfiguration } = await import('../utils/graphConfiguration');
    const sourceServerLayoutId = resolveServerLayoutId(
      layout.id,
      persistedLayoutIdsRef.current,
      layoutIdAliasesRef.current
    );
    const isLocalDataset = Boolean(selectedDataset?.isLocal || selectedDataset?.rawRows);
    const copyServerLayoutLocally = Boolean(isLocalDataset && sourceServerLayoutId && !layout.localOnly);
    const isNewLayout = !layout.id || copyServerLayoutLocally;
    const logicalLayoutId = isNewLayout ? createClientLayoutId() : layout.id;
    const knownServerLayoutId = copyServerLayoutLocally ? null : sourceServerLayoutId;
    const revisionKey = knownServerLayoutId || logicalLayoutId;
    const normalizedItems = normalizeLayoutItems(layout.layout || DEFAULT_LAYOUT_ITEMS);
    const datasetColumnGroups = getDatasetColumnGroups(selectedDataset);
    const selectorFields = [
      'preferredX', 'preferredY', 'preferredZ', 'preferredSize', 'preferredColor',
      'preferredGroup', 'preferredOpen', 'preferredHigh', 'preferredLow'
    ];
    // Older/default layouts intentionally omitted mappings. Complete only
    // missing fields at the persistence boundary; preserve explicit values so
    // stale or contradictory user configuration is still rejected below.
    const completedItems = normalizedItems.map((item) => {
      const repaired = repairGraphConfiguration(item, datasetColumnGroups);
      return selectorFields.reduce((completed, field) => ({
        ...completed,
        [field]: item[field] || repaired[field] || ''
      }), { ...item });
    });
    const normalizedLayout = {
      ...layout,
      id: logicalLayoutId,
      localOnly: Boolean(layout.localOnly || isLocalDataset),
      layout: completedItems
    };
    const invalidGraph = normalizedLayout.layout.find((item) => (
      !validateGraphConfiguration(item, datasetColumnGroups).valid
    ));
    if (invalidGraph) {
      const validation = validateGraphConfiguration(invalidGraph, datasetColumnGroups);
      const errorMessage = `${invalidGraph.title} cannot be saved: ${validation.issues.join(' ')}`;
      setLayoutPersistenceState((current) => ({ ...current, status: 'error', error: errorMessage }));
      toast.error(errorMessage);
      return normalizedLayout;
    }
    const revision = (layoutSaveVersionsRef.current.get(revisionKey) || 0) + 1;
    layoutSaveVersionsRef.current.set(revisionKey, revision);

    // Save to local storage for guests or offline sessions
    try {
      localStorage.setItem('local_dashboard_layout', JSON.stringify(normalizedLayout));
    } catch (error) {
      reportExpectedDegradation('Layout could not be cached in localStorage.', error);
    }

    if (isNewLayout) selectLayout(normalizedLayout);
    else setCurrentLayout(normalizedLayout);
    const editVersion = layoutEditVersionRef.current;
    setLayoutPersistenceState((current) => ({ ...current, status: 'dirty', error: '' }));

    if (!isAuthenticated || normalizedLayout.localOnly) {
      const nextLayouts = [...layoutsRef.current];
      const existingIndex = nextLayouts.findIndex(({ id }) => id === normalizedLayout.id);
      if (existingIndex < 0) nextLayouts.push(normalizedLayout);
      else {
        nextLayouts[existingIndex] = normalizedLayout;
      }
      layoutsRef.current = nextLayouts;
      setLayouts(nextLayouts);
      try {
        await persistGuestLayouts({
          layouts: isAuthenticated ? nextLayouts.filter((candidate) => candidate.localOnly) : nextLayouts,
          selectedId: normalizedLayout.id,
          defaultId: defaultLayoutId
        });
      } catch (error) {
        reportExpectedDegradation('Guest layouts could not be saved in this browser.', error);
        return null;
      }
      lastSavedLayoutRef.current = normalizedLayout;
      setLayoutPersistenceState({
        status: 'saved',
        error: '',
        lastSavedAt: new Date().toISOString()
      });
      toast.success('Layout saved locally');
      return normalizedLayout;
    }

    return layoutSaveQueueRef.current(async () => {
      const serverLayoutId = resolveServerLayoutId(
        logicalLayoutId,
        persistedLayoutIdsRef.current,
        layoutIdAliasesRef.current
      );
      const payload = {
        name: normalizedLayout.name,
        layout: normalizedLayout.layout
      };
      if (serverLayoutId) {
        payload.version = layoutServerVersionsRef.current.get(serverLayoutId)
          || normalizedLayout.version
          || 1;
      }
      const saveBelongsToCurrentLayout = () => (
        [logicalLayoutId, serverLayoutId]
          .filter(Boolean)
          .includes(currentLayoutRef.current?.id)
      );

      if (layoutEditVersionRef.current === editVersion && saveBelongsToCurrentLayout()) {
        setLayoutPersistenceState((current) => ({ ...current, status: 'saving', error: '' }));
      }

      try {
        const { data } = serverLayoutId
          ? await api.put(`/layouts/${encodeURIComponent(serverLayoutId)}`, payload)
          : await api.post('/layouts', payload);
        const savedLayout = {
          ...data,
          version: Number.isInteger(data.version)
            ? data.version
            : (payload.version || 0) + 1,
          layout: normalizeLayoutItems(data.layout)
        };

        persistedLayoutIdsRef.current.add(savedLayout.id);
        layoutServerVersionsRef.current.set(savedLayout.id, savedLayout.version);
        layoutIdAliasesRef.current.set(logicalLayoutId, savedLayout.id);
        const relatedVersionKeys = [logicalLayoutId, serverLayoutId, savedLayout.id].filter(Boolean);
        const latestRevision = Math.max(
          revision,
          ...relatedVersionKeys.map((key) => layoutSaveVersionsRef.current.get(key) || 0)
        );
        layoutSaveVersionsRef.current.set(savedLayout.id, latestRevision);

        setLayouts((previousLayouts) => {
          const matchingIds = new Set([logicalLayoutId, serverLayoutId, savedLayout.id].filter(Boolean));
          const existingIndex = previousLayouts.findIndex(({ id }) => matchingIds.has(id));
          if (existingIndex < 0) return [...previousLayouts, savedLayout];

          const nextLayouts = [...previousLayouts];
          nextLayouts[existingIndex] = savedLayout;
          return nextLayouts.filter((candidate, index) => (
            index === existingIndex || !matchingIds.has(candidate.id)
          ));
        });

        const isLatestRevision = latestRevision === revision && layoutEditVersionRef.current === editVersion;
        setCurrentLayout((current) => {
          const belongsToSavedLayout = [logicalLayoutId, serverLayoutId, savedLayout.id]
            .filter(Boolean)
            .includes(current?.id);
          if (!belongsToSavedLayout) return current;
          if (isLatestRevision) return savedLayout;

          // A newer edit is queued. Adopt the server ID without replacing the
          // newer card state with this older response.
          return {
            ...current,
            id: savedLayout.id,
            createdAt: savedLayout.createdAt,
            updatedAt: savedLayout.updatedAt,
            version: savedLayout.version
          };
        });

        if (isLatestRevision) {
          lastSavedLayoutRef.current = savedLayout;
          try {
            localStorage.setItem('local_dashboard_layout', JSON.stringify(savedLayout));
          } catch (error) {
            reportExpectedDegradation('Saved server layout could not be cached in localStorage.', error);
          }
          if (saveBelongsToCurrentLayout() || currentLayoutRef.current?.id === savedLayout.id) {
            setLayoutPersistenceState({
              status: 'saved',
              error: '',
              lastSavedAt: new Date().toISOString()
            });
          }
          toast.success(serverLayoutId ? 'Layout updated' : 'Layout saved to account');
        }
        return savedLayout;
      } catch (error) {
        const resolvedServerId = resolveServerLayoutId(
          logicalLayoutId,
          persistedLayoutIdsRef.current,
          layoutIdAliasesRef.current
        );
        const latestRevision = Math.max(
          layoutSaveVersionsRef.current.get(logicalLayoutId) || 0,
          layoutSaveVersionsRef.current.get(resolvedServerId) || 0
        );
        const isLatestRevision = latestRevision === revision && layoutEditVersionRef.current === editVersion;
        const localFallback = {
          ...normalizedLayout,
          id: resolvedServerId || logicalLayoutId
        };

        if (isLatestRevision) {
          setCurrentLayout((current) => (
            [logicalLayoutId, resolvedServerId].filter(Boolean).includes(current?.id)
              ? localFallback
              : current
          ));
          setLayoutPersistenceState((current) => ({
            ...current,
            status: 'error',
            error: describeApiError(error, 'Server layout save failed; the layout is only saved locally.').text
          }));
          toast.error(describeApiError(error, 'Server layout save failed; the layout is only saved locally.').text);
        }
        return localFallback;
      }
    });
  }, [isAuthenticated, selectLayout, selectedDataset, setCurrentLayout, defaultLayoutId]);

  const { scheduleLayoutSave, applyLayoutChange, undoLayoutChange, redoLayoutChange, saveCurrentLayout, beginLayoutEditSession, cancelLayoutEditSession, commitLayoutEditSession } = useLayoutEditing({
    cancelScheduledLayoutSave, layoutAutosaveTimeoutRef, saveLayout, currentLayoutRef, layoutEditVersionRef, layoutHistoryRef, setCurrentLayoutState, syncLayoutHistoryState, setLayoutPersistenceState, layoutEditSessionRef, layoutPersistenceState
  });

  const renameLayout = useCallback(async (id, name) => {
    const trimmedName = String(name || '').trim().slice(0, 191);
    const source = currentLayoutRef.current?.id === id
      ? currentLayoutRef.current
      : layouts.find((layout) => layout.id === id);
    if (!source || !trimmedName) return null;
    return saveLayout({ ...source, name: trimmedName });
  }, [layouts, saveLayout]);

  const duplicateLayout = useCallback(async (id) => {
    const source = currentLayoutRef.current?.id === id
      ? currentLayoutRef.current
      : layouts.find((layout) => layout.id === id);
    if (!source) return null;
    return saveLayout({
      name: `${source.name || 'Dashboard'} copy`.slice(0, 191),
      layout: normalizeLayoutItems(source.layout || DEFAULT_LAYOUT_ITEMS)
    });
  }, [layouts, saveLayout]);

  const setDefaultLayout = useCallback(async (id) => {
    if (!id) return false;
    if (!isAuthenticated) {
      try { await persistGuestLayouts({ layouts: layoutsRef.current, selectedId: currentLayoutRef.current?.id, defaultId: id }); }
      catch { return false; }
    }
    setDefaultLayoutIdState(id);
    if (isAuthenticated) {
      try {
        localStorage.setItem('dashboard-default-layout-id', id);
      } catch (error) {
        reportExpectedDegradation('Default layout preference could not be saved.', error);
      }
    }
    toast.success('Default layout updated');
    return true;
  }, [isAuthenticated]);

  const deleteLayout = useCallback(async (id) => {
    const serverLayoutId = resolveServerLayoutId(
      id,
      persistedLayoutIdsRef.current,
      layoutIdAliasesRef.current
    );

    if (isAuthenticated && serverLayoutId) {
      try {
        await api.delete(`/layouts/${encodeURIComponent(serverLayoutId)}`);
      } catch (error) {
        toast.error(describeApiError(error, 'Could not delete the server layout.').text);
        return;
      }
    }

    persistedLayoutIdsRef.current.delete(serverLayoutId);
    layoutServerVersionsRef.current.delete(serverLayoutId);
    for (const [alias, persistedId] of layoutIdAliasesRef.current.entries()) {
      if (alias === id || persistedId === serverLayoutId) layoutIdAliasesRef.current.delete(alias);
    }

    const removedIds = new Set([id, serverLayoutId].filter(Boolean));
    const remainingLayouts = layouts.filter((layout) => !removedIds.has(layout.id));
    setLayouts(remainingLayouts);
    if (removedIds.has(id) && layouts.some((layout) => layout.id === id && layout.localOnly)) {
      try {
        await persistGuestLayouts({
          layouts: remainingLayouts.filter((layout) => layout.localOnly),
          selectedId: remainingLayouts.find((layout) => layout.localOnly)?.id || '',
          defaultId: remainingLayouts.some((layout) => layout.id === defaultLayoutId) ? defaultLayoutId : ''
        });
      } catch (error) {
        reportExpectedDegradation('Local layouts could not be updated in this browser.', error);
        return;
      }
    }
    if (removedIds.has(defaultLayoutId)) {
      const nextDefaultId = remainingLayouts[0]?.id || '';
      setDefaultLayoutIdState(nextDefaultId);
      if (isAuthenticated) {
        try {
          if (nextDefaultId) localStorage.setItem('dashboard-default-layout-id', nextDefaultId);
          else localStorage.removeItem('dashboard-default-layout-id');
        } catch (error) {
          reportExpectedDegradation('Default layout preference could not be updated.', error);
        }
      }
    }

    if (remainingLayouts.length === 0) {
      await createDefaultLayout();
      toast.success('Layout reset');
      return;
    }

    if (removedIds.has(currentLayout?.id)) {
      selectLayout(remainingLayouts[0]);
    }
    toast.success('Layout deleted');
  }, [layouts, currentLayout?.id, defaultLayoutId, isAuthenticated, createDefaultLayout, selectLayout]);

  // Memoized context value — a fresh object here would re-render every chart,
  // table, and chat bubble on any provider state change.
  const reloadSavedLayouts = useCallback(async () => {
    cancelScheduledLayoutSave(); guestEpochRef.current += 1;
    try {
      const saved = await guestQueueRef.current(() => loadGuestLayoutState());
      guestRevisionRef.current = saved.revision; guestConflictRef.current = null; setLayoutConflict(null);
      layoutsRef.current = saved.layouts; setLayouts(saved.layouts); setDefaultLayoutIdState(saved.defaultId);
      selectLayout(saved.layouts.find((layout) => layout.id === saved.selectedId) || saved.layouts[0]
        || { id: createClientLayoutId(), name: 'New workspace', localOnly: true, layout: normalizeLayoutItems(DEFAULT_LAYOUT_ITEMS) });
      return true;
    } catch (error) { toast.error(error.message); return false; }
  }, [cancelScheduledLayoutSave, selectLayout]);

  const preserveLayoutCopy = useCallback(async () => {
    const draft = currentLayoutRef.current;
    if (!draft) return false;
    cancelScheduledLayoutSave(); guestEpochRef.current += 1;
    try {
      const saved = await guestQueueRef.current(() => loadGuestLayoutState());
      const copy = { ...draft, id: createClientLayoutId(), name: `${draft.name || 'Dashboard'} draft copy`.slice(0, 191), localOnly: true };
      const next = await saveGuestLayoutState({ layouts: [...saved.layouts, copy], selectedId: copy.id, defaultId: saved.defaultId }, { expectedRevision: saved.revision });
      guestRevisionRef.current = next.revision; guestConflictRef.current = null; setLayoutConflict(null);
      layoutsRef.current = next.layouts; setLayouts(next.layouts); setDefaultLayoutIdState(next.defaultId); selectLayout(copy);
      setLayoutPersistenceState({ status: 'saved', error: '', lastSavedAt: new Date().toISOString() }); return true;
    } catch (error) { toast.error(error.message); return false; }
  }, [cancelScheduledLayoutSave, selectLayout]);

  const value = useMemo(() => ({
    layoutConflict,
    reloadSavedLayouts,
    preserveLayoutCopy,
    layouts,
    currentLayout,
    setCurrentLayout,
    selectLayout,
    applyLayoutChange,
    undoLayoutChange,
    redoLayoutChange,
    canUndoLayout: layoutHistoryState.canUndo,
    canRedoLayout: layoutHistoryState.canRedo,
    layoutSaveStatus: layoutPersistenceState.status,
    layoutSaveError: layoutPersistenceState.error,
    lastLayoutSavedAt: layoutPersistenceState.lastSavedAt,
    hasUnsavedLayoutChanges,
    confirmDiscardLayoutChanges,
    discardPendingLayoutChanges,
    beginLayoutEditSession,
    cancelLayoutEditSession,
    commitLayoutEditSession,
    saveCurrentLayout,
    saveLayout,
    renameLayout,
    duplicateLayout,
    setDefaultLayout,
    defaultLayoutId,
    deleteLayout,
    selectedDataset,
    setSelectedDataset,
    datasetLoadState,
    loadLocalDatasets,
    datasets,
    localDatasets,
    localSaveConflicts,
    reloadSavedLocalDataset,
    preserveLocalDatasetCopy,
    addLocalDataset,
    addLocalDatasets,
    restoreLocalWorkspace,
    updateLocalDataset,
    commitLocalDataset,
    removeLocalDataset,
    getLocalData,
    globalFilters,
    setGlobalFilter,
    removeGlobalFilter,
    clearGlobalFilters,
    fetchDatasets,
    generateSmartLayout,
    resetToDefaultLayout,
    loading
  }), [
    layoutConflict,
    reloadSavedLayouts,
    preserveLayoutCopy,
    layouts,
    currentLayout,
    selectLayout,
    applyLayoutChange,
    undoLayoutChange,
    redoLayoutChange,
    layoutHistoryState.canUndo,
    layoutHistoryState.canRedo,
    layoutPersistenceState.status,
    layoutPersistenceState.error,
    layoutPersistenceState.lastSavedAt,
    hasUnsavedLayoutChanges,
    confirmDiscardLayoutChanges,
    discardPendingLayoutChanges,
    beginLayoutEditSession,
    cancelLayoutEditSession,
    commitLayoutEditSession,
    saveCurrentLayout,
    saveLayout,
    renameLayout,
    duplicateLayout,
    setDefaultLayout,
    defaultLayoutId,
    deleteLayout,
    selectedDataset,
    setSelectedDataset,
    datasetLoadState,
    loadLocalDatasets,
    datasets,
    localDatasets,
    localSaveConflicts,
    reloadSavedLocalDataset,
    preserveLocalDatasetCopy,
    addLocalDataset,
    addLocalDatasets,
    restoreLocalWorkspace,
    updateLocalDataset,
    commitLocalDataset,
    removeLocalDataset,
    getLocalData,
    globalFilters,
    setGlobalFilter,
    removeGlobalFilter,
    clearGlobalFilters,
    fetchDatasets,
    generateSmartLayout,
    resetToDefaultLayout,
    loading
  ]);

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
};

export default DashboardContext;

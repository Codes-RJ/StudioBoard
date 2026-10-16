import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { DashboardProvider, useDashboard } from '../DashboardContext';

// VM workers can retain a previously imported provider from another test file.
// Reload it before registering this suite's auth and persistence mocks.
vi.hoisted(() => vi.resetModules());
// This suite explicitly covers the retained legacy server edition.
vi.mock('../../config/workspace', () => ({ SERVER_WORKSPACE_ENABLED: true, requireServerWorkspace: () => {} }));

const mocks = vi.hoisted(() => ({
  isAuthenticated: true,
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  deleteLocalDataset: vi.fn(),
  getLocalDatasetStorageStatus: vi.fn(),
  loadLocalDatasetCatalog: vi.fn(),
  requestPersistentLocalDatasetStorage: vi.fn(),
  saveLocalDataset: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}));

vi.mock('../../services/api', () => ({
  default: {
    delete: mocks.apiDelete,
    get: mocks.apiGet,
    post: mocks.apiPost,
    put: mocks.apiPut
  }
}));

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mocks.isAuthenticated })
}));

vi.mock('../../utils/localDatasetStore', () => ({
  deleteLocalDataset: mocks.deleteLocalDataset,
  getLocalDatasetStorageStatus: mocks.getLocalDatasetStorageStatus,
  loadLocalDatasetCatalog: mocks.loadLocalDatasetCatalog,
  requestPersistentLocalDatasetStorage: mocks.requestPersistentLocalDatasetStorage,
  saveLocalDataset: mocks.saveLocalDataset
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: mocks.toastError,
    success: mocks.toastSuccess
  }
}));

const existingLayout = {
  id: 'server-existing',
  name: 'Existing layout',
  version: 1,
  layout: [{ i: '1', x: 0, y: 0, w: 4, h: 3, chartType: 'bar' }]
};
const serverDataset = {
  id: 'server-dataset',
  name: 'Server dataset',
  columns: [{ name: 'Plan', type: 'string' }, { name: 'MRR', type: 'number' }],
  rowCount: 10
};

const wrapper = ({ children }) => <DashboardProvider>{children}</DashboardProvider>;

const createDeferredResponse = () => {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

describe('DashboardProvider layout persistence', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    vi.clearAllMocks();
    mocks.isAuthenticated = true;
    localStorage.clear();
    mocks.loadLocalDatasetCatalog.mockResolvedValue({ datasets: [], discardedLegacyCount: 0 });
    mocks.deleteLocalDataset.mockResolvedValue(undefined);
    mocks.getLocalDatasetStorageStatus.mockResolvedValue(null);
    mocks.requestPersistentLocalDatasetStorage.mockResolvedValue(false);
    mocks.saveLocalDataset.mockResolvedValue(undefined);
    mocks.apiGet.mockImplementation(async (url) => {
      if (url === '/layouts') return { data: [existingLayout] };
      if (url === '/datasets') return { data: { datasets: [] } };
      throw new Error(`Unexpected GET ${url}`);
    });
  });

  it('creates a generated layout instead of updating its client-only ID', async () => {
    mocks.apiPost.mockResolvedValue({
      data: {
        id: 'server-created',
        name: 'Generated layout',
        layout: [{ i: '1', x: 0, y: 0, w: 4, h: 3, chartType: 'line' }]
      }
    });
    const { result } = renderHook(() => useDashboard(), { wrapper });

    await waitFor(() => expect(result.current.layouts).toHaveLength(1));
    act(() => result.current.setSelectedDataset(serverDataset));

    await act(async () => {
      await result.current.saveLayout({
        id: 'layout_generated',
        name: 'Generated layout',
        source: 'planner',
        layout: [{ i: '1', x: 0, y: 0, w: 4, h: 3, chartType: 'line' }]
      });
    });

    expect(mocks.apiPut).not.toHaveBeenCalled();
    expect(mocks.apiPost).toHaveBeenCalledWith('/layouts', expect.objectContaining({
      name: 'Generated layout'
    }));
    expect(result.current.currentLayout.id).toBe('server-created');
  });

  it('does not let an older queued response replace a newer edit after ID promotion', async () => {
    const created = createDeferredResponse();
    const secondSave = createDeferredResponse();
    const thirdSave = createDeferredResponse();
    mocks.apiPost.mockImplementation(() => created.promise);
    mocks.apiPut
      .mockImplementationOnce(() => secondSave.promise)
      .mockImplementationOnce(() => thirdSave.promise);
    const { result } = renderHook(() => useDashboard(), { wrapper });

    await waitFor(() => expect(result.current.layouts).toHaveLength(1));
    act(() => result.current.setSelectedDataset(serverDataset));

    const firstLayout = {
      id: 'layout_generated',
      name: 'Generated layout',
      source: 'planner',
      layout: [{ i: '1', x: 0, y: 0, w: 4, h: 3, title: 'First', chartType: 'line' }]
    };
    const secondLayout = {
      ...firstLayout,
      layout: [{ ...firstLayout.layout[0], title: 'Second' }]
    };
    let firstPromise;
    let secondPromise;
    act(() => {
      firstPromise = result.current.saveLayout(firstLayout);
      secondPromise = result.current.saveLayout(secondLayout);
    });

    await act(async () => {
      created.resolve({
        data: { id: 'server-created', name: firstLayout.name, layout: firstLayout.layout }
      });
      await firstPromise;
    });
    await waitFor(() => expect(mocks.apiPut).toHaveBeenCalledTimes(1));
    expect(result.current.currentLayout.layout[0].title).toBe('Second');

    const thirdLayout = {
      ...result.current.currentLayout,
      layout: [{ ...result.current.currentLayout.layout[0], title: 'Third' }]
    };
    let thirdPromise;
    act(() => {
      thirdPromise = result.current.saveLayout(thirdLayout);
    });

    await act(async () => {
      secondSave.resolve({
        data: { id: 'server-created', name: secondLayout.name, layout: secondLayout.layout }
      });
      await secondPromise;
    });
    await waitFor(() => expect(mocks.apiPut).toHaveBeenCalledTimes(2));
    expect(mocks.apiPut.mock.calls[0][1].version).toBe(1);
    expect(mocks.apiPut.mock.calls[1][1].version).toBe(2);
    expect(result.current.currentLayout.layout[0].title).toBe('Third');

    await act(async () => {
      thirdSave.resolve({
        data: { id: 'server-created', name: thirdLayout.name, layout: thirdLayout.layout }
      });
      await thirdPromise;
    });

    expect(result.current.currentLayout.layout[0].title).toBe('Third');
    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    expect(mocks.apiPut).toHaveBeenCalledTimes(2);
  });

  it('tracks edits through undo and redo', async () => {
    const { result, unmount } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.currentLayout.id).toBe('server-existing'));
    const changed = {
      ...result.current.currentLayout,
      layout: [{ ...result.current.currentLayout.layout[0], title: 'Changed title' }]
    };

    act(() => result.current.applyLayoutChange(changed, { autosave: false }));
    expect(result.current.currentLayout.layout[0].title).toBe('Changed title');
    expect(result.current.canUndoLayout).toBe(true);
    expect(result.current.layoutSaveStatus).toBe('dirty');

    act(() => result.current.undoLayoutChange());
    expect(result.current.currentLayout.layout[0].title).toBe('Card 1');
    expect(result.current.canRedoLayout).toBe(true);

    act(() => result.current.redoLayoutChange());
    expect(result.current.currentLayout.layout[0].title).toBe('Changed title');
    unmount();
  });

  it('applies consecutive functional updates against the latest layout snapshot', async () => {
    const { result, unmount } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.currentLayout.id).toBe('server-existing'));

    act(() => {
      result.current.applyLayoutChange((layout) => ({
        ...layout,
        layout: layout.layout.map((item) => ({ ...item, preferredX: 'Plan' }))
      }), { autosave: false });
      result.current.applyLayoutChange((layout) => ({
        ...layout,
        layout: layout.layout.map((item) => ({ ...item, preferredY: 'MRR' }))
      }), { autosave: false });
    });

    expect(result.current.currentLayout.layout[0]).toMatchObject({ preferredX: 'Plan', preferredY: 'MRR' });
    unmount();
  });

  it('requires confirmation before discarding dirty layout changes', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { result, unmount } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.currentLayout.id).toBe('server-existing'));
    const changed = {
      ...result.current.currentLayout,
      layout: [{ ...result.current.currentLayout.layout[0], title: 'Unsaved title' }]
    };
    act(() => result.current.applyLayoutChange(changed, { autosave: false }));

    confirm.mockReturnValueOnce(false);
    expect(result.current.confirmDiscardLayoutChanges()).toBe(false);
    expect(result.current.currentLayout.layout[0].title).toBe('Unsaved title');

    confirm.mockReturnValueOnce(true);
    act(() => result.current.confirmDiscardLayoutChanges());
    expect(result.current.currentLayout.layout[0].title).toBe('Card 1');
    expect(result.current.layoutSaveStatus).toBe('idle');
    confirm.mockRestore();
    unmount();
  });

  it('blocks persistence when a graph references incompatible columns', async () => {
    const { result, unmount } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.currentLayout.id).toBe('server-existing'));

    await act(async () => {
      await result.current.saveLayout({
        ...result.current.currentLayout,
        layout: [{
          ...result.current.currentLayout.layout[0],
          chartType: 'scatter',
          preferredX: 'MRR',
          preferredY: 'MRR'
        }]
      });
    });

    expect(mocks.apiPut).not.toHaveBeenCalled();
    expect(result.current.layoutSaveStatus).toBe('error');
    expect(result.current.layoutSaveError).toContain('Choose two different columns.');
    unmount();
  });

  it('keeps edit sessions local until commit and restores the baseline on cancel', async () => {
    const { result, unmount } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.currentLayout.id).toBe('server-existing'));

    act(() => result.current.beginLayoutEditSession());
    act(() => result.current.applyLayoutChange({
      ...result.current.currentLayout,
      layout: [{ ...result.current.currentLayout.layout[0], title: 'Session edit' }]
    }));
    expect(result.current.currentLayout.layout[0].title).toBe('Session edit');
    expect(mocks.apiPut).not.toHaveBeenCalled();

    act(() => result.current.cancelLayoutEditSession());
    expect(result.current.currentLayout.layout[0].title).toBe('Card 1');
    expect(result.current.layoutSaveStatus).toBe('idle');
    unmount();
  });

  it('renames, duplicates, and marks saved layouts as default', async () => {
    mocks.apiPut.mockResolvedValue({ data: { ...existingLayout, name: 'Renamed layout' } });
    mocks.apiPost.mockResolvedValue({ data: { ...existingLayout, id: 'server-copy', name: 'Renamed layout copy' } });
    const { result, unmount } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.currentLayout.id).toBe('server-existing'));
    act(() => result.current.setSelectedDataset(serverDataset));

    await act(async () => result.current.renameLayout('server-existing', 'Renamed layout'));
    expect(mocks.apiPut).toHaveBeenCalledWith('/layouts/server-existing', expect.objectContaining({ name: 'Renamed layout' }));
    expect(mocks.apiPut).toHaveBeenCalledWith('/layouts/server-existing', expect.objectContaining({ version: 1 }));
    await act(async () => result.current.duplicateLayout('server-existing'));
    expect(mocks.apiPost).toHaveBeenCalledWith('/layouts', expect.objectContaining({ name: 'Renamed layout copy' }));

    await act(async () => result.current.setDefaultLayout('server-copy'));
    expect(result.current.defaultLayoutId).toBe('server-copy');
    expect(localStorage.getItem('dashboard-default-layout-id')).toBe('server-copy');
    unmount();
  });

  it('restores a folder collection only to local storage', async () => {
    const { result } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.layouts).toHaveLength(1));
    const folderId = 'restored_folder';
    const overview = { id: 'restored_overview', name: 'Job overview', folderId, isFolderOverview: true, isLocal: true, rawRows: [{ Source: 'Job/sales.csv', Worksheet: '', Rows: 1 }], columns: [{ name: 'Rows', type: 'number' }], rowCount: 1, totalSourceRows: 1 };
    const source = { id: 'restored_source', name: 'Sales', folderId, sourcePath: 'Job/sales.csv', isLocal: true, rawRows: [{ Revenue: 2 }], columns: [{ name: 'Revenue', type: 'number' }], rowCount: 1 };
    const restoredLayout = { id: 'restored_layout', name: 'Job layout', sourceDatasetId: overview.id, localOnly: true, source: 'planner', layout: [{ i: '1', x: 0, y: 0, w: 4, h: 3, chartType: 'bar' }] };

    await act(async () => result.current.restoreLocalWorkspace({
      dataset: overview, datasets: [overview, source],
      layout: restoredLayout, layouts: [restoredLayout], filters: { Rows: '2' },
    }));

    expect(result.current.localDatasets.map(({ id }) => id)).toEqual(expect.arrayContaining([overview.id, source.id]));
    expect(result.current.selectedDataset.id).toBe(overview.id);
    expect(result.current.currentLayout.id).toBe(restoredLayout.id);
    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(mocks.apiPut).not.toHaveBeenCalled();

    await act(async () => result.current.updateLocalDataset({
      ...source, rawRows: [{ Revenue: 2 }, { Revenue: 3 }], rowCount: 2,
      metrics: { missingValues: 0, completeness: 100 },
    }));
    await waitFor(() => {
      const updatedOverview = result.current.localDatasets.find(({ id }) => id === overview.id);
      expect(updatedOverview.rawRows[0].Rows).toBe(2);
      expect(updatedOverview.totalSourceRows).toBe(2);
    });
  });

  it('keeps a signed-in user’s local dataset layout in browser storage', async () => {
    const { result, unmount } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.currentLayout.id).toBe('server-existing'));

    await act(async () => {
      await result.current.saveLayout(result.current.currentLayout);
    });

    expect(result.current.currentLayout.localOnly).toBe(true);
    expect(result.current.currentLayout.id).toMatch(/^local_/);
    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(mocks.apiPut).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('guest_dashboard_layouts')).layouts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: result.current.currentLayout.id })])
    );
    const localLayoutId = result.current.currentLayout.id;
    unmount();

    const restored = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(restored.result.current.currentLayout.id).toBe(localLayoutId));
    restored.unmount();
  });

  it('restores a workspace locally without an API write while signed in', async () => {
    const { result, unmount } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.currentLayout.id).toBe('server-existing'));
    const dataset = {
      id: 'local_backup_test', name: 'Backup', isLocal: true, rowCount: 1,
      columns: [{ name: 'MRR', type: 'number' }], rawRows: [{ MRR: 12 }]
    };
    const layout = {
      id: 'local_layout_backup_test', name: 'Backup layout', localOnly: true,
      layout: [{ i: '1', x: 0, y: 0, w: 4, h: 3, chartType: 'bar' }]
    };

    await act(async () => result.current.restoreLocalWorkspace({ dataset, layout, filters: { MRR: '12' } }));

    expect(result.current.selectedDataset.id).toBe(dataset.id);
    expect(result.current.currentLayout).toMatchObject({ id: layout.id, localOnly: true });
    expect(result.current.globalFilters).toEqual({ MRR: '12' });
    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(mocks.apiPut).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('guest_dashboard_layouts')).layouts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: layout.id })])
    );
    unmount();
  });

  it('restores multiple guest layouts, their selection, and the default after remount', async () => {
    mocks.isAuthenticated = false;
    const firstSession = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(firstSession.result.current.layouts).toHaveLength(1));
    const firstId = firstSession.result.current.layouts[0].id;

    await act(async () => {
      await firstSession.result.current.saveLayout({
        name: 'Second layout',
        layout: firstSession.result.current.currentLayout.layout
      });
    });
    const secondId = firstSession.result.current.currentLayout.id;
    expect(firstSession.result.current.layouts).toHaveLength(2);

    await act(async () => firstSession.result.current.setDefaultLayout(firstId));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('guest_dashboard_layouts')).defaultId).toBe(firstId));
    firstSession.unmount();

    const secondSession = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(secondSession.result.current.layouts).toHaveLength(2));
    expect(secondSession.result.current.currentLayout.id).toBe(secondId);
    expect(secondSession.result.current.defaultLayoutId).toBe(firstId);
    secondSession.unmount();
  });

  it('does not restore a cached server layout as a guest layout', async () => {
    mocks.isAuthenticated = false;
    localStorage.setItem('local_dashboard_layout', JSON.stringify({
      id: 'server-uuid', name: 'Private server layout', layout: [{ i: 'card', x: 0, y: 0, w: 4, h: 3 }]
    }));
    const session = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(session.result.current.layouts).toHaveLength(1));
    expect(session.result.current.layouts[0].name).toBe('Default Layout');
    session.unmount();
  });
});

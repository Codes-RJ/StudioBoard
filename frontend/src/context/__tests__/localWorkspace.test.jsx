import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
vi.hoisted(() => vi.resetModules());
import { AuthProvider, useAuth } from '../AuthContext';
import { SiteSettingsProvider, useSiteSettings } from '../SiteSettingsContext';
import { DashboardProvider, useDashboard } from '../DashboardContext';
import { useRealtimeDataset } from '../../hooks/useRealtimeDataset';
import { datasetCatalogMetadata } from '../../utils/datasetCatalogMetadata';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const storage = vi.hoisted(() => ({ catalog: vi.fn(), load: vi.fn(), remove: vi.fn() }));
vi.mock('../../services/api', () => ({ default: mocks }));
vi.mock('../../utils/localDatasetStore', () => ({
  loadLocalDatasetCatalog: (...args) => storage.catalog(...args),
  loadLocalDataset: (...args) => storage.load(...args),
  refreshLocalDatasetMetadata: async () => null,
  deleteLocalDataset: (...args) => storage.remove(...args),
  saveLocalDataset: async () => {},
  cleanupAbandonedLocalImports: async () => {},
  requestPersistentLocalDatasetStorage: async () => false,
  getLocalDatasetStorageStatus: async () => null,
}));

const wrapper = ({ children }) => <AuthProvider><SiteSettingsProvider><DashboardProvider>{children}</DashboardProvider></SiteSettingsProvider></AuthProvider>;

describe('browser-only providers', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); vi.clearAllMocks(); localStorage.clear(); storage.catalog.mockResolvedValue({ datasets: [], discardedLegacyCount: 0 }); });
  it('clears deleted selected rows even when remaining source hydration fails', async () => {
    const source = { id: 'removed', isLocal: true, columns: ['value'], rawRows: [{ value: 'private' }] };
    const related = { ...source, id: 'related', relationships: [{ leftDatasetId: source.id, rightDatasetId: 'related' }] };
    storage.catalog.mockResolvedValue({ datasets: [source, related].map(datasetCatalogMetadata), discardedLegacyCount: 0 });
    storage.load.mockImplementation(async (id) => {
      if (id === source.id) return source;
      throw new Error('Remaining source cannot be read');
    });
    storage.remove.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(result.current.selectedDataset?.id).toBe(source.id));
    await act(async () => result.current.removeLocalDataset(source.id));
    expect(storage.remove).toHaveBeenCalledWith(source.id, { expectedStorageRevision: null });
    expect(result.current.selectedDataset).toBeNull();
    expect(result.current.localDatasets.some(({ id }) => id === source.id)).toBe(false);
    expect(result.current.datasetLoadState.status).toBe('error');
  });
  it('preserves the last workspace on loading failure and ignores late selection results', async () => {
    const source = (id) => ({ id, isLocal: true, name: id, revision: 'r1', columns: ['value'], rawRows: [{ value: id }], rowCount: 1 });
    const first = source('first'); const second = source('second'); const third = source('third');
    storage.catalog.mockResolvedValue({ datasets: [first, second, third].map(datasetCatalogMetadata), discardedLegacyCount: 0 });
    const pending = new Map();
    storage.load.mockImplementation((id) => new Promise((resolve, reject) => pending.set(id, { resolve, reject })));
    const { result } = renderHook(() => useDashboard(), { wrapper });
    await waitFor(() => expect(pending.has('first')).toBe(true));
    await act(async () => pending.get('first').resolve(first));
    expect(result.current.selectedDataset.id).toBe('first');
    act(() => result.current.setSelectedDataset(result.current.datasets.find(({ id }) => id === 'second')));
    await waitFor(() => expect(pending.has('second')).toBe(true));
    expect(result.current.selectedDataset.id).toBe('first');
    act(() => result.current.setSelectedDataset(result.current.datasets.find(({ id }) => id === 'third')));
    await waitFor(() => expect(pending.has('third')).toBe(true));
    await act(async () => pending.get('third').resolve(third));
    await act(async () => pending.get('second').resolve(second));
    expect(result.current.selectedDataset.id).toBe('third');
    expect(result.current.localDatasets.filter((item) => item.rawRows).map(({ id }) => id)).toEqual(['third']);
    act(() => result.current.setSelectedDataset(result.current.datasets.find(({ id }) => id === 'first')));
    await waitFor(() => expect(storage.load).toHaveBeenCalledTimes(4));
    await act(async () => pending.get('first').reject(new Error('Read failed')));
    expect(result.current.selectedDataset.id).toBe('third');
    expect(result.current.datasetLoadState).toMatchObject({ status: 'error', error: 'Read failed' });
    Object.values(mocks).forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });
  it('initializes, refreshes and saves a layout without session/settings/workspace requests', async () => {
    const { result } = renderHook(() => ({ auth: useAuth(), site: useSiteSettings(), dashboard: useDashboard() }), { wrapper });
    await waitFor(() => expect(result.current.auth.authChecked).toBe(true));
    await waitFor(() => expect(result.current.dashboard.layouts.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.auth.refreshSession();
      await result.current.site.refreshSettings();
      await result.current.dashboard.fetchDatasets();
      await result.current.dashboard.saveLayout({ name: 'Private layout', layout: result.current.dashboard.currentLayout.layout });
    });
    expect(result.current.auth.isAuthenticated).toBe(false);
    expect(result.current.site.settings.features.serverWorkspace).toBe('disabled');
    expect(localStorage.getItem('guest_dashboard_layouts')).toContain('Private layout');
    Object.values(mocks).forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });
  it('never opens a stream, polls or manually refreshes a server dataset', async () => {
    const stream = vi.fn();
    const previous = window.EventSource;
    window.EventSource = stream;
    try {
      const { result, rerender } = renderHook(({ enabled }) => useRealtimeDataset('private-source', { enabled }), { initialProps: { enabled: true } });
      await act(async () => { await result.current.refresh(); });
      rerender({ enabled: false });
      await act(async () => { await result.current.refresh(); });
      expect(stream).not.toHaveBeenCalled();
      expect(mocks.get).not.toHaveBeenCalled();
    } finally {
      window.EventSource = previous;
    }
  });
});

const GUEST_LAYOUTS_KEY = 'guest_dashboard_layouts';
const LEGACY_LAYOUT_KEY = 'local_dashboard_layout';

const isLayout = (layout) => Boolean(
  layout && typeof layout.id === 'string' && Array.isArray(layout.layout)
);

const isLegacyGuestLayout = (layout) => isLayout(layout) && (
  layout.id.startsWith('local_')
  || layout.id.startsWith('layout_local_')
  || layout.id === 'default_guest_layout'
);

export const readGuestLayoutState = () => {
  try {
    const saved = localStorage.getItem(GUEST_LAYOUTS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const layouts = Array.isArray(parsed?.layouts) ? parsed.layouts.filter(isLayout) : [];
      if (layouts.length || parsed.revision) {
        return {
          layouts,
          selectedId: layouts.some(({ id }) => id === parsed.selectedId) ? parsed.selectedId : layouts[0]?.id || '',
          defaultId: layouts.some(({ id }) => id === parsed.defaultId) ? parsed.defaultId : '',
          revision: parsed.revision || null,
        };
      }
    }

    const legacy = JSON.parse(localStorage.getItem(LEGACY_LAYOUT_KEY) || 'null');
    if (isLegacyGuestLayout(legacy)) {
      return { layouts: [legacy], selectedId: legacy.id, defaultId: '' };
    }
  } catch {
    // Corrupt browser storage must not stop the workspace from opening.
  }
  return null;
};

const revision = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;
const withLayoutDatabase = async (operation) => {
  if (typeof indexedDB === 'undefined') throw new Error('Local layout persistence requires IndexedDB. Your draft remains open.');
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('analytics-dashboard-layouts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace', { keyPath: 'id' });
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other tabs to upgrade layout storage.'));
  });
  try { return await operation(database); } finally { database.close(); }
};

export const loadGuestLayoutState = () => withLayoutDatabase((database) => new Promise((resolve, reject) => {
  const transaction = database.transaction('workspace', 'readwrite'); let state;
  const request = transaction.objectStore('workspace').get('guest');
  request.onsuccess = () => {
    state = request.result;
    if (!state) {
      state = { id: 'guest', ...(readGuestLayoutState() || { layouts: [], selectedId: '', defaultId: '' }), revision: revision() };
      transaction.objectStore('workspace').add(state);
    }
  };
  transaction.oncomplete = () => resolve(state); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
}));

export const saveGuestLayoutState = (next, { expectedRevision } = {}) => withLayoutDatabase((database) => new Promise((resolve, reject) => {
  const transaction = database.transaction('workspace', 'readwrite'); let state; let failure;
  const request = transaction.objectStore('workspace').get('guest');
  request.onsuccess = () => {
    const current = request.result;
    const payload = { layouts: next.layouts, selectedId: next.selectedId || '', defaultId: next.defaultId || '' };
    const comparable = current && { layouts: current.layouts, selectedId: current.selectedId, defaultId: current.defaultId };
    if (current && JSON.stringify(comparable) === JSON.stringify(payload)) { state = current; return; }
    if (expectedRevision === undefined || (current?.revision || null) !== expectedRevision) {
      failure = new Error('Another tab changed the saved layouts. Reload saved layouts or keep your draft as a copy.'); failure.code = 'LAYOUT_CONFLICT'; transaction.abort(); return;
    }
    state = { id: 'guest', ...payload, revision: revision() }; transaction.objectStore('workspace').put(state);
  };
  transaction.oncomplete = () => {
    // The mirror accelerates initial paint and provides storage notifications;
    // IndexedDB is authoritative and commits before the mirror is written.
    try { localStorage.setItem(GUEST_LAYOUTS_KEY, JSON.stringify(state)); } catch { /* Recovery stays in IndexedDB. */ }
    if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('analytics-dashboard-layouts'); channel.postMessage({ revision: state.revision }); channel.close(); }
    resolve(state);
  };
  transaction.onerror = () => reject(failure || transaction.error); transaction.onabort = () => reject(failure || transaction.error);
}));

export const subscribeGuestLayoutChanges = (callback) => {
  const listener = (event) => { if (event.key === GUEST_LAYOUTS_KEY) callback(); };
  window.addEventListener('storage', listener);
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('analytics-dashboard-layouts') : null;
  if (channel) channel.onmessage = callback;
  return () => { window.removeEventListener('storage', listener); channel?.close(); };
};

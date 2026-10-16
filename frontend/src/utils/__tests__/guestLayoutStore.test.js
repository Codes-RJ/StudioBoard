import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { loadGuestLayoutState, saveGuestLayoutState } from '../guestLayoutStore';
const layout = { id: 'one', name: 'One', layout: [{ i: 'a' }] };
describe('serialized guest layout state', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });
  it('migrates cached legacy layouts exactly once into authoritative storage', async () => {
    localStorage.setItem('guest_dashboard_layouts', JSON.stringify({ layouts: [layout], selectedId: layout.id, defaultId: layout.id }));
    const first = await loadGuestLayoutState();
    localStorage.setItem('guest_dashboard_layouts', JSON.stringify({ layouts: [], selectedId: '' }));
    expect(await loadGuestLayoutState()).toEqual(first); expect(first.revision).toBeTruthy();
  });
  it('permits only one concurrent stale catalog mutation and preserves the winner', async () => {
    const initial = await loadGuestLayoutState();
    const first = { layouts: [layout], selectedId: layout.id, defaultId: '' };
    const second = { ...first, layouts: [{ ...layout, name: 'Other tab' }] };
    const results = await Promise.allSettled([saveGuestLayoutState(first, { expectedRevision: initial.revision }), saveGuestLayoutState(second, { expectedRevision: initial.revision })]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(results[1].reason.code).toBe('LAYOUT_CONFLICT');
    expect((await loadGuestLayoutState()).layouts).toEqual([layout]);
  });
  it('does not let a stale queued save recreate a deleted layout', async () => {
    const initial = await loadGuestLayoutState(); const first = await saveGuestLayoutState({ layouts: [layout], selectedId: layout.id }, { expectedRevision: initial.revision });
    await saveGuestLayoutState({ layouts: [], selectedId: '' }, { expectedRevision: first.revision });
    await expect(saveGuestLayoutState({ layouts: [layout], selectedId: layout.id }, { expectedRevision: first.revision })).rejects.toMatchObject({ code: 'LAYOUT_CONFLICT' });
    expect((await loadGuestLayoutState()).layouts).toEqual([]);
  });
  it('retains committed layouts when the optional localStorage mirror cannot be written', async () => {
    const initial = await loadGuestLayoutState();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await saveGuestLayoutState({ layouts: [layout], selectedId: layout.id }, { expectedRevision: initial.revision });
    write.mockRestore();
    expect((await loadGuestLayoutState()).layouts).toEqual([layout]);
  });
});

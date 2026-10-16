import { useCallback } from 'react';
import { normalizeLayoutItems, DEFAULT_LAYOUT_ITEMS } from '../utils/layoutModel';

export default function useLayoutEditing({
  cancelScheduledLayoutSave, layoutAutosaveTimeoutRef, saveLayout, currentLayoutRef, layoutEditVersionRef, layoutHistoryRef, setCurrentLayoutState, syncLayoutHistoryState, setLayoutPersistenceState, layoutEditSessionRef, layoutPersistenceState
}) {
  const scheduleLayoutSave = useCallback((layout, delayMs = 800) => {
    cancelScheduledLayoutSave();
    layoutAutosaveTimeoutRef.current = window.setTimeout(() => {
      layoutAutosaveTimeoutRef.current = null;
      void saveLayout(layout);
    }, delayMs);
  }, [cancelScheduledLayoutSave, saveLayout]);

  const applyLayoutChange = useCallback((nextLayoutOrUpdater, { autosave = true } = {}) => {
    const nextLayout = typeof nextLayoutOrUpdater === 'function'
      ? nextLayoutOrUpdater(currentLayoutRef.current)
      : nextLayoutOrUpdater;
    if (!nextLayout) return null;
    const normalizedLayout = {
      ...nextLayout,
      layout: normalizeLayoutItems(nextLayout.layout || DEFAULT_LAYOUT_ITEMS)
    };
    layoutEditVersionRef.current += 1;
    const snapshot = layoutHistoryRef.current.apply(normalizedLayout);
    currentLayoutRef.current = snapshot.present;
    setCurrentLayoutState(snapshot.present);
    syncLayoutHistoryState(snapshot);
    setLayoutPersistenceState((current) => ({ ...current, status: 'dirty', error: '' }));
    if (autosave && !layoutEditSessionRef.current) scheduleLayoutSave(snapshot.present);
    return snapshot.present;
  }, [scheduleLayoutSave, syncLayoutHistoryState]);

  const undoLayoutChange = useCallback(() => {
    const before = layoutHistoryRef.current.snapshot();
    if (!before.canUndo) return false;
    const snapshot = layoutHistoryRef.current.undo();
    layoutEditVersionRef.current += 1;
    currentLayoutRef.current = snapshot.present;
    setCurrentLayoutState(snapshot.present);
    syncLayoutHistoryState(snapshot);
    setLayoutPersistenceState((current) => ({ ...current, status: 'dirty', error: '' }));
    if (!layoutEditSessionRef.current) scheduleLayoutSave(snapshot.present);
    return true;
  }, [scheduleLayoutSave, syncLayoutHistoryState]);

  const redoLayoutChange = useCallback(() => {
    const before = layoutHistoryRef.current.snapshot();
    if (!before.canRedo) return false;
    const snapshot = layoutHistoryRef.current.redo();
    layoutEditVersionRef.current += 1;
    currentLayoutRef.current = snapshot.present;
    setCurrentLayoutState(snapshot.present);
    syncLayoutHistoryState(snapshot);
    setLayoutPersistenceState((current) => ({ ...current, status: 'dirty', error: '' }));
    if (!layoutEditSessionRef.current) scheduleLayoutSave(snapshot.present);
    return true;
  }, [scheduleLayoutSave, syncLayoutHistoryState]);

  const saveCurrentLayout = useCallback(() => {
    cancelScheduledLayoutSave();
    layoutEditSessionRef.current = null;
    return currentLayoutRef.current ? saveLayout(currentLayoutRef.current) : Promise.resolve(null);
  }, [cancelScheduledLayoutSave, saveLayout]);

  const beginLayoutEditSession = useCallback(() => {
    if (layoutEditSessionRef.current || !currentLayoutRef.current) return false;
    cancelScheduledLayoutSave();
    layoutEditSessionRef.current = {
      layout: currentLayoutRef.current,
      persistenceState: layoutPersistenceState
    };
    return true;
  }, [cancelScheduledLayoutSave, layoutPersistenceState]);

  const cancelLayoutEditSession = useCallback(() => {
    const session = layoutEditSessionRef.current;
    if (!session) return false;
    cancelScheduledLayoutSave();
    layoutEditSessionRef.current = null;
    layoutEditVersionRef.current += 1;
    currentLayoutRef.current = session.layout;
    setCurrentLayoutState(session.layout);
    syncLayoutHistoryState(layoutHistoryRef.current.reset(session.layout));
    setLayoutPersistenceState(session.persistenceState);
    return true;
  }, [cancelScheduledLayoutSave, syncLayoutHistoryState]);

  const commitLayoutEditSession = useCallback(() => {
    layoutEditSessionRef.current = null;
    return saveCurrentLayout();
  }, [saveCurrentLayout]);

  return { scheduleLayoutSave, applyLayoutChange, undoLayoutChange, redoLayoutChange, saveCurrentLayout, beginLayoutEditSession, cancelLayoutEditSession, commitLayoutEditSession };
}

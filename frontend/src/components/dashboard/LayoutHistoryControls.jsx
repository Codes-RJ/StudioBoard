import {
  FiAlertCircle,
  FiCheckCircle,
  FiClock,
  FiCornerUpLeft,
  FiCornerUpRight,
  FiEdit3,
  FiRefreshCw,
  FiSave
} from 'react-icons/fi';
import { useDashboard } from '../../context/DashboardContext';

const SAVE_PRESENTATION = {
  idle: { label: 'No pending changes', icon: FiClock, className: 'text-slate-500' },
  dirty: { label: 'Unsaved · autosaving', icon: FiClock, className: 'text-amber-700' },
  saving: { label: 'Saving…', icon: FiRefreshCw, className: 'text-indigo-700' },
  saved: { label: 'Saved', icon: FiCheckCircle, className: 'text-emerald-700' },
  error: { label: 'Save failed', icon: FiAlertCircle, className: 'text-rose-700' }
};

export default function LayoutHistoryControls({ onOpenEditor, isEditing = false, onDoneEditing, onCancelEditing, compact = false }) {
  const {
    canUndoLayout,
    canRedoLayout,
    undoLayoutChange,
    redoLayoutChange,
    saveCurrentLayout,
    layoutSaveStatus,
    layoutSaveError,
    lastLayoutSavedAt,
    currentLayout,
    layoutConflict,
    reloadSavedLayouts,
    preserveLayoutCopy
  } = useDashboard();
  const presentation = SAVE_PRESENTATION[layoutSaveStatus] || SAVE_PRESENTATION.idle;
  const StatusIcon = presentation.icon;
  const savedTime = lastLayoutSavedAt
    ? new Date(lastLayoutSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="layout-history flex flex-wrap items-center gap-2">
      {(!compact || isEditing || canUndoLayout || canRedoLayout) && <div className="inline-flex overflow-hidden rounded-xl border border-slate-300 bg-white shadow-xs">
        <button type="button" onClick={undoLayoutChange} disabled={!canUndoLayout} className="inline-flex items-center gap-1.5 border-r border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Undo dashboard change" title="Undo (Ctrl+Z)">
          <FiCornerUpLeft /> Undo
        </button>
        <button type="button" onClick={redoLayoutChange} disabled={!canRedoLayout} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Redo dashboard change" title="Redo (Ctrl+Shift+Z)">
          <FiCornerUpRight /> Redo
        </button>
      </div>}
      {(!compact || isEditing || ['dirty', 'error', 'saving'].includes(layoutSaveStatus)) && <button type="button" onClick={() => isEditing && onDoneEditing ? onDoneEditing() : void saveCurrentLayout()} disabled={!currentLayout || layoutSaveStatus === 'saving'} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
        <FiSave /> {isEditing ? 'Save changes' : 'Save now'}
      </button>}
      {onOpenEditor && (
        <button type="button" onClick={onOpenEditor} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-700">
          <FiEdit3 /> {isEditing ? 'Manage graphs' : 'Edit dashboard'}
        </button>
      )}
      {!compact && isEditing && onDoneEditing && (
        <button type="button" onClick={onDoneEditing} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 shadow-xs hover:bg-emerald-100">
          <FiCheckCircle /> Done editing
        </button>
      )}
      {isEditing && onCancelEditing && (
        <button type="button" onClick={onCancelEditing} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50">
          <FiAlertCircle /> Cancel changes
        </button>
      )}
      <span className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold ${presentation.className}`} role="status" aria-live="polite" title={layoutSaveError || undefined}>
        <StatusIcon className={layoutSaveStatus === 'saving' ? 'animate-spin' : ''} />
        {isEditing && layoutSaveStatus === 'dirty' ? 'Unsaved editing session' : presentation.label}{layoutSaveStatus === 'saved' && savedTime ? ` ${savedTime}` : ''}
      </span>
      {layoutConflict && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">
        <p>{layoutConflict.error.message}</p>
        <button type="button" onClick={() => void reloadSavedLayouts()} className="rounded-sm border border-amber-500 bg-white px-3 py-2">Reload saved layouts</button>
        <button type="button" onClick={() => void preserveLayoutCopy()} className="rounded-sm border border-amber-500 bg-white px-3 py-2">Keep layout draft as a copy</button>
      </div>}
    </div>
  );
}

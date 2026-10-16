import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const OperationStatusContext = createContext(null);

export const useOperationStatus = () => {
  const context = useContext(OperationStatusContext);
  if (!context) throw new Error('useOperationStatus must be used within OperationStatusProvider');
  return context;
};

export function OperationStatusProvider({ children }) {
  const [operations, setOperations] = useState([]);
  const nextId = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setOperations((current) => current.filter((operation) => operation.id !== id));
  }, []);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  const startOperation = useCallback((label) => {
    const id = ++nextId.current;
    setOperations((current) => [...current.filter((operation) => operation.status === 'running'), {
      id, label, detail: '', status: 'running'
    }].slice(-4));

    const update = (detail) => setOperations((current) => current.map((operation) => (
      operation.id === id ? { ...operation, detail } : operation
    )));
    const settle = (status, detail) => {
      setOperations((current) => current.map((operation) => (
        operation.id === id ? { ...operation, status, detail } : operation
      )));
      const timer = window.setTimeout(() => dismiss(id), status === 'success' ? 8000 : 15000);
      timers.current.set(id, timer);
    };

    return {
      update,
      succeed: (detail) => settle('success', detail),
      fail: (detail) => settle('error', detail),
      cancel: () => dismiss(id)
    };
  }, [dismiss]);
  const value = useMemo(() => ({ startOperation }), [startOperation]);

  return (
    <OperationStatusContext.Provider value={value}>
      {children}
      {operations.length > 0 && (
        <div role="status" aria-live="polite" className="fixed bottom-4 left-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
          {operations.map(({ id, label, detail, status }) => (
            <div key={id} className={`rounded-xl border bg-white px-4 py-3 shadow-xl ${status === 'error' ? 'border-rose-300' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{label}</p>
                  <p className={`mt-1 text-xs ${status === 'error' ? 'text-rose-700' : 'text-slate-600'}`}>
                    {detail || (status === 'running' ? 'Working…' : 'Complete')}
                  </p>
                </div>
                {status !== 'running' && <button type="button" onClick={() => dismiss(id)} className="text-xs font-bold text-slate-500 hover:text-slate-900" aria-label={`Dismiss ${label} status`}>Close</button>}
              </div>
              {status === 'running' && <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-1/2 animate-pulse rounded-full bg-indigo-500" /></div>}
            </div>
          ))}
        </div>
      )}
    </OperationStatusContext.Provider>
  );
}

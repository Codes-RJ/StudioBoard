import { useDashboard } from '../../context/DashboardContext';
import { FiFilter, FiX, FiRefreshCw } from 'react-icons/fi';

export default function FilterBar() {
  const { globalFilters, removeGlobalFilter, clearGlobalFilters } = useDashboard();
  const filterEntries = Object.entries(globalFilters || {});

  if (!filterEntries.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/80 px-4 py-2.5 shadow-2xs animate-fadeIn">
      <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900 mr-1">
        <FiFilter className="text-indigo-600" />
        <span>Cross-Filters ({filterEntries.length}):</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {filterEntries.map(([column, value]) => (
          <span
            key={column}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-950 shadow-2xs"
          >
            <span className="text-indigo-600 font-bold">{column}:</span>
            <span>{String(value)}</span>
            <button
              type="button"
              onClick={() => removeGlobalFilter(column)}
              className="ml-0.5 rounded-full p-0.5 text-slate-400 hover:bg-indigo-100 hover:text-indigo-800 transition-colors"
              title={`Remove filter on ${column}`}
            >
              <FiX className="text-xs" />
            </button>
          </span>
        ))}

        <button
          type="button"
          onClick={clearGlobalFilters}
          className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white shadow-2xs hover:bg-indigo-700 transition-colors"
        >
          <FiRefreshCw className="text-[10px]" /> Clear All
        </button>
      </div>
    </div>
  );
}

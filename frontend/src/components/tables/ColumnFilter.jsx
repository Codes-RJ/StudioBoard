import { useMemo } from 'react';

export default function ColumnFilter({ column }) {
  const { filterValue, setFilter } = column;
  const label = column.sourceField || column.id;

  const options = useMemo(() => {
    if (!column.preFilteredRows) return [];
    const options = new Set();
    column.preFilteredRows.forEach(row => {
      options.add(row.values[column.id]);
    });
    return [...options];
  }, [column.id, column.preFilteredRows]);

  if (options.length > 0 && options.length < 20) {
    // Use dropdown for small number of options
    return (
      <select
        aria-label={`Filter ${label}`}
        value={filterValue || ''}
        onChange={e => setFilter(e.target.value || undefined)}
        className="mt-1 w-full px-2 py-1 text-xs border rounded-sm"
        onClick={e => e.stopPropagation()}
      >
        <option value="">All</option>
        {options.map((option, i) => (
          <option key={i} value={option}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  }

  // Use input for large number of options
  return (
    <input
      aria-label={`Filter ${label}`}
      value={filterValue || ''}
      onChange={e => setFilter(e.target.value || undefined)}
      placeholder={`Search...`}
      className="mt-1 w-full px-2 py-1 text-xs border rounded-sm"
      onClick={e => e.stopPropagation()}
    />
  );
}

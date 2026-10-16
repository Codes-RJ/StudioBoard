import clsx from 'clsx';

export default function KpiCard({ title, value, format = 'number', loading = false, change = null }) {
  const formatValue = (val) => {
    if (val === undefined || val === null) return '—';
    
    switch (format) {
      case 'percentage':
        return `${Number(val).toFixed(2)}%`;
      case 'currency':
        return new Intl.NumberFormat('en-US', { 
          style: 'currency', 
          currency: 'USD' 
        }).format(val);
      case 'number':
      default:
        return new Intl.NumberFormat('en-US').format(val);
    }
  };

  const getChangeColor = () => {
    if (!change) return 'text-gray-500';
    return change > 0 ? 'text-green-600' : 'text-red-600';
  };

  return (
    <div className="card">
      <h3 className="text-sm font-medium text-gray-500 mb-2">{title}</h3>
      <div className="flex items-end justify-between">
        <div>
          {loading ? (
            <div className="h-8 w-24 bg-gray-200 animate-pulse rounded-sm"></div>
          ) : (
            <p className="text-2xl font-semibold text-gray-900">
              {formatValue(value)}
            </p>
          )}
        </div>
        {change !== null && !loading && (
          <div className={clsx('text-sm font-medium', getChangeColor())}>
            {change > 0 ? '↑' : '↓'} {Math.abs(change)}%
          </div>
        )}
      </div>
    </div>
  );
}
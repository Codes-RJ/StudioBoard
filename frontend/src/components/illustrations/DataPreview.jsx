import { useId } from 'react';
import { FiBarChart2, FiColumns, FiDatabase, FiDownload, FiGrid, FiSliders } from 'react-icons/fi';

const sample = [
  { month: 'Jan', date: '2026-01-12', product: 'Notebook', revenue: 18500 },
  { month: 'Feb', date: '2026-02-09', product: 'Monitor', revenue: 24500 },
  { month: 'Mar', date: '2026-03-16', product: 'Desk chair', revenue: 21750 },
  { month: 'Apr', date: '2026-04-20', product: 'Keyboard', revenue: 34000 },
  { month: 'May', date: '2026-05-11', product: 'Laptop', revenue: 31500 },
  { month: 'Jun', date: '2026-06-08', product: 'Desk', revenue: 46250 }
];
const coordinates = sample.map((row, index) => [62 + index * 83, 190 - row.revenue / 50000 * 160]);
const line = coordinates.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');

export default function DataPreview() {
  const id = useId();
  return <figure className="product-preview" data-reveal data-reveal-delay="80" aria-label="Illustrative dashboard using sample sales data">
    <div className="preview-masthead"><span><FiBarChart2 aria-hidden="true" /> Analytics Dashboard</span><span className="sample-label">Sample workspace</span></div>
    <div className="preview-body">
      <div className="preview-sidebar" aria-hidden="true">{[[FiDatabase, 'Data'], [FiGrid, 'Dashboard'], [FiColumns, 'Table'], [FiBarChart2, 'Charts'], [FiSliders, 'Review'], [FiDownload, 'Export']].map(([Icon, label]) => <span key={label}><Icon />{label}</span>)}</div>
      <div className="preview-content">
        <div className="preview-source"><div><strong>sales_sample.csv</strong><p>6 rows · 3 columns</p></div><span>Jan–Jun 2026</span></div>
        <div className="preview-chart"><p>Monthly revenue <span>(sample data)</span></p>
          <svg viewBox="0 0 520 230" role="img" aria-labelledby={id} className="preview-trend-desktop">
            <title id={id}>Sample monthly revenue from January to June 2026, ranging from $18,500 to $46,250.</title>
            {[0, 10000, 20000, 30000, 40000, 50000].map((amount) => <g key={amount}><path d={`M62 ${190 - amount / 50000 * 160}H485`} stroke="#e4e7df" /><text x="49" y={194 - amount / 50000 * 160} textAnchor="end" fill="#62695f" fontSize="12">{amount ? `$${amount / 1000}k` : '$0'}</text></g>)}
            <path d={`${line}L477 190H62Z`} fill="#e1e9de" /><path d={line} fill="none" stroke="#245246" strokeWidth="2.5" />
            {coordinates.map(([x, y], index) => <g key={x}><circle cx={x} cy={y} r="3.5" fill="#245246" /><text x={x} y="216" textAnchor="middle" fill="#62695f" fontSize="12">{sample[index].month}</text></g>)}
          </svg>
          <svg viewBox="0 0 320 190" role="img" aria-labelledby={`${id}-mobile`} className="preview-trend-mobile">
            <title id={`${id}-mobile`}>Sample monthly revenue from January to June 2026, ranging from $18,500 to $46,250.</title>
            {[0, 25000, 50000].map((amount) => <g key={amount}><path d={`M44 ${150 - amount / 50000 * 120}H300`} stroke="#e4e7df" /><text x="37" y={154 - amount / 50000 * 120} textAnchor="end" fill="#62695f" fontSize="13">{amount ? `$${amount / 1000}k` : '$0'}</text></g>)}
            <polyline points={sample.map((row, index) => `${44 + index * 51},${150 - row.revenue / 50000 * 120}`).join(' ')} fill="none" stroke="#245246" strokeWidth="2.5" />
            {sample.map((row, index) => <g key={row.month}><circle cx={44 + index * 51} cy={150 - row.revenue / 50000 * 120} r="3.5" fill="#245246" /><text x={44 + index * 51} y="177" textAnchor="middle" fill="#62695f" fontSize="13">{row.month}</text></g>)}
          </svg>
        </div>
        <div className="preview-table"><p>Data preview <span>All 6 sample rows</span></p><table><thead><tr><th>Date</th><th>Product</th><th>Revenue</th></tr></thead><tbody>{sample.map((row) => <tr key={row.date}><td>{row.date}</td><td>{row.product}</td><td>${row.revenue.toLocaleString('en-US')}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  </figure>;
}

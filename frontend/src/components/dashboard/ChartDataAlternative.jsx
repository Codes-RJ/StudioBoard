export default function ChartDataAlternative({ rows = [], label = 'Chart values', fields = ['name', 'value'] }) {
  return <details className="mt-2 max-h-48 overflow-auto rounded-sm border border-slate-200 text-xs">
    <summary className="cursor-pointer p-2 font-semibold text-slate-800">View chart values as a table</summary>
    <table className="min-w-full text-left"><caption className="p-2 text-left">{label}. Up to 100 displayed values; numerical aggregation coverage is stated beside the chart.</caption>
      <thead><tr>{fields.map((field) => <th key={field} scope="col" className="p-2">{field}</th>)}</tr></thead>
      <tbody>{rows.slice(0, 100).map((row, index) => <tr key={index}>{fields.map((field) => <td key={field} className="break-words border-t border-slate-100 p-2">{row[field] == null ? 'Missing' : String(row[field])}</td>)}</tr>)}</tbody>
    </table>
  </details>;
}

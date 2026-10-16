/**
 * Detailed Report Generator
 * Builds a print-ready analytical report (save as PDF via the browser print
 * dialog) containing: executive summary, data quality audit, per-column
 * statistics, auto-generated analyst insights, and snapshot images of every
 * chart currently rendered on the dashboard.
 */

import { runLocalTransform } from './localTransforms';
import { capturePlotlyImage } from './plotlySnapshotRegistry';

const fmt = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString(undefined, { maximumSignificantDigits: 12 }));

/**
 * Capture rendered Recharts and Plotly charts in dashboard order.
 * Plotly image export uses the renderer already loaded for the chart.
 */
export const captureChartSnapshots = async () => {
  const wrappers = Array.from(document.querySelectorAll('.recharts-wrapper, [data-report-plotly]'));
  const snapshots = await Promise.all(wrappers.map(async (wrapper, index) => {
    let title = `Chart ${index + 1}`;

    // Prefer the card title; tooltip paragraphs can contain category labels.
    let node = wrapper.closest('[role="figure"]') || wrapper.parentElement;
    for (let depth = 0; depth < 5 && node && title === `Chart ${index + 1}`; depth++) {
      const heading = node.querySelector('[aria-label="Chart title"], h3, h4');
      const label = heading?.value || heading?.textContent;
      if (label?.trim()) {
        title = label.trim().slice(0, 80);
      }
      node = node.parentElement;
    }

    if (wrapper.hasAttribute('data-report-plotly')) {
      const image = await capturePlotlyImage(wrapper);
      return image
        ? { title, html: `<img src="${image}" alt="${escapeHtml(title)}" />` }
        : { title, html: '<p class="muted">This interactive chart could not be captured.</p>' };
    }

    const svg = wrapper.querySelector('svg');
    if (!svg) return null;

    // Serialize with explicit namespace + size so it renders standalone
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('width') || !clone.getAttribute('height')) {
      const box = svg.getBoundingClientRect();
      clone.setAttribute('width', Math.round(box.width));
      clone.setAttribute('height', Math.round(box.height));
    }
    clone.style.background = '#ffffff';

    return { title, html: clone.outerHTML };
  }));
  return snapshots.filter(Boolean);
};

const formatWorkerInsight = (insight) => {
  if (insight.kind === 'trend') {
    const percentage = insight.pctChange !== null
      ? ` (${insight.pctChange > 0 ? '+' : ''}${insight.pctChange}%)`
      : '';
    return {
      heading: `${insight.direction === 'decrease' ? 'Declining' : 'Growing'} trend detected in "${insight.primaryMetric}"${percentage}`,
      body: `Comparing the earlier ${insight.firstCount} records (${fmt(insight.firstTotal)}) with the recent ${insight.secondCount} records (${fmt(insight.secondTotal)}), ${insight.primaryMetric} shows a ${insight.direction} of ${fmt(Math.abs(insight.delta))}.${insight.topDecliner ? ` Main drag: ${insight.topDecliner}.` : ''}${insight.topGrower ? ` Main driver: ${insight.topGrower}.` : ''}`,
    };
  }
  return {
    heading: `"${insight.category}" leads ${insight.dimension} performance`,
    body: `${insight.category} accounts for ${fmt(insight.value)} of ${insight.metric} — ${insight.total ? Math.round((insight.value / insight.total) * 100) : 0}% of the total across ${insight.segmentCount} segments.`,
  };
};

const escapeHtml = (text) =>
  String(text ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);

/**
 * Generate and open the full printable report.
 * The user can then "Save as PDF" from the browser print dialog.
 */
export const generateDetailedReport = async (dataset, { signal, onProgress, reportWindow: suppliedWindow, scopeFilters = {} } = {}) => {
  if (!dataset?.rawRows?.length) {
    throw new Error('Select a dataset before generating a report.');
  }

  const reportWindow = suppliedWindow || window.open('', '_blank');
  if (!reportWindow) {
    throw new Error('Popup blocked — allow popups to generate the report.');
  }
  reportWindow.document.write('<!doctype html><title>Preparing report</title><p style="font-family:system-ui;padding:2rem">Preparing report…</p>');
  reportWindow.document.close();

  const generatedAt = new Date();
  let charts;
  let analysis;
  try {
    charts = await captureChartSnapshots();
    analysis = await runLocalTransform('report-analysis', { dataset, filters: scopeFilters }, { signal, onProgress });
  } catch (error) {
    reportWindow.close();
    throw error;
  }
  const { columns, quality, stats } = analysis;
  const { sourceRows, eligibleRows } = analysis.analysisScope;
  const insights = analysis.insights.map(formatWorkerInsight);

  const statRowsHtml = columns
    .map((col) => {
      const s = stats[col] || {};
      if (s.type === 'exact') return `<tr><td class="col-name">${escapeHtml(col)}</td><td>Exact decimal / rational</td>${['mean', 'median', 'min', 'max'].map((field) => `<td>${escapeHtml(String(s[field] ?? '—'))}</td>`).join('')}<td>—</td><td>${escapeHtml(String(s.sum ?? '—'))}</td><td>${s.missing}</td></tr>`;
      if (s.type === 'number') {
        return `<tr>
          <td class="col-name">${escapeHtml(col)}</td><td>Numeric</td>
          <td>${fmt(s.mean)}</td><td>${fmt(s.median)}</td><td>${fmt(s.min)}</td>
          <td>${fmt(s.max)}</td><td>${fmt(s.std)}</td><td>${fmt(s.sum)}</td>
          <td>${s.missing}</td></tr>`;
      }
      const top = (s.top || []).map((t) => `${escapeHtml(t.value)} (${t.count})`).join(', ');
      return `<tr>
        <td class="col-name">${escapeHtml(col)}</td><td>Categorical</td>
        <td colspan="5">${s.unique} unique · top: ${top}</td>
        <td>—</td><td>${s.missing}</td></tr>`;
    })
    .join('');

  const cleaningHtml = dataset.cleaningLog?.length
    ? `<section><h2>Cleaning &amp; Preprocessing Log</h2>
       ${dataset.cleaningLog
         .map(
           (entry, i) => `<p class="log-meta">Pass ${i + 1} — ${new Date(entry.at).toLocaleString()}</p>
           <ul>${(entry.changes || []).map((c) => `<li>${escapeHtml(c.label)}</li>`).join('')}</ul>`
         )
         .join('')}</section>`
    : '';

  const chartsHtml = charts.length
    ? `<section><h2>Dashboard Charts</h2><div class="charts">
       ${charts.map((c) => `<figure><figcaption>${escapeHtml(c.title)}</figcaption><div class="chart-box">${c.html}</div></figure>`).join('')}
       </div></section>`
    : '<section><h2>Dashboard Charts</h2><p class="muted">No rendered charts were available to capture.</p></section>';

  const insightsHtml = insights.length
    ? insights.map((i) => `<div class="insight"><h3>${escapeHtml(i.heading)}</h3><p>${escapeHtml(i.body)}</p></div>`).join('')
    : '<p class="muted">Not enough structured data for automatic narrative insights.</p>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Analytics Report — ${escapeHtml(dataset.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #0f172a; padding: 40px; max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 26px; letter-spacing: -0.02em; }
  h2 { font-size: 17px; text-transform: uppercase; letter-spacing: 0.12em; color: #2563eb; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin: 32px 0 14px; }
  h3 { font-size: 14px; margin-bottom: 4px; }
  p { line-height: 1.55; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0f172a; padding-bottom: 16px; }
  .meta { text-align: right; font-size: 12px; color: #64748b; line-height: 1.6; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 18px; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; background: #f8fafc; }
  .kpi .v { font-size: 22px; font-weight: 800; }
  .kpi .l { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #0f172a; color: white; text-align: left; padding: 7px 9px; font-weight: 600; }
  td { border-bottom: 1px solid #e2e8f0; padding: 6px 9px; }
  td.col-name { font-weight: 700; }
  tr:nth-child(even) td { background: #f8fafc; }
  .insight { border-left: 4px solid #2563eb; background: #eff6ff; border-radius: 0 10px 10px 0; padding: 12px 16px; margin-bottom: 12px; }
  .insight p { font-size: 13px; color: #334155; }
  .quality-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
  .qitem { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 13px; }
  .qitem.ok { border-color: #a7f3d0; background: #ecfdf5; }
  .qitem.bad { border-color: #fecaca; background: #fef2f2; }
  ul.log-list, section ul { margin: 6px 0 0 20px; font-size: 13px; }
  .log-meta { font-size: 11px; color: #64748b; margin-top: 8px; font-weight: 600; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  figure { break-inside: avoid; }
  figcaption { font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 6px; }
  .chart-box { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; background: white; }
  .chart-box img { display: block; width: 100%; height: auto; }
  .footer { margin-top: 36px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
  .muted { color: #94a3b8; font-size: 13px; }
  @media print { body { padding: 20px; } .charts { grid-template-columns: 1fr; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <p style="font-size:11px;font-weight:700;letter-spacing:.25em;color:#2563eb;text-transform:uppercase;">Analytics Dashboard Report</p>
      <h1>${escapeHtml(dataset.name)}</h1>
    </div>
    <div class="meta">
      Generated ${generatedAt.toLocaleString()}<br/>
      ${eligibleRows.toLocaleString()} eligible rows of ${sourceRows.toLocaleString()} source rows · ${columns.length} columns<br/>
      Scope: ${escapeHtml(JSON.stringify(scopeFilters))}<br/>
      Health score ${quality.qualityScore}/100
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="v">${fmt(eligibleRows)}</div><div class="l">Total Rows</div></div>
    <div class="kpi"><div class="v">${columns.length}</div><div class="l">Columns</div></div>
    <div class="kpi"><div class="v">${quality.qualityScore}%</div><div class="l">Data Health</div></div>
    <div class="kpi"><div class="v">${fmt(quality.missingCells)}</div><div class="l">Missing Cells</div></div>
    <div class="kpi"><div class="v">${fmt(quality.duplicateRows)}</div><div class="l">Duplicates Found</div></div>
  </div>

  <section><h2>Executive Insights</h2>${insightsHtml}</section>

  <section><h2>Data Quality Audit</h2>
    <div class="quality-grid">
      <div class="qitem ${quality.missingCells ? 'bad' : 'ok'}">Missing cells: <strong>${fmt(quality.missingCells)}</strong></div>
      <div class="qitem ${quality.duplicateRows ? 'bad' : 'ok'}">Duplicate rows: <strong>${fmt(quality.duplicateRows)}</strong></div>
      <div class="qitem ${quality.emptyRows ? 'bad' : 'ok'}">Empty rows: <strong>${fmt(quality.emptyRows)}</strong></div>
      <div class="qitem ${quality.whitespaceCells ? 'bad' : 'ok'}">Whitespace issues: <strong>${fmt(quality.whitespaceCells)}</strong></div>
      <div class="qitem ${quality.emptyColumns.length ? 'bad' : 'ok'}">Empty columns: <strong>${quality.emptyColumns.length}</strong></div>
      <div class="qitem ${quality.mixedTypeColumns.length ? 'bad' : 'ok'}">Mixed-type columns: <strong>${quality.mixedTypeColumns.join(', ') || 'none'}</strong></div>
    </div>
  </section>

  ${cleaningHtml}

  <section><h2>Column Statistics</h2>
    <table><thead><tr>
      <th>Column</th><th>Type</th><th>Mean</th><th>Median</th><th>Min</th><th>Max</th><th>Std Dev</th><th>Sum</th><th>Missing</th>
    </tr></thead><tbody>${statRowsHtml}</tbody></table>
  </section>

  ${chartsHtml}

  <div class="footer">
    <span>Generated locally in-browser — no data left this machine.</span>
    <span>Analytics Dashboard · ${generatedAt.toISOString().slice(0, 10)}</span>
  </div>
<script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };<\/script>
</body>
</html>`;

  reportWindow.document.open();
  reportWindow.document.write(html);
  reportWindow.document.close();
  return true;
};

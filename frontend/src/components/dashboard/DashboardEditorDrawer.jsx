import { useMemo, useRef, useState } from 'react';
import useModalFocus from '../../hooks/useModalFocus';
import {
  FiBarChart2,
  FiChevronDown,
  FiChevronUp,
  FiCopy,
  FiEye,
  FiMove,
  FiPlus,
  FiRefreshCcw,
  FiSettings,
  FiTrash2,
  FiX
} from 'react-icons/fi';
import { CHART_TYPE_OPTIONS } from '../../utils/chartCatalog';
import { getDatasetColumnGroups, getGraphTypeCompatibility } from '../../utils/graphConfiguration';
import { getChartSizeConstraints } from '../../utils/layoutModel';
import ChartTypePreview from './ChartTypePreview';

const TEMPLATE_DETAILS = {
  line: ['Trend', 'Track change over time'],
  stepLine: ['Discrete trend', 'Show state changes and intervals'],
  spline: ['Smooth trend', 'Draw a flowing interpolated curve'],
  smoothArea: ['Smooth volume', 'Fill beneath a flowing trend curve'],
  multiSpline: ['Grouped curves', 'Compare smooth curves across groups'],
  streamgraph: ['Flowing composition', 'Show grouped values as layered waves'],
  rangeArea: ['Confidence range', 'Show lower and upper bounds as a band'],
  waveform: ['Live signal', 'Track ordered or live-refreshing measurements'],
  sineWave: ['Generated wave', 'Transform numeric input into a normalized sine curve'],
  area: ['Volume trend', 'Emphasize magnitude over time'],
  bar: ['Comparison', 'Compare categories clearly'],
  horizontalBar: ['Ranked comparison', 'Compare long category labels'],
  stackedBar: ['Composition', 'Compare grouped category totals'],
  pie: ['Composition', 'Show a small part-to-whole split'],
  donut: ['Composition', 'Show part-to-whole with a central total'],
  scatter: ['Relationship', 'Compare two numeric measures'],
  bubble: ['3 variables', 'Encode a third measure as bubble size'],
  heatmap: ['Correlation', 'Scan relationships across metrics'],
  density: ['2D distribution', 'Reveal concentrations and clusters'],
  contour: ['Response surface', 'Show equal-value bands across X and Y'],
  histogram: ['Distribution', 'Inspect frequency and skew'],
  box: ['Statistical spread', 'Compare quartiles and outliers'],
  violin: ['Distribution shape', 'Compare density and spread'],
  strip: ['Observations', 'See individual values by group'],
  ecdf: ['Cumulative distribution', 'Compare percentiles without bins'],
  radar: ['Profile', 'Compare measures around a radial axis'],
  polarScatter: ['Polar relationship', 'Plot radius against angle or category'],
  radialBar: ['Radial ranking', 'Compare categories around a circle'],
  scatter3d: ['3D relationship', 'Explore three numeric dimensions'],
  surface3d: ['3D surface', 'Explore a gridded response surface'],
  mesh3d: ['3D geometry', 'Connect observations into a surface mesh'],
  bubble4d: ['4D relationship', 'Encode X, Y, Z, and bubble size'],
  parallelCoordinates: ['Multivariate', 'Compare many numeric dimensions'],
  candlestick: ['OHLC', 'Inspect open, high, low, and close values'],
  waterfall: ['Contributions', 'Show sequential positive and negative changes'],
  gauge: ['Single metric', 'Show progress against a range'],
  funnel: ['Conversion', 'Show drop-off across stages'],
  treemap: ['Hierarchy', 'Compare nested proportions'],
  sunburst: ['Hierarchy', 'Explore parent and child proportions'],
  sankey: ['Flow', 'Show movement between categories'],
  kpi: ['Headline metric', 'Highlight one aggregated value'],
  table: ['Detailed rows', 'Preview records and columns']
};

function CardSizeControls({ card, onResize }) {
  const constraints = getChartSizeConstraints(card.chartType);
  const buttonClassName = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35';

  return (
    <fieldset className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
      <legend className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Card size</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-auto min-w-24 text-xs font-semibold text-slate-700" aria-live="polite">{card.w} columns × {card.h} rows</span>
        <button type="button" disabled={card.w <= constraints.minW} onClick={() => onResize?.(card.i, -1, 0)} className={buttonClassName} aria-label={`Make ${card.title} narrower`}>Narrower</button>
        <button type="button" disabled={card.w >= constraints.maxW} onClick={() => onResize?.(card.i, 1, 0)} className={buttonClassName} aria-label={`Make ${card.title} wider`}>Wider</button>
        <button type="button" disabled={card.h <= constraints.minH} onClick={() => onResize?.(card.i, 0, -1)} className={buttonClassName} aria-label={`Make ${card.title} shorter`}>Shorter</button>
        <button type="button" disabled={card.h >= constraints.maxH} onClick={() => onResize?.(card.i, 0, 1)} className={buttonClassName} aria-label={`Make ${card.title} taller`}>Taller</button>
      </div>
    </fieldset>
  );
}

export default function DashboardEditorDrawer({
  open,
  currentLayout,
  dataset,
  onClose,
  returnFocusRef,
  onAddGraph,
  onViewCard,
  onConfigureCard,
  onDuplicateCard,
  onResetCard,
  onRemoveCard,
  onMoveCard,
  onResizeCard,
  onResetDashboard,
  onSave,
  onCancel
}) {
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const [graphQuery, setGraphQuery] = useState('');
  const columnGroups = useMemo(() => getDatasetColumnGroups(dataset), [dataset]);
  const visibleGraphTypes = useMemo(() => {
    const query = graphQuery.trim().toLowerCase();
    if (!query) return CHART_TYPE_OPTIONS;
    return CHART_TYPE_OPTIONS.filter(({ value, label, category }) => {
      const [purpose, description] = TEMPLATE_DETAILS[value] || [];
      return [label, category, purpose, description].some((text) => String(text || '').toLowerCase().includes(query));
    });
  }, [graphQuery]);

  useModalFocus(dialogRef, { open, onClose, initialFocusRef: closeButtonRef, returnFocusRef });

  if (!open) return null;
  const cards = currentLayout?.layout || [];

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-slate-950/35 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-editor-title"
        className="flex h-full w-full max-w-xl flex-col bg-slate-50 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-600">Layout tools</p>
            <h2 id="dashboard-editor-title" className="mt-1 font-serif text-2xl font-normal tracking-tight text-slate-950">Edit dashboard</h2>
            <p className="mt-1 text-sm text-slate-600">Add a graph or manage the cards already on the canvas.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
            aria-label="Close dashboard editor"
          >
            <FiX />
          </button>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto p-5">
          <section aria-labelledby="graph-gallery-title">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h3 id="graph-gallery-title" className="font-semibold text-slate-950">Graph gallery</h3>
                <p className="text-xs text-slate-500">New graphs use the first open grid position.</p>
              </div>
              <FiBarChart2 className="text-xl text-indigo-600" aria-hidden="true" />
            </div>
            <label className="mb-3 block text-xs font-semibold text-slate-600">
              Search graph types
              <input
                type="search"
                value={graphQuery}
                onChange={(event) => setGraphQuery(event.target.value)}
                placeholder="Try 3D, statistical, polar…"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-hidden focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visibleGraphTypes.map(({ value, label, category }) => {
                const [purpose, description] = TEMPLATE_DETAILS[value] || [label, 'Add a new graph'];
                const compatibility = getGraphTypeCompatibility(value, columnGroups);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onAddGraph(value)}
                    disabled={!compatibility.compatible}
                    className="group min-h-28 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-slate-200 disabled:hover:shadow-xs"
                    aria-label={`Add ${label} graph`}
                    title={compatibility.reason || `Add ${label} graph`}
                  >
                    <span className="mb-2 block overflow-hidden rounded-lg bg-slate-50 p-1 transition group-hover:bg-indigo-50">
                      <ChartTypePreview type={value} />
                    </span>
                    <span className="block text-sm font-semibold text-slate-900">{label}</span>
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-indigo-600">{category} · {purpose}</span>
                    <span className="mt-1 block text-xs leading-4 text-slate-500">{description}</span>
                    {!compatibility.compatible && <span className="mt-2 block text-[11px] font-semibold leading-4 text-amber-700">{compatibility.reason}</span>}
                  </button>
                );
              })}
              {visibleGraphTypes.length === 0 && (
                <p className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-500">No graph types match that search.</p>
              )}
            </div>
          </section>

          <section aria-labelledby="dashboard-card-list-title">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 id="dashboard-card-list-title" className="font-semibold text-slate-950">Dashboard cards</h3>
                <p className="text-xs text-slate-500">{cards.length} {cards.length === 1 ? 'card' : 'cards'} in this layout</p>
              </div>
              <button type="button" onClick={() => onAddGraph('line')} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
                <FiPlus /> Add graph
              </button>
            </div>

            {cards.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                Choose a graph template to start this dashboard.
              </div>
            ) : (
              <ol className="space-y-2">
                {cards.map((card, index) => (
                  <li key={card.i} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
                    <div className="flex items-start gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-50 text-xs font-bold text-indigo-700">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{card.title}</p>
                        <p className="mt-0.5 text-xs capitalize text-slate-500">{card.chartType} · {card.w}×{card.h}</p>
                      </div>
                      <button type="button" onClick={() => onViewCard(card.i)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label={`View ${card.title}`} title="View on dashboard">
                        <FiEye />
                      </button>
                    </div>
                    <CardSizeControls card={card} onResize={onResizeCard} />
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                      <button type="button" disabled={index === 0} onClick={() => onMoveCard?.(card.i, -1)} className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30" aria-label={`Move ${card.title} earlier`}><FiChevronUp /></button>
                      <button type="button" disabled={index === cards.length - 1} onClick={() => onMoveCard?.(card.i, 1)} className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30" aria-label={`Move ${card.title} later`}><FiChevronDown /></button>
                      <button type="button" onClick={() => onConfigureCard(card.i)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100" aria-label={`Configure ${card.title}`}><FiSettings /> Configure</button>
                      <button type="button" onClick={() => onDuplicateCard(card.i)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100" aria-label={`Duplicate ${card.title}`}><FiCopy /> Duplicate</button>
                      <button type="button" onClick={() => onResetCard(card.i)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100" aria-label={`Reset ${card.title}`}><FiRefreshCcw /> Reset</button>
                      <button type="button" onClick={() => onRemoveCard(card.i)} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50" aria-label={`Delete ${card.title}`}><FiTrash2 /> Delete</button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-xs leading-5 text-indigo-900">
            <FiMove className="shrink-0 text-base" aria-hidden="true" />
            Close this drawer and use each card's move handle to rearrange the grid. Every action can be undone.
          </div>
          <button type="button" onClick={onResetDashboard} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">
            <FiRefreshCcw /> Reset entire dashboard
          </button>
        </div>
        {(onSave || onCancel) && (
          <footer className="flex gap-3 border-t border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {onCancel && <button type="button" onClick={onCancel} className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel changes</button>}
            {onSave && <button type="button" onClick={onSave} className="min-h-11 flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Save dashboard</button>}
          </footer>
        )}
      </aside>
    </div>
  );
}

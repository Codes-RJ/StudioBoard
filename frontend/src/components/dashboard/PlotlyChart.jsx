import { useEffect, useRef, useState } from 'react';
import { registerPlotlyRenderer, unregisterPlotlyRenderer } from '../../utils/plotlySnapshotRegistry';

const plotlyModulePromises = new Map();
const plotlyLoaders = {
  cartesian: () => import('plotly.js-cartesian-dist-min'),
  gl3d: () => import('plotly.js-gl3d-dist-min'),
  finance: () => import('plotly.js-finance-dist-min'),
  full: () => import('plotly.js-dist-min')
};

const loadPlotly = (renderer) => {
  if (!plotlyModulePromises.has(renderer)) {
    const modulePromise = (plotlyLoaders[renderer] || plotlyLoaders.full)();
    plotlyModulePromises.set(renderer, modulePromise.then((module) => module.default || module));
  }
  return plotlyModulePromises.get(renderer);
};

export default function PlotlyChart({ traces, layout = {}, renderer = 'full', ariaLabel = 'Interactive chart' }) {
  const containerRef = useRef(null);
  const plotlyRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const element = containerRef.current;

    const render = async () => {
      try {
        const Plotly = await loadPlotly(renderer);
        if (cancelled || !containerRef.current) return;
        if (plotlyRef.current && plotlyRef.current !== Plotly && containerRef.current.data) {
          plotlyRef.current.purge(containerRef.current);
        }
        plotlyRef.current = Plotly;
        await Plotly.react(containerRef.current, traces, {
          autosize: true,
          margin: { l: 48, r: 24, t: 24, b: 48 },
          paper_bgcolor: 'rgba(0,0,0,0)',
          plot_bgcolor: 'rgba(248,250,252,0.65)',
          font: { family: 'Inter, ui-sans-serif, system-ui, sans-serif', color: '#334155', size: 11 },
          hoverlabel: { bgcolor: '#0f172a', font: { color: '#ffffff' } },
          ...layout
        }, {
          responsive: true,
          displaylogo: false,
          scrollZoom: true,
          modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d'],
          toImageButtonOptions: { format: 'png', filename: 'analytics-chart', scale: 2 }
        });
        if (!cancelled) {
          registerPlotlyRenderer(element, Plotly);
          setError('');
        }
      } catch (renderError) {
        if (!cancelled) setError(renderError?.message || 'The interactive renderer could not be loaded.');
      }
    };

    void render();
    return () => {
      cancelled = true;
      if (element) unregisterPlotlyRenderer(element);
    };
  }, [layout, renderer, traces]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    let disposed = false;
    const canResize = () => !disposed && element.isConnected && element.data && element.clientWidth > 0 && element.clientHeight > 0;
    const resize = async () => {
      if (!plotlyRef.current || !canResize()) return;
      try {
        await plotlyRef.current.Plots.resize(element);
      } catch (resizeError) {
        // Source switches can hide/remove a plot while its resize is pending.
        // A failure for a still-visible chart remains an actionable error.
        if (canResize()) setError(resizeError?.message || 'The interactive chart could not be resized.');
      }
    };
    const observer = new ResizeObserver(() => { void resize(); });
    observer.observe(element);
    return () => { disposed = true; observer.disconnect(); };
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    return () => {
      if (plotlyRef.current && element) plotlyRef.current.purge(element);
    };
  }, []);

  if (error) {
    return <div className="flex h-full items-center justify-center px-5 text-center text-sm font-semibold text-rose-700">{error}</div>;
  }

  return <div ref={containerRef} data-report-plotly className="h-full min-h-0 w-full" role="img" aria-label={ariaLabel} />;
}

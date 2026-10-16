import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlotlyChart from '../PlotlyChart';

const plotly = vi.hoisted(() => ({ react: vi.fn(), purge: vi.fn(), Plots: { resize: vi.fn() } }));
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: plotly }));
vi.mock('../../../utils/plotlySnapshotRegistry', () => ({ registerPlotlyRenderer: vi.fn(), unregisterPlotlyRenderer: vi.fn() }));
let resizeCallback;
afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  plotly.react.mockImplementation(async (element, traces) => { element.data = traces; });
  plotly.Plots.resize.mockResolvedValue(undefined);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { resizeCallback = callback; }
    observe() {}
    disconnect() {}
  });
});

const mountChart = async () => {
  const view = render(<PlotlyChart renderer="cartesian" traces={[{ x: [1], y: [2] }]} />);
  await waitFor(() => expect(plotly.react).toHaveBeenCalled());
  const element = view.container.querySelector('[data-report-plotly]');
  let visible = true;
  Object.defineProperties(element, {
    clientWidth: { get: () => visible ? 640 : 0 },
    clientHeight: { get: () => visible ? 320 : 0 }
  });
  return { ...view, hide: () => { visible = false; } };
};

describe('Plotly resize lifecycle', () => {
  it('does not resize a chart after it becomes hidden', async () => {
    const view = await mountChart();
    view.hide();
    await act(async () => resizeCallback());
    expect(plotly.Plots.resize).not.toHaveBeenCalled();
  });

  it('handles an in-flight resize rejection after a dataset switch unmounts the chart', async () => {
    const view = await mountChart();
    let rejectResize;
    plotly.Plots.resize.mockReturnValue(new Promise((resolve, reject) => { rejectResize = reject; }));
    await act(async () => resizeCallback());
    expect(plotly.Plots.resize).toHaveBeenCalledOnce();
    view.unmount();
    expect(plotly.purge).toHaveBeenCalledOnce();
    await act(async () => rejectResize(new Error('Resize must be passed a displayed plot div element.')));
  });

  it('keeps an active renderer failure visible instead of silently ignoring it', async () => {
    await mountChart();
    plotly.Plots.resize.mockRejectedValue(new Error('The interactive renderer could not resize.'));
    await act(async () => resizeCallback());
    expect(screen.getByText('The interactive renderer could not resize.')).toBeInTheDocument();
  });

  it('continues resizing a visible chart', async () => {
    await mountChart();
    await act(async () => resizeCallback());
    expect(plotly.Plots.resize).toHaveBeenCalledOnce();
  });
});

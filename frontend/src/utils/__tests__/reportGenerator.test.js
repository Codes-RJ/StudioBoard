import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureChartSnapshots, generateDetailedReport } from '../reportGenerator';
import { registerPlotlyRenderer, unregisterPlotlyRenderer } from '../plotlySnapshotRegistry';
import { runLocalTransform } from '../localTransforms';

vi.mock('../localTransforms', () => ({ runLocalTransform: vi.fn() }));

afterEach(() => {
  document.querySelectorAll('[data-report-plotly]').forEach(unregisterPlotlyRenderer);
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('captureChartSnapshots', () => {
  it('uses the edited chart title even when a tooltip contains a category name', async () => {
    document.body.innerHTML = '<div role="figure"><input aria-label="Chart title" value="Revenue by Region" /><div><div class="recharts-wrapper"><p>West</p><svg width="400" height="300"></svg></div></div></div>';
    expect((await captureChartSnapshots())[0].title).toBe('Revenue by Region');
  });
  it('includes Recharts and Plotly charts in dashboard order', async () => {
    document.body.innerHTML = `
      <article><h3>Revenue</h3><div class="recharts-wrapper"><svg width="400" height="300"><path d="M0 0" /></svg></div></article>
      <article><h3>Revenue by region</h3><div data-report-plotly></div></article>
    `;
    const plotlyElement = document.querySelector('[data-report-plotly]');
    plotlyElement.data = [{}];
    const toImage = vi.fn().mockResolvedValue('data:image/png;base64,AAAA');
    registerPlotlyRenderer(plotlyElement, { toImage });

    const snapshots = await captureChartSnapshots();

    expect(snapshots.map(({ title }) => title)).toEqual(['Revenue', 'Revenue by region']);
    expect(snapshots[0].html).toContain('<svg');
    expect(snapshots[1].html).toContain('data:image/png;base64,AAAA');
    expect(toImage).toHaveBeenCalledWith(plotlyElement, expect.objectContaining({ format: 'png' }));
  });

  it('keeps a visible placeholder when an interactive chart cannot be exported', async () => {
    document.body.innerHTML = '<article><h3>3D chart</h3><div data-report-plotly></div></article>';
    const plotlyElement = document.querySelector('[data-report-plotly]');
    plotlyElement.data = [{}];
    registerPlotlyRenderer(plotlyElement, { toImage: vi.fn().mockRejectedValue(new Error('export failed')) });

    const snapshots = await captureChartSnapshots();

    expect(snapshots).toEqual([{ title: '3D chart', html: '<p class="muted">This interactive chart could not be captured.</p>' }]);
  });
});

describe('generateDetailedReport', () => {
  it('fills the window opened by the click handler without opening another popup', async () => {
    runLocalTransform.mockResolvedValue({
      analysisScope: { sourceRows: 1, eligibleRows: 1 },
      columns: ['revenue'],
      quality: {
        qualityScore: 100, missingCells: 0, duplicateRows: 0, emptyRows: 0,
        whitespaceCells: 0, emptyColumns: [], mixedTypeColumns: [],
      },
      stats: { revenue: { type: 'number', mean: 12, median: 12, min: 12, max: 12, std: 0, sum: 12, missing: 0 } },
      insights: [],
    });
    const openPopup = vi.spyOn(window, 'open');
    const reportWindow = {
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
      close: vi.fn(),
    };

    await generateDetailedReport({ name: 'Local sales', rawRows: [{ revenue: 12 }] }, { reportWindow });

    expect(openPopup).not.toHaveBeenCalled();
    expect(reportWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('<h1>Local sales</h1>'));
    expect(reportWindow.close).not.toHaveBeenCalled();
  });
  it('passes the original saved source and filters to the worker and renders returned scope counts', async () => {
    const dataset = { name: 'Filtered source', rawRows: [{ region: 'West' }, { region: 'East' }] };
    runLocalTransform.mockResolvedValue({ columns: ['region'], stats: {}, insights: [], analysisScope: { sourceRows: 2, eligibleRows: 1 },
      quality: { qualityScore: 100, missingCells: 0, duplicateRows: 0, emptyRows: 0, whitespaceCells: 0, emptyColumns: [], mixedTypeColumns: [] } });
    const reportWindow = { document: { open: vi.fn(), write: vi.fn(), close: vi.fn() }, close: vi.fn() };
    await generateDetailedReport(dataset, { reportWindow, scopeFilters: { region: 'East' } });
    expect(runLocalTransform).toHaveBeenCalledWith('report-analysis', { dataset, filters: { region: 'East' } }, expect.any(Object));
    expect(runLocalTransform.mock.calls.at(-1)[1].dataset).toBe(dataset);
    expect(reportWindow.document.write).toHaveBeenLastCalledWith(expect.stringContaining('1 eligible rows of 2 source rows'));
  });
  it('closes the preparing report window when an exact report exceeds its memory policy', async () => {
    runLocalTransform.mockRejectedValue(new Error('Exact report numbers exceeds its working-memory limit.'));
    const reportWindow = { document: { write: vi.fn(), close: vi.fn() }, close: vi.fn() };
    await expect(generateDetailedReport({ rawRows: [{ value: 1 }] }, { reportWindow })).rejects.toThrow('working-memory limit');
    expect(reportWindow.close).toHaveBeenCalledOnce();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChartPanel from '../ChartPanel';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  getLocalData: vi.fn(),
  setGlobalFilter: vi.fn(),
  onConfigChange: vi.fn()
}));

vi.mock('../../../services/api', () => ({ default: { get: mocks.apiGet } }));
vi.mock('../../../context/DashboardContext', () => ({
  useDashboard: () => ({
    getLocalData: mocks.getLocalData,
    setGlobalFilter: mocks.setGlobalFilter
  })
}));

const columnNames = Array.from({ length: 10 }, (_, index) => `Column ${index + 1}`);
const rows = Array.from({ length: 7 }, (_, rowIndex) => Object.fromEntries(
  columnNames.map((column, columnIndex) => [column, `row-${rowIndex + 1}-value-${columnIndex + 1}`])
));
const dataset = {
  id: 'local-table',
  isLocal: true,
  rawRows: rows,
  rowCount: rows.length,
  columns: columnNames.map((name) => ({ name, type: 'string' }))
};

describe('ChartPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    mocks.getLocalData.mockImplementation((_datasetId, { page, limit }) => ({
      data: rows.slice((page - 1) * limit, page * limit),
      total: rows.length,
      page,
      limit
    }));
    mocks.apiGet.mockImplementation((_url, { params }) => Promise.resolve({
      data: {
        data: rows.slice((params.page - 1) * params.limit, params.page * params.limit),
        total: rows.length,
        page: params.page,
        limit: params.limit,
        columns: columnNames
      }
    }));
  });

  it('pages through the full dataset and exposes every column', async () => {
    render(
      <ChartPanel
        id="table-card"
        title="All records"
        chartType="table"
        gridWidth={8}
        gridHeight={4}
        dataset={dataset}
        topN={3}
        showControls={false}
      />
    );

    expect(await screen.findByText('Rows 1–3 of 7')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Column 10' })).toBeVisible();
    expect(screen.getByText('row-1-value-1')).toBeVisible();
    expect(screen.queryByText('row-4-value-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next table page' }));
    await waitFor(() => expect(screen.getByText('Rows 4–6 of 7')).toBeVisible());
    expect(screen.getByText('row-4-value-1')).toBeVisible();
    expect(mocks.getLocalData).toHaveBeenLastCalledWith('local-table', expect.objectContaining({ page: 2, limit: 3 }));

    fireEvent.click(screen.getByRole('button', { name: 'Last table page' }));
    await waitFor(() => expect(screen.getByText('Rows 7–7 of 7')).toBeVisible());
    expect(screen.getByText('row-7-value-10')).toBeVisible();
  });

  it('requests later pages from the server instead of capping the table at 500 rows', async () => {
    render(
      <ChartPanel
        id="remote-table-card"
        title="Remote records"
        chartType="table"
        gridWidth={8}
        gridHeight={4}
        dataset={{ ...dataset, id: 'remote-table', isLocal: false, rawRows: undefined }}
        topN={3}
        showControls={false}
      />
    );

    expect(await screen.findByText('Rows 1–3 of 7')).toBeVisible();
    expect(mocks.apiGet).toHaveBeenLastCalledWith('/datasets/remote-table/data', expect.objectContaining({
      params: expect.objectContaining({ page: 1, limit: 3 })
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Next table page' }));
    await waitFor(() => expect(screen.getByText('row-4-value-1')).toBeVisible());
    expect(mocks.apiGet).toHaveBeenLastCalledWith('/datasets/remote-table/data', expect.objectContaining({
      params: expect.objectContaining({ page: 2, limit: 3 })
    }));
  });

  it('preserves an assistant-provided dimension and metric through the first data load', async () => {
    const chartRows = [
      { Month: '2026-01', Plan: 'Starter', MRR: 210 },
      { Month: '2026-02', Plan: 'Starter', MRR: 175 },
      { Month: '2026-01', Plan: 'Pro', MRR: 348 },
      { Month: '2026-01', Plan: 'Enterprise', MRR: 319 }
    ];
    const chartDataset = {
      id: 'assistant-chart',
      isLocal: true,
      rawRows: chartRows,
      columns: [
        { name: 'Month', type: 'date' },
        { name: 'Plan', type: 'string' },
        { name: 'MRR', type: 'number' }
      ]
    };
    mocks.getLocalData.mockReturnValue({ data: chartRows, total: chartRows.length, page: 1, limit: 180 });

    render(
      <ChartPanel
        id="assistant-card"
        title="Total MRR by Plan"
        chartType="bar"
        gridWidth={6}
        gridHeight={4}
        dataset={chartDataset}
        preferredX="Plan"
        preferredY="MRR"
        aggregation="sum"
        showControls={false}
        onConfigChange={mocks.onConfigChange}
      />
    );

    await waitFor(() => expect(mocks.getLocalData).toHaveBeenCalled());
    expect(await screen.findByRole('figure', { name: /Total MRR by Plan\. bar chart showing MRR by Plan, using sum, across 4 loaded rows\. Leading values: Starter 385, Pro 348, Enterprise 319/i })).toBeVisible();
    expect(mocks.onConfigChange).not.toHaveBeenCalled();
  });
});

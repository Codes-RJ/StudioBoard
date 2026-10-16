import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AskDataAssistant from '../AskDataAssistant';

const mocks = vi.hoisted(() => ({
  ask: vi.fn(),
  applyLayoutChange: vi.fn(),
  undoLayoutChange: vi.fn(),
  setGlobalFilter: vi.fn(),
  onCardAdded: vi.fn(),
  currentLayout: null,
  globalFilters: null
}));

vi.mock('../../../utils/aiQueryClient', () => ({ askDatasetQuestion: mocks.ask, cancelAssistantWork: vi.fn() }));
vi.mock('../../../context/DashboardContext', () => ({
  useDashboard: () => ({
    currentLayout: mocks.currentLayout,
    applyLayoutChange: mocks.applyLayoutChange,
    undoLayoutChange: mocks.undoLayoutChange,
    setGlobalFilter: mocks.setGlobalFilter,
    globalFilters: mocks.globalFilters
  })
}));

const dataset = {
  id: 'sales',
  updatedAt: '2026-01-01',
  columns: [{ name: 'Region', type: 'string' }, { name: 'Revenue', type: 'number' }],
  metrics: { columnGroups: { all: ['Region', 'Revenue'], numeric: ['Revenue'], categorical: ['Region'], date: [], dimensions: ['Region'], measures: ['Revenue'] } },
  rawRows: [{ Region: 'East', Revenue: 100 }, { Region: 'West', Revenue: 80 }]
};

describe('AskDataAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentLayout = {
      id: 'layout-1',
      name: 'Dashboard',
      layout: [{ i: '1', x: 0, y: 0, w: 4, h: 3, title: 'Existing', chartType: 'bar', preferredX: 'Region', preferredY: 'Revenue', aggregation: 'sum' }]
    };
    mocks.globalFilters = { Region: 'East' };
    mocks.applyLayoutChange.mockImplementation((layout) => { mocks.currentLayout = layout; });
  });

  it('waits for conversation restoration before accepting a question', async () => {
    mocks.ask.mockResolvedValue({ directAnswer: 'Ready.' });
    render(<AskDataAssistant dataset={dataset} />);
    const ask = screen.getByRole('button', { name: /^ask$/i });
    expect(ask).toBeDisabled();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Analyze Revenue' } });
    fireEvent.submit(input.closest('form'));
    expect(mocks.ask).not.toHaveBeenCalled();
    await waitFor(() => expect(ask).toBeEnabled());
    fireEvent.click(ask);
    expect(await screen.findByText('Ready.')).toBeInTheDocument();
  });

  it('previews a supported layout, cancels without mutation, and applies through layout history', async () => {
    mocks.ask.mockResolvedValue({ directAnswer: 'Verified Revenue: 100.', layoutProposal: { title: 'Revenue overview', density: 'compact',
      cards: [{ i: 'agent_1', x: 0, y: 0, w: 6, h: 3, title: 'Revenue by Region', chartType: 'bar', preferredX: 'Region', preferredY: 'Revenue', aggregation: 'sum', evidenceId: 'calculation:1' }] },
      computations: [{ evidenceId: 'calculation:1', eligibleRows: 1, missingRows: 0, results: [{ group: 'East', value: 100 }] }] });
    render(<AskDataAssistant dataset={dataset} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^ask$/i })).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Build a compact Revenue dashboard' } });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Preview proposed layout' }));
    expect(await screen.findByRole('dialog', { name: 'Revenue overview' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(mocks.applyLayoutChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview proposed layout' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply reviewed layout' }));
    expect(mocks.applyLayoutChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'layout-1', name: 'Revenue overview', layout: [expect.objectContaining({ title: 'Revenue by Region' })] }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows interpretation details and adds a new validated chart', async () => {
    mocks.ask.mockResolvedValue({
      intent: 'RANKING',
      directAnswer: 'East leads.',
      keyInsights: ['East: 100'],
      confidence: 0.91,
      assumptions: [],
      interpretation: { metrics: ['Revenue'], dimensions: ['Region'], filters: [], aggregation: 'sum', matchedRows: 2 },
      recommendedCard: { title: 'Revenue by Region', chartType: 'bar', preferredX: 'Region', preferredY: 'Revenue', aggregation: 'sum' }
    });
    render(<AskDataAssistant dataset={dataset} onCardAdded={mocks.onCardAdded} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^ask$/i })).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Top regions by revenue' } });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByText('East leads.')).toBeInTheDocument();
    expect(screen.getByText('1 dashboard filter applied')).toBeInTheDocument();
    expect(mocks.ask.mock.calls[0][2].scopeFilters).toEqual({ Region: 'East' });
    expect(screen.getByText(/91% confidence/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add bar chart: revenue by region/i }));
    const nextLayout = mocks.applyLayoutChange.mock.calls[0][0];
    expect(nextLayout.layout).toHaveLength(2);
    expect(nextLayout.layout[0].title).toBe('Existing');
    expect(nextLayout.layout[1]).toMatchObject({ title: 'Revenue by Region', preferredX: 'Region', preferredY: 'Revenue' });
    expect(mocks.onCardAdded).toHaveBeenCalledWith(nextLayout.layout[1].i);
    expect(screen.getByRole('button', { name: /view added chart/i })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /view added chart/i }));
    expect(mocks.applyLayoutChange).toHaveBeenCalledTimes(1);
    expect(mocks.onCardAdded).toHaveBeenCalledTimes(2);
  });

  it('aborts in-flight work when the user cancels', async () => {
    let capturedSignal;
    mocks.ask.mockImplementation((_query, _dataset, { signal }) => {
      capturedSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))));
    });
    render(<AskDataAssistant dataset={dataset} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^ask$/i })).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Analyze revenue' } });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(capturedSignal.aborted).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: /^ask$/i })).toBeEnabled());
  });

  it('allows another question after a failed owned request and omits experimental diagnostics in release', async () => {
    let fail;
    mocks.ask.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
      .mockResolvedValueOnce({ directAnswer: 'Recovered answer.' });
    render(<AskDataAssistant dataset={dataset} />);
    const ask = screen.getByRole('button', { name: /^ask$/i });
    await waitFor(() => expect(ask).toBeEnabled());
    expect(ask).not.toHaveAttribute('data-assistant-lifecycle');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First question' } });
    fireEvent.click(ask);
    expect(ask).toBeDisabled();
    fail(new Error('Fixture question deadline reached.'));
    expect(await screen.findByText('Fixture question deadline reached.')).toBeVisible();
    await waitFor(() => expect(ask).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Second question' } });
    fireEvent.click(ask);
    expect(await screen.findByText('Recovered answer.')).toBeVisible();
    await waitFor(() => expect(ask).toBeEnabled());
  });

  it('passes the previous interpretation to a conversational follow-up', async () => {
    const interpretation = { intent: 'RANKING', metrics: ['Revenue'], dimensions: ['Region'], aggregation: 'sum' };
    mocks.ask
      .mockResolvedValueOnce({ intent: 'RANKING', directAnswer: 'East leads.', keyInsights: [], confidence: 0.9, assumptions: [], interpretation })
      .mockResolvedValueOnce({ intent: 'RANKING', directAnswer: 'West only.', keyInsights: [], confidence: 0.9, assumptions: [], interpretation });
    render(<AskDataAssistant dataset={dataset} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^ask$/i })).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Top regions' } });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    await screen.findByText('East leads.');
    await waitFor(() => expect(screen.getByRole('button', { name: /^ask$/i })).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Now only West' } });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    await screen.findByText('West only.');
    expect(mocks.ask.mock.calls[1][2].context).toEqual(interpretation);
  });

  it('offers a large, categorized library of dataset-specific questions', async () => {
    mocks.ask.mockResolvedValue({
      intent: 'DATASET_SUMMARY', directAnswer: 'Two rows.', keyInsights: [], confidence: 0.95,
      assumptions: [], interpretation: { metrics: [], dimensions: [], filters: [], aggregation: 'sum', matchedRows: 2 }
    });
    render(<AskDataAssistant dataset={dataset} />);

    expect(screen.getByText(/browse \d+ examples/i)).toHaveTextContent('44 examples');
    expect(screen.getByText('Understand the data')).toBeInTheDocument();
    expect(screen.getByText('Quality and structure')).toBeInTheDocument();
    expect(screen.getByText('Metrics and distributions')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /^ask$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Explain this dataset' }));

    await waitFor(() => expect(mocks.ask).toHaveBeenCalledWith(
      'Explain this dataset', dataset, expect.objectContaining({ scopeFilters: { Region: 'East' } })
    ));
  });

  it('truthfully disables local analysis for a server-only dataset', () => {
    render(<AskDataAssistant dataset={{ ...dataset, isLocal: false, rawRows: undefined }} />);
    expect(screen.getByRole('heading', { name: 'Local Data Assistant unavailable' })).toBeVisible();
    expect(screen.getByText(/server-only datasets are not sent/i)).toBeVisible();
    expect(screen.queryByRole('textbox', { name: /ask a question/i })).not.toBeInTheDocument();
  });

  it('removes stale answers and chart actions when dashboard filters change', async () => {
    mocks.ask.mockResolvedValue({
      intent: 'RANKING', directAnswer: 'East leads.', keyInsights: [], confidence: 0.9,
      assumptions: [], interpretation: { metrics: ['Revenue'], dimensions: ['Region'], filters: [], aggregation: 'sum', matchedRows: 1 },
      recommendedCard: { title: 'Revenue by Region', chartType: 'bar', preferredX: 'Region', preferredY: 'Revenue', aggregation: 'sum' }
    });
    const { rerender } = render(<AskDataAssistant dataset={dataset} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^ask$/i })).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Top region' } });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    await screen.findByText('East leads.');

    mocks.globalFilters = { Region: 'West' };
    rerender(<AskDataAssistant dataset={dataset} />);
    await waitFor(() => expect(screen.queryByText('East leads.')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /add bar chart/i })).not.toBeInTheDocument();
  });
});

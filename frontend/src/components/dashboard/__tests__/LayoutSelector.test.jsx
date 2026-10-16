import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Optional remote-AI lifecycle belongs only to the legacy server edition.
vi.hoisted(() => vi.resetModules());
vi.mock('../../../config/workspace', () => ({ SERVER_WORKSPACE_ENABLED: true }));

const { dashboard, api } = vi.hoisted(() => ({ dashboard: { value: null }, api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../../context/DashboardContext', () => ({ useDashboard: () => dashboard.value }));
vi.mock('../../../context/SiteSettingsContext', () => ({ useSiteSettings: () => ({ settings: { features: { aiLayoutSuggestions: 'enabled' } } }) }));
vi.mock('../../../services/api', () => ({ default: api }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
import LayoutSelector from '../LayoutSelector';

const dataset = { id: 'sales', name: 'Sales', isLocal: true, columns: [{ name: 'Region', type: 'string' }, { name: 'Revenue', type: 'number' }], rawRows: [{ Region: 'West', Revenue: 10 }, { Region: 'East', Revenue: 20 }] };
const aiProposal = { title: 'Late AI proposal', summary: 'Compare sales.', cards: [{ title: 'Sales by region', chartType: 'bar', xField: 'Region', yField: 'Revenue', aggregation: 'sum' }] };
const openReview = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Smart Layout' }));
  await screen.findByRole('dialog');
  await screen.findByRole('checkbox');
  await waitFor(() => expect(screen.queryByText('Building and validating dashboard options…')).not.toBeInTheDocument());
};

describe('layout suggestion request lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboard.value = { layouts: [], currentLayout: null, selectedDataset: dataset, confirmDiscardLayoutChanges: () => true, selectLayout: vi.fn() };
    api.get.mockResolvedValue({ data: { available: true } });
  });

  it('requires a new opt-in and ignores an AI response for a previous goal', async () => {
    let resolveOld;
    api.post.mockImplementation(() => new Promise((resolve) => { resolveOld = resolve; }));
    render(<LayoutSelector />);
    await openReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Request AI layout ideas' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Analysis goal'), { target: { value: 'comparisons' } });
    expect(api.post.mock.calls[0][2].signal.aborted).toBe(true);
    await act(async () => resolveOld({ data: aiProposal }));
    expect(screen.queryByRole('heading', { name: 'Late AI proposal' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request AI layout ideas' })).toBeDisabled();
  });

  it('closes the review and ignores an outstanding AI response when the dataset changes', async () => {
    let resolveOld;
    api.post.mockImplementation(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(<LayoutSelector />);
    await openReview();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Request AI layout ideas' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    dashboard.value = { ...dashboard.value, selectedDataset: { ...dataset, id: 'new-sales' } };
    rerender(<LayoutSelector />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.post.mock.calls[0][2].signal.aborted).toBe(true);
    await act(async () => resolveOld({ data: aiProposal }));
    await openReview();
    expect(screen.queryByRole('heading', { name: 'Late AI proposal' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});

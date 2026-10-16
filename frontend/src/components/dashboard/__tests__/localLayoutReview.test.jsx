import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => vi.resetModules());
import LayoutSelector from '../LayoutSelector';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const dataset = vi.hoisted(() => ({ id: 'private', isLocal: true, columns: [{ name: 'Region', type: 'string' }, { name: 'Revenue', type: 'number' }], rawRows: [{ Region: 'West', Revenue: 10 }] }));
vi.mock('../../../services/api', () => ({ default: api }));
vi.mock('../../../context/SiteSettingsContext', () => ({ useSiteSettings: () => ({ settings: { features: { aiLayoutSuggestions: 'authenticated' } } }) }));
vi.mock('../../../context/DashboardContext', () => ({ useDashboard: () => ({
  layouts: [], currentLayout: null, confirmDiscardLayoutChanges: () => true,
  selectedDataset: dataset,
}) }));

describe('local layout privacy boundary', () => {
  it('ignores remote AI settings and exposes only the local planner', async () => {
    render(<LayoutSelector />);
    fireEvent.click(screen.getByRole('button', { name: 'Smart Layout' }));
    await screen.findByText(/These recommendations are calculated on your device/);
    await waitFor(() => expect(screen.getAllByText(/Score \d+\/100/).length).toBeGreaterThan(0));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request AI layout ideas' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});

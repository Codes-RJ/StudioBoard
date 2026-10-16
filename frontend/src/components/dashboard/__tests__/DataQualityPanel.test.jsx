import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanDatasetRows, replayCleaningRecipe, summarizeCleaningPreview } from '../../../utils/dataCleaner';
import { profileDataset } from '../../../utils/datasetProfiler';

const { updateLocalDataset, commitLocalDataset, runLocalTransform } = vi.hoisted(() => ({
  updateLocalDataset: vi.fn(),
  commitLocalDataset: vi.fn(),
  runLocalTransform: vi.fn()
}));

vi.mock('../../../utils/localTransforms', () => ({ runLocalTransform }));
vi.mock('../../../context/DashboardContext', () => ({ useDashboard: () => ({ updateLocalDataset, commitLocalDataset }) }));
vi.mock('../../../context/OperationStatusContext', () => ({
  useOperationStatus: () => ({
    startOperation: () => ({ update: vi.fn(), succeed: vi.fn(), fail: vi.fn() })
  })
}));

import DataQualityPanel from '../DataQualityPanel';

const quality = {
  qualityScore: 70,
  missingCells: 1,
  duplicateRows: 1,
  emptyRows: 0,
  whitespaceCells: 1,
  emptyColumns: [],
  mixedTypeColumns: [],
  missingByColumn: { Name: 0, Revenue: 1 },
  hasIssues: true,
  totalIssues: 3
};

const makeDataset = () => ({
  id: 'local-cleaning',
  name: 'Sales',
  isLocal: true,
  rowCount: 3,
  columns: [{ name: 'Name', type: 'string' }, { name: 'Revenue', type: 'number' }],
  rawRows: [
    { Name: ' A ', Revenue: 10 },
    { Name: 'A', Revenue: 10 },
    { Name: 'B', Revenue: '' }
  ]
});

describe('DataQualityPanel cleaning workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commitLocalDataset.mockImplementation(async (dataset) => updateLocalDataset(dataset));
    runLocalTransform.mockImplementation((operation, payload) => {
      if (operation === 'quality-profile') return Promise.resolve({ quality, profile: profileDataset(payload.dataset) });
      if (operation === 'clean-preview') {
        const cleaned = cleanDatasetRows(payload.rows, payload.columns, payload.options);
        const columns = cleaned.columns.slice(0, 6);
        return Promise.resolve({
          changes: cleaned.changes,
          columns,
          sampleRows: cleaned.rawRows.slice(0, 3).map((row) => Object.fromEntries(columns.map((column) => [column, row[column]]))),
          summary: summarizeCleaningPreview(payload.rows, payload.columns, cleaned)
        });
      }
      if (operation === 'replay-cleaning-recipe') return Promise.resolve(replayCleaningRecipe(payload.rows, payload.columns, payload.recipe));
      throw new Error(`Unexpected transform: ${operation}`);
    });
  });

  it('keeps review open and analysis unapproved when saving fails', async () => {
    commitLocalDataset.mockRejectedValueOnce(new Error('Local storage is full.'));
    const onClose = vi.fn();
    render(<DataQualityPanel dataset={makeDataset()} requiredReview onClose={onClose} />);
    await screen.findByText(/Rows removed/);
    fireEvent.click(screen.getByRole('button', { name: 'Approve Data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Local storage is full.');
    expect(updateLocalDataset).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('allows an explicit no-change review and saves its revision approval', async () => {
    const dataset = makeDataset();
    dataset.rawRows[0].Name = 'A';
    const onClose = vi.fn();
    render(<DataQualityPanel dataset={dataset} requiredReview onClose={onClose} />);
    await screen.findByText('No changes with these options.');
    expect(screen.queryByRole('button', { name: 'Remove empty rows' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Data' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(commitLocalDataset.mock.calls[0][0].qualityReview.rows).toBe(3);
  });

  it('retains small decimal means when approving and saving reviewed data', async () => {
    const dataset = makeDataset();
    dataset.rawRows[0].Revenue = 0.0001;
    dataset.rawRows[1].Revenue = 0.0002;
    render(<DataQualityPanel dataset={dataset} requiredReview onClose={vi.fn()} />);
    await screen.findByText(/Rows removed/);
    fireEvent.click(screen.getByRole('button', { name: 'Approve Data' }));
    await waitFor(() => expect(commitLocalDataset).toHaveBeenCalledTimes(1));
    const saved = commitLocalDataset.mock.calls[0][0];
    expect(saved.metrics.primaryMean).toBe((0.0001 + 0.0002) / 2);
    expect(saved.rawRows.map((row) => row.Revenue)).toEqual([0.0001, 0.0002, '']);
    expect(saved.qualityReview.rows).toBe(3);
  });

  it('previews, applies a reversible recipe, preserves missing measures, and supports undo', async () => {
    const source = makeDataset();
    const { rerender } = render(<DataQualityPanel dataset={source} onClose={vi.fn()} />);

    expect(await screen.findByText(/Rows removed/)).toBeInTheDocument();
    expect(screen.getByText(/Rows before/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Apply Preview/ }));

    await waitFor(() => expect(updateLocalDataset).toHaveBeenCalledTimes(1));
    const cleaned = updateLocalDataset.mock.calls[0][0];
    expect(cleaned.sourceRows).toEqual(source.rawRows);
    expect(cleaned.cleaningRecipe).toHaveLength(1);
    expect(cleaned.rawRows).toEqual([{ Name: 'A', Revenue: 10 }, { Name: 'A', Revenue: 10 }, { Name: 'B', Revenue: '' }]);
    expect(cleaned.cleaningLog[0]).toMatchObject({ beforeRows: 3, afterRows: 3 });
    expect(cleaned.metrics.primaryMean).toBe(10);

    rerender(<DataQualityPanel dataset={cleaned} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Undo last step/ }));
    await waitFor(() => expect(updateLocalDataset).toHaveBeenCalledTimes(2));
    expect(updateLocalDataset.mock.calls[1][0].rawRows).toEqual(source.rawRows);
    expect(updateLocalDataset.mock.calls[1][0].cleaningRecipe).toBeUndefined();
  });

  it('resets the full recipe to the original imported rows', async () => {
    const source = makeDataset();
    const options = { trimWhitespace: true, removeDuplicates: true, removeEmptyRows: true, dropEmptyColumns: true, missingNumeric: 'keep', missingCategorical: 'keep' };
    const cleaned = {
      ...source,
      rawRows: [{ Name: 'A', Revenue: 10 }, { Name: 'B', Revenue: '' }],
      rowCount: 2,
      sourceRows: source.rawRows,
      sourceColumns: source.columns,
      cleaningRecipe: [options],
      cleaningLog: [{ at: '2026-09-30T00:00:00.000Z', beforeRows: 3, afterRows: 2, options, changes: [] }]
    };
    render(<DataQualityPanel dataset={cleaned} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Reset to imported data/ }));
    await waitFor(() => expect(updateLocalDataset).toHaveBeenCalledTimes(1));
    expect(updateLocalDataset.mock.calls[0][0].rawRows).toEqual(source.rawRows);
    expect(updateLocalDataset.mock.calls[0][0].cleaningLog).toBeUndefined();
  });

  it('persists a corrected role and updates chartable column groups', async () => {
    render(<DataQualityPanel dataset={makeDataset()} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Revenue analysis role'), { target: { value: 'identifier' } });
    await waitFor(() => expect(updateLocalDataset).toHaveBeenCalledTimes(1));
    const updated = updateLocalDataset.mock.calls[0][0];
    expect(updated.columnOverrides.Revenue).toEqual({ type: 'number', role: 'identifier' });
    expect(updated.metrics.columnGroups.numeric).not.toContain('Revenue');
    expect(updated.metrics.columnGroups.measures).not.toContain('Revenue');
  });

  it('applies detected identifier roles to dashboard groups only after an explicit action', async () => {
    const dataset = makeDataset();
    dataset.columns = [...dataset.columns, { name: 'customer_id', type: 'string' }];
    dataset.rawRows = dataset.rawRows.map((row, index) => ({ ...row, customer_id: `c${index + 1}` }));
    render(<DataQualityPanel dataset={dataset} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Use detected types and roles/ }));
    await waitFor(() => expect(updateLocalDataset).toHaveBeenCalledTimes(1));
    const updated = updateLocalDataset.mock.calls[0][0];
    expect(updated.columnOverrides.customer_id).toEqual({ type: 'string', role: 'identifier' });
    expect(updated.metrics.columnGroups.dimensions).not.toContain('customer_id');
  });
});

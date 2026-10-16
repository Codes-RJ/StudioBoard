import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runLocalTransform } = vi.hoisted(() => ({ runLocalTransform: vi.fn() }));
vi.mock('../../../utils/localTransforms', () => ({ runLocalTransform }));

import FolderOverviewPanel from '../FolderOverviewPanel';
import { approveQualityRevision, qualityRevisionKey } from '../../../utils/qualityReview';
import { analyzeApprovedRelationship } from '../../../utils/crossDatasetAnalysis';

const makeWorkspace = () => {
  const left = { id: 'left', folderId: 'folder_1', updatedAt: 'v1', sourcePath: 'Job/a.csv', rowCount: 1, columns: [{ name: 'Customer ID' }, { name: 'Region' }], rawRows: [{ 'Customer ID': 'a', Region: 'West' }] };
  const right = { id: 'right', folderId: 'folder_1', updatedAt: 'v1', sourcePath: 'Job/b.csv', rowCount: 1, columns: [{ name: 'Customer ID' }, { name: 'Amount', type: 'number' }], rawRows: [{ 'Customer ID': 'a', Amount: 10 }] };
  const relationship = { id: 'rel-1', leftDatasetId: left.id, rightDatasetId: right.id, leftUpdatedAt: 'v1', rightUpdatedAt: 'v1', leftLabel: 'Job/a.csv', leftColumn: 'Customer ID', rightLabel: 'Job/b.csv', rightColumn: 'Customer ID', status: 'approved', cardinality: 'one-to-one', leftUnique: true, rightUnique: true, matchedDistinct: 1, leftJoinRows: 1, leftRows: 1, leftUnmatchedRows: 0, rightUnmatchedRows: 0, expansionRows: 0 };
  const overview = { id: 'overview', folderId: 'folder_1', folderName: 'Job', isFolderOverview: true, sourceFileCount: 2, totalSourceRows: 2, relationships: [relationship] };
  return { overview, left, right, relationship, datasets: [overview, left, right] };
};
const analysisResult = { aggregation: 'count', metric: 'joined rows', sources: ['Job/a.csv', 'Job/b.csv'], matchedRows: 1, filteredRows: 1, filters: [], warnings: [], results: [{ group: 'calculation-result', value: 1, rowCount: 1 }] };

describe('FolderOverviewPanel', () => {
  beforeEach(() => { runLocalTransform.mockReset(); });
  it.each([
    ['sum', ['9007199254740993'], '9007199254740993'],
    ['sum', ['0.1', '0.2'], '0.3'],
    ['average', ['0.1', '0.2'], '0.15'],
    ['average', ['1', '0', '0'], '1/3'],
  ])('renders reviewed exact %s results for %j through Run analysis', async (aggregation, values, expected) => {
    const workspace = makeWorkspace();
    const left = approveQualityRevision({ ...workspace.left, isLocal: true });
    const right = approveQualityRevision({ ...workspace.right, isLocal: true, rowCount: values.length,
      columnOverrides: { Amount: { role: 'measure', precision: 'exact' } },
      rawRows: values.map((Amount) => ({ 'Customer ID': 'a', Amount })) });
    const overview = { ...workspace.overview, relationships: [{ ...workspace.relationship,
      leftRevisionKey: qualityRevisionKey(left), rightRevisionKey: qualityRevisionKey(right) }] };
    runLocalTransform.mockImplementation(async (operation, payload) => analyzeApprovedRelationship(payload));
    render(<FolderOverviewPanel dataset={overview} datasets={[overview, left, right]} onSelect={vi.fn()} onUpdate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Calculation'), { target: { value: aggregation } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(runLocalTransform.mock.calls[0][1].datasets[1].columnOverrides.Amount.precision).toBe('exact');
  });
  it('keeps approval revisions in actual worker calculations and rediscovery', async () => {
    const workspace = makeWorkspace();
    workspace.left = approveQualityRevision({ ...workspace.left, isLocal: true, revision: 'left-r1' });
    workspace.right = approveQualityRevision({ ...workspace.right, isLocal: true, revision: 'right-r1' });
    const approved = { ...workspace.relationship, leftRevisionKey: qualityRevisionKey(workspace.left), rightRevisionKey: qualityRevisionKey(workspace.right) };
    workspace.overview.relationships = [approved];
    const onUpdate = vi.fn();
    runLocalTransform.mockImplementation(async (operation, payload) => operation === 'analyze-approved-relationship'
      ? analyzeApprovedRelationship(payload) : [{ ...workspace.relationship, status: 'suggested' }]);
    render(<FolderOverviewPanel dataset={workspace.overview} datasets={[workspace.overview, workspace.left, workspace.right]} onSelect={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    await waitFor(() => expect(screen.queryByText(/unavailable or stale|requires review/i)).not.toBeInTheDocument());
    expect(runLocalTransform.mock.calls[0][1].datasets[0].revision).toBe('left-r1');
    const result = await runLocalTransform.mock.results[0].value;
    expect(result.matchedRows).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Review possible relationships' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate.mock.calls[0][0].relationships[0]).toMatchObject({ status: 'approved', leftRevisionKey: approved.leftRevisionKey });
  });
  it('opens a nested source dataset and offers a path back to the overview', () => {
    const overview = { id: 'overview', folderId: 'folder_1', folderName: 'Job', isFolderOverview: true, sourceFileCount: 1, totalSourceRows: 2 };
    const source = { id: 'source', folderId: 'folder_1', folderName: 'Job', sourcePath: 'Job/West/sales.csv', rowCount: 2, columns: [{ name: 'Revenue' }] };
    const onSelect = vi.fn();
    const { rerender } = render(<FolderOverviewPanel dataset={overview} datasets={[overview, source]} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /Job\/West\/sales.csv/i }));
    expect(onSelect).toHaveBeenCalledWith(source);

    rerender(<FolderOverviewPanel dataset={source} datasets={[overview, source]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to folder overview' }));
    expect(onSelect).toHaveBeenCalledWith(overview);
  });

  it('requires explicit approval for a locally discovered relationship', async () => {
    const overview = { id: 'overview', folderId: 'folder_1', folderName: 'Job', isFolderOverview: true, sourceFileCount: 2, totalSourceRows: 2 };
    const left = { id: 'left', folderId: 'folder_1', sourcePath: 'Job/a.csv', rowCount: 1, columns: [{ name: 'Customer ID' }] };
    const right = { id: 'right', folderId: 'folder_1', sourcePath: 'Job/b.csv', rowCount: 1, columns: [{ name: 'Customer ID' }] };
    const onUpdate = vi.fn();
    runLocalTransform.mockResolvedValue([{ ...makeWorkspace().relationship, leftUpdatedAt: null, rightUpdatedAt: null, status: 'suggested' }]);
    const { rerender } = render(<FolderOverviewPanel dataset={overview} datasets={[overview, left, right]} onSelect={vi.fn()} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Review possible relationships' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const reviewed = onUpdate.mock.calls[0][0];
    expect(reviewed.relationships[0].status).toBe('suggested');
    rerender(<FolderOverviewPanel dataset={reviewed} datasets={[reviewed, left, right]} onSelect={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve relationship' }));
    expect(onUpdate.mock.calls.at(-1)[0].relationships[0].status).toBe('approved');
  });

  it('clears results and discards an old calculation when the selection changes', async () => {
    const workspace = makeWorkspace();
    let resolveOld;
    runLocalTransform.mockResolvedValueOnce(analysisResult).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    render(<FolderOverviewPanel dataset={workspace.overview} datasets={workspace.datasets} onSelect={vi.fn()} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(await screen.findByText('calculation-result')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'left::Region' } });
    expect(runLocalTransform.mock.calls[1][2].signal.aborted).toBe(true);
    await act(async () => resolveOld(analysisResult));
    expect(screen.queryByText('calculation-result')).not.toBeInTheDocument();
  });

  it('invalidates displayed results and requires fresh evidence when a source changes', async () => {
    const workspace = makeWorkspace();
    runLocalTransform.mockResolvedValue(analysisResult);
    const { rerender } = render(<FolderOverviewPanel dataset={workspace.overview} datasets={workspace.datasets} onSelect={vi.fn()} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(await screen.findByText('calculation-result')).toBeInTheDocument();
    rerender(<FolderOverviewPanel dataset={workspace.overview} datasets={[workspace.overview, { ...workspace.left, updatedAt: 'v2' }, workspace.right]} onSelect={vi.fn()} onUpdate={vi.fn()} />);
    expect(screen.queryByText('calculation-result')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve relationship' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Run analysis' })).not.toBeInTheDocument();
  });

  it('does not overwrite a folder overview with discovery results from old sources', async () => {
    const workspace = makeWorkspace();
    const onUpdate = vi.fn();
    let resolveOld;
    runLocalTransform.mockImplementation(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(<FolderOverviewPanel dataset={workspace.overview} datasets={workspace.datasets} onSelect={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review possible relationships' }));
    rerender(<FolderOverviewPanel dataset={workspace.overview} datasets={[workspace.overview, { ...workspace.left, updatedAt: 'v2' }, workspace.right]} onSelect={vi.fn()} onUpdate={onUpdate} />);
    await act(async () => resolveOld([workspace.relationship]));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('shows unavailable numeric results without presenting them as zero', async () => {
    const workspace = makeWorkspace();
    runLocalTransform.mockResolvedValue({ ...analysisResult, aggregation: 'average', results: [{ group: 'West', value: null, rowCount: 1 }] });
    render(<FolderOverviewPanel dataset={workspace.overview} datasets={workspace.datasets} onSelect={vi.fn()} onUpdate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Calculation'), { target: { value: 'average' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(await screen.findByText('No numeric values')).toBeInTheDocument();
    expect(runLocalTransform.mock.calls[0][1]).toMatchObject({ metric: 'right::Amount', aggregation: 'average' });
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import WorkspaceBackupControls from '../WorkspaceBackupControls';
import { serializeWorkspaceBackup } from '../../../utils/workspaceBackup';
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => vi.restoreAllMocks());

const mocks = vi.hoisted(() => ({
  restoreLocalWorkspace: vi.fn(),
  confirmDiscardLayoutChanges: vi.fn(() => true),
  startOperation: vi.fn(() => ({ update: vi.fn(), succeed: vi.fn(), fail: vi.fn() }))
}));

vi.mock('../../../context/DashboardContext', () => ({
  useDashboard: () => ({
    selectedDataset: null,
    currentLayout: null,
    globalFilters: {},
    restoreLocalWorkspace: mocks.restoreLocalWorkspace,
    confirmDiscardLayoutChanges: mocks.confirmDiscardLayoutChanges
  })
}));
vi.mock('../../../context/OperationStatusContext', () => ({
  useOperationStatus: () => ({ startOperation: mocks.startOperation })
}));

describe('WorkspaceBackupControls', () => {
  it('cancels a pending restore without applying its workspace', async () => {
    mocks.restoreLocalWorkspace.mockClear();
    const backup = await import('../../../utils/workspaceBackup'); let signal;
    vi.spyOn(backup, 'readWorkspaceBackup').mockImplementation((file, options) => {
      signal = options.signal;
      return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      });
    });
    render(<WorkspaceBackupControls palette="blue" onPaletteChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Choose workspace backup'), { target: { files: [new File(['fixture'], 'fixture.workspace.jsonl')] } });
    await waitFor(() => expect(signal).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel restore' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel restore' })).not.toBeInTheDocument());
    expect(signal.aborted).toBe(true); expect(mocks.restoreLocalWorkspace).not.toHaveBeenCalled();
  });
  it('restores a backup through the local workspace action', async () => {
    const dataset = {
      id: 'local_original', name: 'Sales', isLocal: true, rowCount: 1,
      columns: [{ name: 'Revenue', type: 'number' }], rawRows: [{ Revenue: 12 }]
    };
    const layout = {
      id: 'layout_original', name: 'Sales layout', source: 'planner',
      layout: [{ i: '1', x: 0, y: 0, w: 4, h: 3, chartType: 'bar' }]
    };
    const content = serializeWorkspaceBackup({ dataset, layout, filters: { Revenue: '12' }, palette: 'blue' });
    const file = new File([content], 'sales.workspace.json', { type: 'application/json' });
    file.text = async () => content;
    const onPaletteChange = vi.fn();
    render(<WorkspaceBackupControls palette="blue" onPaletteChange={onPaletteChange} />);

    fireEvent.change(screen.getByLabelText('Choose workspace backup'), { target: { files: [file] } });

    await waitFor(() => expect(mocks.restoreLocalWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      dataset: expect.objectContaining({ isLocal: true, rowCount: 1 }),
      layout: expect.objectContaining({ localOnly: true }),
      filters: { Revenue: '12' }
    })));
    expect(onPaletteChange).toHaveBeenCalledWith('blue');
  });
});

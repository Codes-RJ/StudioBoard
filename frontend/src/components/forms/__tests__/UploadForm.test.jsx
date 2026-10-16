import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import UploadForm from '../UploadForm';

const mocks = vi.hoisted(() => ({
  addLocalDatasets: vi.fn(),
  addLocalDataset: vi.fn(),
  startOperation: vi.fn(() => ({ update: vi.fn(), succeed: vi.fn(), fail: vi.fn() })),
}));

vi.mock('../../../context/DashboardContext', () => ({
  useDashboard: () => ({ addLocalDatasets: mocks.addLocalDatasets, addLocalDataset: mocks.addLocalDataset }),
}));
vi.mock('../../../context/SiteSettingsContext', () => ({
  useSiteSettings: () => ({ settings: { features: { localUpload: true, urlImport: false } } }),
}));
vi.mock('../../../context/OperationStatusContext', () => ({
  useOperationStatus: () => ({ startOperation: mocks.startOperation }),
}));

describe('UploadForm folder import', () => {
  it('imports a selected folder as an overview and source datasets', async () => {
    globalThis.indexedDB = new IDBFactory(); localStorage.clear();
    const file = new File(['Revenue\n10\n'], 'sales.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Job/West/sales.csv' });
    render(<MemoryRouter><UploadForm /></MemoryRouter>);

    const picker = screen.getByLabelText('Choose a folder of data files');
    expect(picker).toHaveAttribute('webkitdirectory');
    fireEvent.change(picker, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /analyze whole folder/i }));

    await waitFor(() => expect(mocks.addLocalDatasets).toHaveBeenCalledOnce());
    const [datasets, selected, options] = mocks.addLocalDatasets.mock.calls[0];
    expect(options).toEqual({ persisted: true });
    expect(datasets.every((dataset) => dataset.metadataOnly)).toBe(true);
    expect(datasets).toHaveLength(2);
    expect(selected.isFolderOverview).toBe(true);
    expect(datasets[1].sourcePath).toBe('Job/West/sales.csv');
    expect(mocks.startOperation.mock.results[0].value.succeed).toHaveBeenCalled();
  });
});

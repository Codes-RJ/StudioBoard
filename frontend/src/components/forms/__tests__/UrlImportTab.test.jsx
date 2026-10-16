import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReadableStream } from 'node:stream/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UrlImportTab from '../UrlImportTab';

const mocks = vi.hoisted(() => ({
  addLocalDatasets: vi.fn(), navigate: vi.fn(), importWorkspace: vi.fn(),
  operations: [],
  startOperation: vi.fn(),
}));
vi.mock('../../../context/DashboardContext', () => ({ useDashboard: () => ({ addLocalDatasets: mocks.addLocalDatasets }) }));
vi.mock('../../../context/OperationStatusContext', () => ({ useOperationStatus: () => ({ startOperation: mocks.startOperation }) }));
vi.mock('../../../utils/folderImport', () => ({ importLocalFileWorkspace: (...args) => mocks.importWorkspace(...args) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));

const bytes = new TextEncoder().encode('value\n1\n');
const responseFor = (reader, headers = {}) => ({
  ok: true, headers: { get: (key) => headers[key] || null },
  body: { getReader: () => reader },
});
const stalledReader = () => ({ read: vi.fn(() => new Promise(() => {})), cancel: vi.fn().mockResolvedValue(), releaseLock: vi.fn() });
const flush = async () => { await act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }); };
const start = async () => {
  fireEvent.change(screen.getByLabelText('Public CSV or Google Sheets URL'), { target: { value: 'https://example.test/data.csv' } });
  fireEvent.click(screen.getByRole('button', { name: /Import & Visualize/i }));
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.operations.length = 0;
  mocks.startOperation.mockImplementation(() => {
    const operation = { update: vi.fn(), succeed: vi.fn(), fail: vi.fn(), cancel: vi.fn() };
    mocks.operations.push(operation); return operation;
  });
  mocks.importWorkspace.mockResolvedValue({ datasets: [{ id: 'fixture' }], selected: { id: 'fixture', rowCount: 1 } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('URL import body lifetime', () => {
  it('times out an indefinitely stalled body even after successful headers', async () => {
    const reader = stalledReader();
    const fetchMock = vi.fn().mockResolvedValue(responseFor(reader)); vi.stubGlobal('fetch', fetchMock);
    render(<UrlImportTab />); await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    expect(mocks.operations[0].fail).toHaveBeenCalledWith(expect.stringMatching(/timed out/i));
    expect(screen.queryByRole('button', { name: 'Cancel import' })).not.toBeInTheDocument();
    expect(mocks.importWorkspace).not.toHaveBeenCalled();
  });

  it('keeps a single whole-body deadline during a slow stream', async () => {
    let release;
    const reader = stalledReader(); reader.read.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFor(reader)));
    render(<UrlImportTab />); await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(19_000); release({ done: false, value: bytes }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(mocks.operations[0].fail).toHaveBeenCalledWith(expect.stringMatching(/timed out/i));
    expect(reader.cancel).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'unmount'])('cancels a pending reader on %s and never publishes it', async (action) => {
    const reader = stalledReader(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFor(reader)));
    const { unmount } = render(<UrlImportTab />); await start();
    if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    else unmount();
    await flush();
    expect(reader.cancel).toHaveBeenCalledOnce(); expect(reader.releaseLock).toHaveBeenCalledOnce();
    expect(mocks.addLocalDatasets).not.toHaveBeenCalled(); expect(mocks.navigate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('prevents sample clicks from starting another request during an active import', async () => {
    const reader = stalledReader(); const fetchMock = vi.fn().mockResolvedValue(responseFor(reader)); vi.stubGlobal('fetch', fetchMock);
    render(<UrlImportTab />); await start();
    const samples = screen.getAllByRole('button', { name: /Google Sheet Demo|GitHub Raw CSV/i });
    samples.forEach((button) => { expect(button).toBeDisabled(); fireEvent.click(button); });
    await flush(); expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' })); await flush();
    expect(reader.cancel).toHaveBeenCalledOnce();
  });

  it('cleans the completed reader and deadline, then publishes one import', async () => {
    const reader = stalledReader(); reader.read.mockResolvedValueOnce({ done: false, value: bytes }).mockResolvedValueOnce({ done: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFor(reader)));
    render(<UrlImportTab />); await start();
    expect(reader.releaseLock).toHaveBeenCalledOnce(); expect(reader.cancel).not.toHaveBeenCalled();
    expect(mocks.addLocalDatasets).toHaveBeenCalledOnce(); expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['header', 'body'])('retains byte limits and cleans rejected %s responses', async (boundary) => {
    const reader = stalledReader(); reader.read.mockResolvedValue({ done: false, value: { byteLength: 100 * 1024 * 1024 + 1 } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFor(reader, boundary === 'header' ? { 'content-length': String(100 * 1024 * 1024 + 1) } : {})));
    render(<UrlImportTab />); await start();
    expect(mocks.operations[0].fail).toHaveBeenCalledWith(expect.stringMatching(/100 MB/));
    expect(mocks.addLocalDatasets).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    if (boundary === 'body') { expect(reader.cancel).toHaveBeenCalledOnce(); expect(reader.releaseLock).toHaveBeenCalledOnce(); }
  });

  it('bounds the response.blob fallback when there is no readable stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => null }, body: null, blob: () => new Promise(() => {}) }));
    render(<UrlImportTab />); await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(mocks.operations[0].fail).toHaveBeenCalledWith(expect.stringMatching(/timed out/i));
    expect(mocks.addLocalDatasets).not.toHaveBeenCalled();
  });

  it('cancels and unlocks an actual readable stream with a pending read', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: { get: () => null }, body }));
    render(<UrlImportTab />); await start();
    expect(body.locked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' })); await flush();
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
    expect(mocks.operations[0].cancel).toHaveBeenCalledOnce();
  });

  it('retains cancellation during parsing and ignores a late parser result', async () => {
    let finish;
    mocks.importWorkspace.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const reader = stalledReader(); reader.read.mockResolvedValueOnce({ done: false, value: bytes }).mockResolvedValueOnce({ done: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFor(reader)));
    render(<UrlImportTab />); await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(mocks.importWorkspace.mock.calls[0][1].signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    await act(async () => { finish({ datasets: [], selected: { rowCount: 1 } }); });
    expect(mocks.addLocalDatasets).not.toHaveBeenCalled(); expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.operations[0].cancel).toHaveBeenCalledOnce();
  });

  it('serializes sample requests even when two clicks occur before a render', async () => {
    const reader = stalledReader(); const fetchMock = vi.fn().mockResolvedValue(responseFor(reader)); vi.stubGlobal('fetch', fetchMock);
    render(<UrlImportTab />);
    const samples = screen.getAllByRole('button', { name: /Google Sheet Demo|GitHub Raw CSV/i });
    act(() => { fireEvent.click(samples[0]); fireEvent.click(samples[1]); });
    await flush(); expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' })); await flush();
  });
});

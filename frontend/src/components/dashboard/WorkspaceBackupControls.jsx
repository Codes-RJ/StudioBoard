import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { FiDownload, FiUpload } from 'react-icons/fi';
import { useDashboard } from '../../context/DashboardContext';
import { useOperationStatus } from '../../context/OperationStatusContext';
const BackupPassphraseDialog = lazy(() => import('./BackupPassphraseDialog'));

export default function WorkspaceBackupControls({ palette, onPaletteChange }) {
  const { selectedDataset, currentLayout, datasets, layouts, globalFilters, restoreLocalWorkspace, confirmDiscardLayoutChanges } = useDashboard();
  const { startOperation } = useOperationStatus();
  const inputRef = useRef(null);
  const openerRef = useRef(null);
  const requestRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [protection, setProtection] = useState(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  const [restoreSnapshot, setRestoreSnapshot] = useState(null);
  useEffect(() => {
    let cancelled = false; setRestoreSnapshot(null);
    if (selectedDataset?.isLocal) void import('../../utils/localDatasetStore')
      .then(({ loadRestoredWorkspace }) => loadRestoredWorkspace(selectedDataset.id, { metadataOnly: true }))
      .then((snapshot) => { if (!cancelled) setRestoreSnapshot(snapshot); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedDataset?.id]);
  const canBackup = Boolean(selectedDataset?.isLocal && selectedDataset?.rawRows?.length);

  const exportBackup = async ({ passphrase } = {}) => {
    if (!canBackup || requestRef.current) return;
    const controller = new AbortController(); requestRef.current = controller; setBusy('backup');
    const operation = startOperation('Backing up workspace');
    operation.update('Preparing your datasets, layouts, and filters in this browser…');
    try {
      const { createWorkspaceStream } = await import('../../utils/workspaceBackupStream');
      const collection = selectedDataset.folderId
        ? datasets.filter((item) => item.folderId === selectedDataset.folderId)
        : [];
      let blob = await createWorkspaceStream({
        dataset: selectedDataset, layout: currentLayout, datasets: collection, layouts,
        filters: globalFilters, palette,
      }, { signal: controller.signal, onProgress: ({ records }) => operation.update(`Backing up record ${records.toLocaleString()}…`) });
      if (passphrase) {
        const { encryptWorkspaceBackup } = await import('../../utils/encryptedWorkspaceBackup');
        operation.update('Deriving your backup key and encrypting locally…');
        blob = await encryptWorkspaceBackup(blob, passphrase, { signal: controller.signal, onProgress: ({ bytes }) => operation.update(`Encrypted ${bytes.toLocaleString()} bytes…`) });
      }
      if (controller.signal.aborted) throw new DOMException('Workspace backup cancelled.', 'AbortError');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(selectedDataset.name || 'workspace').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 70)}.workspace.${passphrase ? 'enc' : 'jsonl'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      operation.succeed('Workspace backup downloaded. Keep the file somewhere you trust.');
    } catch (error) {
      if (error.name === 'AbortError') operation.cancel?.(); else operation.fail(error.message || 'Workspace backup failed.');
    } finally { if (requestRef.current === controller) { requestRef.current = null; setBusy(''); } }
  };

  const recoverLayout = async () => {
    if (!confirmDiscardLayoutChanges()) return;
    const operation = startOperation('Recovering restored layout');
    try {
      const { loadRestoredWorkspace } = await import('../../utils/localDatasetStore');
      const workspace = await loadRestoredWorkspace(restoreSnapshot.id || selectedDataset.id);
      if (!workspace) throw new Error('This restored workspace is no longer available.');
      await restoreLocalWorkspace(workspace); onPaletteChange(workspace.palette);
      operation.succeed('Restored layout recovered.');
    } catch (error) { operation.fail(error.message || 'Could not recover the restored layout.'); }
  };

  const restoreBackupFile = async (file, { passphrase } = {}) => {
    if (!file || requestRef.current || !confirmDiscardLayoutChanges()) return;
    const controller = new AbortController(); requestRef.current = controller; setBusy('restore');
    const operation = startOperation('Restoring workspace');
    operation.update('Reading the backup file in this browser…');
    try {
      const { readWorkspaceBackup } = await import('../../utils/workspaceBackup');
      let plaintext = file;
      if (passphrase) {
        const { decryptWorkspaceBackup } = await import('../../utils/encryptedWorkspaceBackup');
        operation.update('Authenticating and decrypting the backup locally…');
        plaintext = await decryptWorkspaceBackup(file, passphrase, { signal: controller.signal });
      }
      const workspace = await readWorkspaceBackup(plaintext, { signal: controller.signal, onProgress: ({ records }) => operation.update(`Verifying and staging record ${records.toLocaleString()}…`) });
      await restoreLocalWorkspace(workspace);
      onPaletteChange(workspace.palette);
      const totalRows = workspace.datasets?.length
        ? workspace.datasets.filter((dataset) => !dataset.isFolderOverview).reduce((sum, dataset) => sum + dataset.rowCount, 0)
        : workspace.dataset.rowCount;
      operation.succeed(`Restored ${totalRows.toLocaleString()} source rows and the dashboard layout locally.`);
    } catch (error) {
      if (error.name === 'AbortError') operation.cancel?.(); else operation.fail(error.message || 'Could not restore this workspace backup.');
    } finally { if (requestRef.current === controller) { requestRef.current = null; setBusy(''); } }
  };
  const importBackup = async (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || requestRef.current) return;
    try {
      const { isEncryptedWorkspaceBackup } = await import('../../utils/encryptedWorkspaceBackup');
      if (await isEncryptedWorkspaceBackup(file)) setProtection({ file, restoring: true });
      else await restoreBackupFile(file);
    } catch (error) { startOperation('Reading backup').fail(error.message || 'Could not read backup.'); }
  };

  return (
    <div className="workspace-backup-controls" aria-label="Private workspace backup controls">
      <input ref={inputRef} type="file" accept=".json,.jsonl,.enc,application/json,application/x-ndjson,application/octet-stream" onChange={importBackup} className="hidden" aria-label="Choose workspace backup" />
      <button type="button" onClick={() => void exportBackup()} disabled={!canBackup || Boolean(busy)} title="Download this local workspace; collections include every source dataset" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
        <FiDownload aria-hidden="true" /> Backup
      </button>
      <button type="button" disabled={Boolean(busy)} onClick={(event) => { openerRef.current = event.currentTarget; inputRef.current?.click(); }} title="Restore a private workspace file in this browser" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        <FiUpload aria-hidden="true" /> Restore
      </button>
      <button type="button" disabled={!canBackup || Boolean(busy)} onClick={(event) => { openerRef.current = event.currentTarget; setProtection({ restoring: false }); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Encrypted backup</button>
      {busy && <button type="button" onClick={() => requestRef.current?.abort()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Cancel {busy}</button>}
      {restoreSnapshot && <button type="button" onClick={() => void recoverLayout()} title="Recover the layout, filters and palette saved during this backup restore" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Recover restored layout</button>}
      {protection && <Suspense fallback={<p role="status">Loading backup protection…</p>}><BackupPassphraseDialog returnFocusRef={openerRef} restoring={protection.restoring} onClose={() => setProtection(null)} onSubmit={(passphrase) => {
        const request = protection; setProtection(null);
        if (request.restoring) void restoreBackupFile(request.file, { passphrase }); else void exportBackup({ passphrase });
      }} /></Suspense>}
    </div>
  );
}

import { lazy, Suspense } from 'react';
import { FiDownload, FiFileText, FiFolderPlus, FiMoreHorizontal, FiPauseCircle, FiPlayCircle, FiRefreshCw, FiShield } from 'react-icons/fi';
import DisclosurePanel from '../common/DisclosurePanel';
import BrowserImportLimits from '../forms/BrowserImportLimits';
import { LOCAL_FILE_ACCEPT } from '../../utils/localDataEngine';
const WorkspaceBackupControls = lazy(() => import('./WorkspaceBackupControls'));

export default function DashboardToolbar({ dataset, datasets, onDatasetChange, onOpenFile, fileInputRef, onDirectFileOpen, onQuality, onReport, exportFormat, onExportFormatChange, onExport, isLocalDataset, palette, onPaletteChange, liveEnabled, onLiveChange, statusLabel, onRefresh, lastUpdated, settings, isDemo, children }) {
  return <header className="dashboard-toolbar workspace-command-bar">
    <div className="workspace-title-row">
      <div className="workspace-title"><p className="eyebrow">Your workspace</p><h1>{dataset?.name || 'Your dashboard'}</h1><p className="workspace-meta">{Number(dataset?.rowCount || 0).toLocaleString()} rows <span>·</span> {dataset?.columns?.length || 0} columns <span>·</span> {statusLabel}{isDemo && <><span>·</span> Sample data</>}</p></div>
      <DisclosurePanel label="Workspace information">
        <p>{isLocalDataset ? 'Your data is analyzed in this browser. Save a separate backup before clearing site data or changing devices.' : 'Live data follows the selected server source. Use the connection controls under More actions.'}</p>
        {lastUpdated && !isLocalDataset && <p>Last update: {new Date(lastUpdated).toLocaleString()}.</p>}
        {settings.features.localUpload && <BrowserImportLimits variant="quiet" />}
      </DisclosurePanel>
    </div>
    <div className="workspace-primary-row">
      <label className="workspace-source"><span className="sr-only">Select dataset</span><select value={dataset?.id || ''} onChange={event => onDatasetChange(datasets.find(entry => entry.id === event.target.value))} aria-label="Select dataset"><option value="">Select dataset</option>{datasets.map(entry => <option key={entry.id} value={entry.id}>{entry.name || 'Dataset'}</option>)}</select></label>
      <input type="file" ref={fileInputRef} onChange={onDirectFileOpen} accept={LOCAL_FILE_ACCEPT} className="hidden" aria-label="Open a local data file" />
      {settings.features.localUpload && <button type="button" className="workspace-button" onClick={onOpenFile}><FiFolderPlus aria-hidden="true" /> Open File</button>}
      <DisclosurePanel label="More actions" trigger={<><FiMoreHorizontal aria-hidden="true" /> More actions</>} className="workspace-more">
        <div className="workspace-action-group"><p className="workspace-group-label">Review &amp; share</p><button type="button" className="workspace-button" onClick={onQuality} disabled={!dataset?.rawRows?.length || dataset.isFolderOverview}><FiShield aria-hidden="true" /> Data Health</button>{settings.features.reports && <button type="button" className="workspace-button" onClick={onReport} disabled={!dataset?.rawRows?.length}><FiFileText aria-hidden="true" /> Report</button>}</div>
        <div className="workspace-export"><label>Export format<select aria-label="Export format" value={exportFormat} onChange={event => onExportFormatChange(event.target.value)}><option value="csv">CSV</option><option value="xlsx">Excel</option><option value="json">JSON</option>{!isLocalDataset && <option value="parquet">Parquet</option>}<option value="print">Print</option></select></label><button type="button" className="workspace-button" onClick={onExport}><FiDownload aria-hidden="true" /> Export</button></div>
        <div className="workspace-action-group"><p className="workspace-group-label">Keep a copy</p><Suspense fallback={<p role="status">Loading backup controls…</p>}><WorkspaceBackupControls palette={palette} onPaletteChange={onPaletteChange} /></Suspense></div>
        {!isLocalDataset && <div className="workspace-action-group"><p className="workspace-group-label">Connection</p><button type="button" className="workspace-button" onClick={onLiveChange}>{liveEnabled ? <FiPauseCircle aria-hidden="true" /> : <FiPlayCircle aria-hidden="true" />}{liveEnabled ? 'Pause Live' : 'Resume Live'}</button><button type="button" className="workspace-button" disabled={!dataset} onClick={onRefresh}><FiRefreshCw aria-hidden="true" /> Refresh</button></div>}
      </DisclosurePanel>
    </div>
    <div className="workspace-layout-row">{children}</div>
  </header>;
}

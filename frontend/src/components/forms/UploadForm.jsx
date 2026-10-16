import { useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import { useDashboard } from '../../context/DashboardContext';
import { MAX_LOCAL_DATASET_BYTES, SAMPLE_DATASETS } from '../../utils/localDataEngine';
import { inspectFolderFiles, importLocalFileWorkspace, importLocalFolder } from '../../utils/folderImport';
import { FiLock, FiFileText, FiUpload, FiArrowRight, FiUploadCloud, FiGlobe, FiFolder } from 'react-icons/fi';
import UrlImportTab from './UrlImportTab';
import BrowserImportLimits from './BrowserImportLimits';
import { useSiteSettings } from '../../context/SiteSettingsContext';
import { useOperationStatus } from '../../context/OperationStatusContext';
import { SERVER_WORKSPACE_ENABLED } from '../../config/workspace';

export default function UploadForm() {
  const [activeTab, setActiveTab] = useState('local'); // 'local' | 'url'
  const [file, setFile] = useState(null);
  const [documentMode, setDocumentMode] = useState(false);
  const [folderFiles, setFolderFiles] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const folderInputRef = useRef(null);
  const filesInputRef = useRef(null);
  const importController = useRef(null);
  useEffect(() => () => importController.current?.abort(), []);
  const { addLocalDataset, addLocalDatasets } = useDashboard();
  const { settings } = useSiteSettings();
  const { startOperation } = useOperationStatus();

  useEffect(() => {
    if (!settings.features.localUpload && settings.features.urlImport) {
      setActiveTab('url');
    }
  }, [settings.features.localUpload, settings.features.urlImport]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'text/csv': ['.csv'],
      'text/tab-separated-values': ['.tsv'],
      'text/plain': ['.txt', '.md'],
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls']
    },
    maxSize: MAX_LOCAL_DATASET_BYTES,
    onDrop: (acceptedFiles) => {
      if (!acceptedFiles || !acceptedFiles.length) return;
      const selectedFile = acceptedFiles[0];
      setFile(selectedFile);
      setDocumentMode(/\.(pdf|docx|md)$/i.test(selectedFile.name));
      setFolderFiles([]);
      setName(selectedFile.name.replace(/\.[^/.]+$/, ''));
    },
    onDropRejected: (rejectedFiles) => {
      toast.error(rejectedFiles[0]?.errors[0]?.message || 'Choose a supported table or text document.');
    }
  });

  const processAndLoad = async (targetFile = file) => {
    if (!targetFile) return;

    setParsing(true);
    const controller = new AbortController(); importController.current = controller;
    const operation = startOperation('Importing local dataset');
    operation.update('Parsing the file in your browser…');
    try {
      const workspace = await importLocalFileWorkspace(targetFile, { name, documentMode, signal: controller.signal,
        onProgress: ({ rows }) => operation.update(`Parsed ${rows.toLocaleString()} rows…`) });
      const { datasets, selected } = workspace;
      addLocalDatasets(datasets, selected, { persisted: workspace.persisted });
      const sources = datasets.filter((dataset) => !dataset.isFolderOverview);
      operation.succeed(`Loaded ${sources.length} dataset${sources.length === 1 ? '' : 's'} and ${sources.reduce((sum, dataset) => sum + dataset.rowCount, 0).toLocaleString()} rows in this browser.`);
      navigate('/dashboard');
    } catch (error) {
      operation.fail(error.message || 'Failed to parse file.');
    } finally {
      if (importController.current === controller) importController.current = null;
      setParsing(false);
    }
  };

  const processFolder = async () => {
    if (!folderFiles.length) return;
    setParsing(true);
    const controller = new AbortController(); importController.current = controller;
    const operation = startOperation('Importing folder');
    try {
      const result = await importLocalFolder(folderFiles, {
        signal: controller.signal,
        onProgress: ({ completed, total, path }) => operation.update(`Analyzing ${Math.min(completed + 1, total)} of ${total}: ${path}`),
      });
      addLocalDatasets(result.datasets, result.overview, { persisted: result.persisted });
      operation.succeed(`Analyzed ${result.datasets.filter((dataset) => !dataset.isFolderOverview).length} datasets and ${result.overview.totalSourceRows.toLocaleString()} source rows. ${result.failures.length} files could not be read.`);
      navigate('/dashboard');
    } catch (error) {
      operation.fail(error.message || 'Could not analyze this folder.');
    } finally {
      if (importController.current === controller) importController.current = null;
      setParsing(false);
    }
  };

  const folderSelection = folderFiles.length ? inspectFolderFiles(folderFiles) : null;

  const loadSample = () => {
    const sample = SAMPLE_DATASETS[0];
    addLocalDataset(sample);
    navigate('/dashboard');
  };

  return (
    <div className="import-form">
      {parsing && <button type="button" onClick={() => importController.current?.abort()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Cancel import</button>}
      {/* Source Selector Tabs */}
      <div className="import-tabs" role="group" aria-label="Import source">
        {settings.features.localUpload && <button
          type="button"
          aria-pressed={activeTab === 'local'}
          onClick={() => setActiveTab('local')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all ${
            activeTab === 'local'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FiUploadCloud /> Local files
        </button>}
        {settings.features.urlImport && <button
          type="button"
          aria-pressed={activeTab === 'url'}
          onClick={() => setActiveTab('url')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all ${
            activeTab === 'url'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FiGlobe /> URL / Google Sheets
        </button>}
      </div>

      {activeTab === 'url' && settings.features.urlImport ? (
        <div className="space-y-6"><BrowserImportLimits variant="summary" /><UrlImportTab /></div>
      ) : settings.features.localUpload ? (
        <div className="space-y-6">
          {/* Dropzone */}
          <div
            {...getRootProps({ role: 'button', 'aria-label': 'Choose a CSV, Excel or document file' })}
            className={`import-dropzone ${isDragActive ? 'is-active' : ''}`}
          >
            <input {...getInputProps({ 'aria-label': 'Choose a data file' })} />
            <FiUpload aria-hidden="true" />
            {file ? (
              <div>
                <p className="text-lg font-bold text-primary-text">{file.name}</p>
                <p className="text-sm text-primary-text opacity-75 mt-1">
                  {(file.size / 1024 / 1024).toFixed(2)} MB • Ready to analyze
                </p>
              </div>
            ) : (
              <div>
                <p className="text-xl font-semibold text-slate-900">
                  Drop a file here
                </p>
                <p className="text-sm font-medium text-slate-600 mt-2">
                  or browse · CSV, Excel, PDF, DOCX, Markdown or TXT
                </p>

              </div>
            )}
          </div>

          <p className="import-local-note"><FiLock aria-hidden="true" />Processed on your device. <Link to="/privacy">Privacy details</Link></p>
          {SERVER_WORKSPACE_ENABLED && <p className="text-xs text-slate-600">Optional AI layout ideas share column names and profile details only after you opt in.</p>}
          <BrowserImportLimits variant="summary" />

          <div className="import-collection">
            <input
              ref={folderInputRef}
              type="file"
              webkitdirectory=""
              multiple
              className="sr-only"
              aria-label="Choose a folder of data files"
              onChange={(event) => {
                setFolderFiles(Array.from(event.target.files || []));
                setFile(null);
                event.target.value = '';
              }}
            />
            <input ref={filesInputRef} type="file" multiple accept=".csv,.tsv,.txt,.xlsx,.xls" className="sr-only" aria-label="Choose several data files" onChange={(event) => {
              setFolderFiles(Array.from(event.target.files || [])); setFile(null); event.target.value = '';
            }} />
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={parsing}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2 font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
            >
              <FiFolder /> Choose a whole folder
            </button>
            <button type="button" onClick={() => filesInputRef.current?.click()} disabled={parsing} className="ml-2 mt-2 rounded-xl border border-indigo-300 bg-white px-4 py-2 font-semibold text-indigo-900 disabled:opacity-50">Choose several files</button>
            <p className="import-collection-note">Folders preserve their paths. Several files work as a collection when folder picking is unavailable.</p>
            <p className="import-collection-note">CSV, TSV, TXT and nonempty workbook sheets become separate sources.</p>
            {folderSelection && <p className="mt-2 text-sm font-semibold text-indigo-950">{folderSelection.folderName}: {folderSelection.files.length} supported files ({(folderSelection.totalBytes / 1024 / 1024).toFixed(1)} MB). {folderSelection.ignoredCount} other files will be ignored.</p>}
          </div>

          {/* Dataset Name Override */}
          {file && <label className="block text-sm font-semibold text-slate-800"><input type="checkbox" checked={documentMode} onChange={(event) => setDocumentMode(event.target.checked)} disabled={/\.(pdf|docx|md)$/i.test(file.name)} className="mr-2" />Import as a text document
            <span className="mt-1 block text-xs font-normal">PDF text layers, DOCX body paragraphs, Markdown and prose TXT become page/block evidence for local search. Scanned pages need OCR; no text is invented. CSV and spreadsheets use the tabular importer.</span>
          </label>}
          {file && (
            <div>
              <label htmlFor="name" className="block text-sm font-bold text-primary-text mb-2">
                Dataset Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="Enter dataset name"
              />
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            {folderFiles.length ? (
              <button
                type="button"
                onClick={processFolder}
                disabled={parsing}
                className="w-full btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {parsing ? 'Analyzing folder in browser...' : 'Analyze whole folder'} <FiArrowRight />
              </button>
            ) : file ? (
              <button
                onClick={() => processAndLoad()}
                disabled={parsing}
                className="w-full btn-primary disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {parsing ? 'Processing in Browser...' : 'Visualize Dashboard'} <FiArrowRight />
              </button>
            ) : (
              <button
                type="button"
                onClick={loadSample}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
              >
                <FiFileText /> Explore sample data
              </button>
            )}
          </div>
        </div>
      ) : <p className="border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Dataset import is currently unavailable.</p>}
    </div>
  );
}

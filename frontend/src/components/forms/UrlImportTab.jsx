import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useDashboard } from '../../context/DashboardContext';
import { useOperationStatus } from '../../context/OperationStatusContext';
import { importLocalFileWorkspace } from '../../utils/folderImport';
import { FiLink, FiArrowRight, FiGlobe, FiDatabase, FiCheckCircle } from 'react-icons/fi';

const SAMPLE_URLS = [
  {
    label: 'Google Sheet Demo (Tech Stocks 2025)',
    url: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv',
    name: 'Tech Stocks Live Sheet'
  },
  {
    label: 'GitHub Raw CSV (Global Cities)',
    url: 'https://raw.githubusercontent.com/datasets/world-cities/master/data/world-cities.csv',
    name: 'World Cities Dataset'
  }
];

const MAX_REMOTE_DATASET_BYTES = 100 * 1024 * 1024;

async function awaitWithSignal(action, signal) {
  if (signal.aborted) throw signal.reason;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(action), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function readBlobWithinLimit(response, signal) {
  if (!response.body) {
    const blob = await awaitWithSignal(() => response.blob(), signal);
    if (blob.size > MAX_REMOTE_DATASET_BYTES) {
      throw new Error('The remote dataset exceeds the 100 MB browser limit.');
    }
    return blob;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await awaitWithSignal(() => reader.read(), signal);
      if (done) { completed = true; break; }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REMOTE_DATASET_BYTES) {
        throw new Error('The remote dataset exceeds the 100 MB browser limit.');
      }
      chunks.push(value);
    }
    return new Blob(chunks, { type: 'text/csv' });
  } finally {
    // Do not await cancellation: a broken source must not hold the UI open.
    if (!completed) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export default function UrlImportTab() {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const { addLocalDatasets } = useDashboard();
  const importController = useRef(null);
  useEffect(() => () => {
    importController.current?.abort();
    importController.current = null;
  }, []);
  const { startOperation } = useOperationStatus();
  const navigate = useNavigate();

  const normalizeUrl = (rawUrl) => {
    let clean = rawUrl.trim();
    // Convert Google Sheets /edit link to /export?format=csv
    if (clean.includes('docs.google.com/spreadsheets/d/')) {
      const match = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
      }
    }
    // Convert GitHub blob URL to raw
    if (clean.includes('github.com') && clean.includes('/blob/')) {
      clean = clean.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    }
    return clean;
  };

  const handleFetchAndParse = async (targetUrl = url, datasetName = name) => {
    // Ref ownership also covers clicks in the same turn before React renders.
    if (importController.current) return;
    const finalUrl = normalizeUrl(targetUrl);
    if (!finalUrl) {
      toast.error('Please enter a valid URL');
      return;
    }

    try {
      const parsedUrl = new URL(finalUrl);
      const isLocalHttp = import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(parsedUrl.hostname) && parsedUrl.protocol === 'http:';
      if (parsedUrl.protocol !== 'https:' && !isLocalHttp) {
        throw new Error('Use an HTTPS URL for external datasets.');
      }
    } catch (error) {
      toast.error(error.message || 'Please enter a valid HTTPS URL');
      return;
    }

    setLoading(true);
    const controller = new AbortController(); importController.current = controller;
    const operation = startOperation('Importing web dataset');
    operation.update('Fetching the source directly in your browser…');
    const timeout = window.setTimeout(() => controller.abort(
      new DOMException('The web dataset import timed out after 20 seconds.', 'TimeoutError')
    ), 20000);

    try {
      const response = await awaitWithSignal(() => fetch(finalUrl, {
        credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal
      }), controller.signal);

      if (!response.ok) {
        throw new Error(`Failed to fetch from URL (HTTP ${response.status})`);
      }

      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_REMOTE_DATASET_BYTES) {
        throw new Error('The remote dataset exceeds the 100 MB browser limit.');
      }

      const blob = await readBlobWithinLimit(response, controller.signal);
      window.clearTimeout(timeout);
      if (!blob.size) {
        throw new Error('Received empty response from the provided URL.');
      }

      // Create a virtual File object to pass to localDataEngine
      const derivedName = datasetName || finalUrl.split('/').pop()?.split('?')[0] || 'web_dataset.csv';
      const file = new File([blob], derivedName.endsWith('.csv') ? derivedName : `${derivedName}.csv`, {
        type: 'text/csv'
      });

      operation.update('Parsing the dataset in your browser…');
      const workspace = await importLocalFileWorkspace(file, { name: datasetName, signal: controller.signal });
      if (controller.signal.aborted) throw controller.signal.reason;
      const parsedDataset = workspace.selected;
      addLocalDatasets(workspace.datasets, parsedDataset, { persisted: true });
      operation.succeed(`Imported ${parsedDataset.rowCount.toLocaleString()} rows into this browser.`);
      navigate('/dashboard');
    } catch (error) {
      if (error.name === 'AbortError') operation.cancel();
      else operation.fail(error.message || 'Failed to import from URL. Verify the link is publicly accessible.');
    } finally {
      window.clearTimeout(timeout);
      controller.abort();
      if (importController.current === controller) {
        importController.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <div className="space-y-6">
      {loading && <button type="button" onClick={() => importController.current?.abort()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Cancel import</button>}
      {/* Privacy Notice */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-blue-600 p-2 text-white">
            <FiGlobe className="text-xl" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-blue-900">Direct Client-Side URL Connector</h4>
            <p className="mt-0.5 text-xs font-medium leading-relaxed text-blue-700">
                  Fetched directly by your browser. No middleman servers save or inspect your web feed. The source must allow browser CORS and use HTTPS.
            </p>
          </div>
        </div>
      </div>

      {/* URL Input Form */}
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div>
          <label htmlFor="import-url" className="block text-sm font-bold text-slate-800 mb-2">
            Public CSV or Google Sheets URL
          </label>
          <div className="relative">
            <FiLink className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="import-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/... or https://raw.githubusercontent.com/..."
              className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm font-medium text-slate-800 focus:border-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            Tip: For Google Sheets, just paste the standard share link. We automatically convert it to a live CSV stream.
          </p>
        </div>

        <div>
          <label htmlFor="import-name" className="block text-sm font-bold text-slate-800 mb-2">
            Dataset Name (Optional)
          </label>
          <input
            id="import-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q4 Sales Forecast"
            className="w-full rounded-xl border border-slate-300 py-2.5 px-4 text-sm font-medium text-slate-800 focus:border-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <button
          type="button"
          onClick={() => handleFetchAndParse()}
          disabled={loading || !url.trim()}
          className="w-full btn-primary disabled:opacity-50 flex items-center justify-center gap-2 py-3 rounded-xl"
        >
          {loading ? 'Fetching & Parsing...' : 'Import & Visualize'} <FiArrowRight />
        </button>
      </div>

      {/* Preset Example Feeds */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3 flex items-center gap-1.5">
          <FiDatabase /> Or Try a Sample Web Stream
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {SAMPLE_URLS.map((sample) => (
            <button
              key={sample.name}
              type="button"
              disabled={loading}
              onClick={() => {
                setUrl(sample.url);
                setName(sample.name);
                handleFetchAndParse(sample.url, sample.name);
              }}
              className="text-left rounded-xl border border-slate-200 bg-white p-3 shadow-2xs hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
            >
              <p className="text-xs font-bold text-slate-900">{sample.label}</p>
              <p className="mt-0.5 text-[11px] font-mono text-slate-500 truncate">{sample.url}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

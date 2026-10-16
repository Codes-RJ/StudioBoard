import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { useOperationStatus } from '../context/OperationStatusContext';
import api from '../services/api';
import { describeApiError } from '../utils/apiError';
import { exportLocalDataset } from '../utils/localDataEngine';
import { scopeDataset } from '../utils/analysisScope';

export default function useDatasetExport(selectedDataset, scopeFilters = {}) {
  const { startOperation } = useOperationStatus();
  const [exportFormat, setExportFormat] = useState('csv');
  const exportPollTimerRef = useRef(null);
  const exportOperationRef = useRef(null);
  const isLocalDataset = Boolean(selectedDataset?.isLocal || selectedDataset?.rawRows);

  useEffect(() => {
    if (isLocalDataset && exportFormat === 'parquet') setExportFormat('csv');
  }, [isLocalDataset, exportFormat]);

  useEffect(() => () => {
    if (exportPollTimerRef.current) window.clearTimeout(exportPollTimerRef.current);
    exportOperationRef.current?.cancel();
  }, []);

  const downloadServerExport = useCallback((blob, format, datasetName) => {
    const url = window.URL.createObjectURL(new Blob([blob]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${datasetName || 'dataset'}_export.${format}`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }, []);

  const pollExportJob = useCallback(async (jobId, format, datasetName) => {
    try {
      const { data: job } = await api.get(`/analytics/jobs/${jobId}`);
      if (job.status === 'SUCCEEDED') {
        const download = await api.get(`/analytics/jobs/${jobId}/download`, { responseType: 'blob' });
        downloadServerExport(download.data, job.result?.format || format, datasetName);
        exportOperationRef.current?.succeed('Export downloaded.');
        exportOperationRef.current = null;
        return;
      }
      if (job.status === 'FAILED') {
        exportOperationRef.current?.fail(job.error || 'The background export failed.');
        exportOperationRef.current = null;
        return;
      }
      exportOperationRef.current?.update(job.status === 'RUNNING' ? 'Preparing the export…' : 'Waiting for the export worker…');
      exportPollTimerRef.current = window.setTimeout(() => {
        void pollExportJob(jobId, format, datasetName);
      }, 2000);
    } catch (error) {
      exportOperationRef.current?.fail(describeApiError(error, 'Unable to check the export status.').text);
      exportOperationRef.current = null;
    }
  }, [downloadServerExport]);

  const handleExportSnapshot = async (format = exportFormat) => {
    if (!selectedDataset) {
      toast.error('Please select a dataset to export');
      return;
    }
    if (format === 'print') {
      window.print();
      return;
    }

    if (isLocalDataset) {
      const operation = startOperation('Exporting local dataset');
      operation.update(`Preparing ${format.toUpperCase()} in your browser…`);
      try {
        const scoped = scopeDataset(selectedDataset, scopeFilters);
        await exportLocalDataset(scoped, format);
        operation.succeed(`Downloaded ${format.toUpperCase()} file: ${scoped.rowCount} eligible rows of ${selectedDataset.rawRows.length} source rows.`);
      } catch (error) {
        operation.fail(error.message || 'Failed to export dataset');
      }
      return;
    }

    try {
      if (exportPollTimerRef.current) window.clearTimeout(exportPollTimerRef.current);
      exportOperationRef.current?.cancel();
      const operation = startOperation('Exporting server dataset');
      exportOperationRef.current = operation;
      operation.update('Queueing export on the server…');
      const { data: job } = await api.post('/analytics/jobs/export', {
        datasetId: selectedDataset.id,
        format
      });
      operation.update('Waiting for the export worker…');
      exportPollTimerRef.current = window.setTimeout(() => {
        void pollExportJob(job.id, format, selectedDataset.name);
      }, 400);
    } catch (error) {
      exportOperationRef.current?.fail(describeApiError(error, 'Failed to queue export.').text);
      exportOperationRef.current = null;
    }
  };

  return { exportFormat, setExportFormat, handleExportSnapshot, isLocalDataset };
}

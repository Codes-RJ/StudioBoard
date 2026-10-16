/* CPU-heavy local quality work stays outside the React/UI thread. */
import { analyzeDataQuality, cleanDatasetRows, replayCleaningRecipe, summarizeCleaningPreview } from './dataCleaner';
import { computeReportAnalysisPayload } from './savedReportAnalysis';
import { profileDataset } from './datasetProfiler';
import { discoverDatasetRelationships, reviewDatasetRelationship } from './datasetRelationships';
import { analyzeApprovedRelationship } from './crossDatasetAnalysis';
import { computeAdvancedChartPayload } from './savedAdvancedChart';
import { computeSavedQuality, loadBoundedTransformDataset } from './savedQuality';
import { computeScopedMetricsPayload } from './savedScopedMetrics';
import { computeChartSeriesPayload } from './savedChartSeries';
import { reviewSourceGrain } from './sourceGrain';
import { assertTransformMemoryPolicy } from './transformMemoryPolicy';

self.onmessage = async ({ data }) => {
  const { id, operation } = data;
  try {
    assertTransformMemoryPolicy(operation, data.payload);
    const reference = data.payload.dataset;
    if (['quality-profile', 'quality', 'profile'].includes(operation) && reference?.kind === 'local-dataset-reference') {
      const result = await computeSavedQuality(reference, { onProgress: (progress) => self.postMessage({ id, progress }) });
      self.postMessage({ id, result: operation === 'quality' ? result.quality : operation === 'profile' ? result.profile : result }); return;
    }
    if (operation === 'advanced-chart') {
      const result = await computeAdvancedChartPayload(data.payload, { onProgress: (progress) => self.postMessage({ id, progress }) });
      self.postMessage({ id, result }); return;
    }
    if (operation === 'report-analysis') {
      const result = await computeReportAnalysisPayload(data.payload, { onProgress: (progress) => self.postMessage({ id, progress }) });
      self.postMessage({ id, result }); return;
    }
    if (operation === 'chart-series') {
      const result = await computeChartSeriesPayload(data.payload, { onProgress: (progress) => self.postMessage({ id, progress }) });
      self.postMessage({ id, result }); return;
    }
    if (operation === 'scoped-metrics') {
      const result = await computeScopedMetricsPayload(data.payload, { onProgress: (progress) => self.postMessage({ id, progress }) });
      self.postMessage({ id, result }); return;
    }
    // Remaining exact edits/relationship reviews have explicit retained-row
    // limits and omit original/history streams unless that stream is requested.
    const cache = new Map();
    let retainedRows = 0; let retainedBytes = 0;
    const reserve = (row) => {
      retainedRows++; retainedBytes += JSON.stringify(row).length * 2;
      if (retainedRows > 250_000 || retainedBytes > 32 * 1024 * 1024) throw new Error('The exact transformation exceeds its combined 250,000-row / 32 MB retained-data policy. Narrow the selected sources.');
    };
    const resolve = async (value) => {
      if (value?.kind === 'local-dataset-reference') {
        const stream = value.field === 'sourceRows' ? 'sourceRows' : 'rawRows'; const key = `${value.id}:${stream}`;
        if (!cache.has(key)) cache.set(key, loadBoundedTransformDataset(value.id, { stream, expectedRevision: value.revision, expectedStorageRevision: value.storageRevision,
          onProgress: (progress) => self.postMessage({ id, progress }) }, { reserve }));
        const source = await cache.get(key); return value.field ? source.rawRows : source;
      }
      if (Array.isArray(value) && value.some((entry) => entry?.kind === 'local-dataset-reference')) { const sources = []; for (const source of value) sources.push(await resolve(source)); return sources; }
      return value;
    };
    const payload = Object.fromEntries(await Promise.all(Object.entries(data.payload).map(async ([key, value]) => [key, await resolve(value)])));
    let result;
    if (operation === 'review-source-grain') {
      result = reviewSourceGrain(payload.dataset, payload.options);
    } else if (operation === 'quality-profile') {
      const quality = analyzeDataQuality(payload.dataset);
      const sourceQuality = payload.dataset.sourceRows ? analyzeDataQuality({ ...payload.dataset,
        rawRows: payload.dataset.sourceRows, columns: payload.dataset.sourceColumns }) : quality;
      result = { quality, sourceQuality, profile: profileDataset(payload.dataset, quality.missingByColumn) };
    } else if (operation === 'quality') {
      result = analyzeDataQuality(payload.dataset);
    } else if (operation === 'profile') {
      result = profileDataset(payload.dataset);
    } else if (operation === 'clean') {
      result = cleanDatasetRows(payload.rows, payload.columns, payload.options);
    } else if (operation === 'clean-preview') {
      const cleaned = cleanDatasetRows(payload.rows, payload.columns, payload.options);
      const sampleColumns = cleaned.columns.slice(0, 6);
      result = {
        changes: cleaned.changes,
        columns: sampleColumns,
        sampleRows: cleaned.rawRows.slice(0, 3).map((row) => Object.fromEntries(sampleColumns.map((column) => [column, row[column]]))),
        summary: summarizeCleaningPreview(payload.rows, payload.columns, cleaned)
      };
    } else if (operation === 'replay-cleaning-recipe') {
      result = replayCleaningRecipe(payload.rows, payload.columns, payload.recipe);
    } else if (operation === 'discover-relationships') {
      result = discoverDatasetRelationships(payload.datasets);
      for (const relationship of payload.manualRelationships || []) result.push(reviewDatasetRelationship({ ...relationship, datasets: payload.datasets }));
    } else if (operation === 'review-relationship') {
      result = reviewDatasetRelationship(payload);
    } else if (operation === 'analyze-approved-relationship') {
      result = analyzeApprovedRelationship(payload);
    } else {
      throw new Error('Unsupported local transform operation.');
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Local transform failed.' });
  }
};

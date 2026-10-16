import { useEffect, useRef, useState } from 'react';
import useModalFocus from '../../hooks/useModalFocus';
import SourceGrainReview from './SourceGrainReview';
import { meanFinite } from '../../utils/finiteArithmetic';
import {
  FiShield, FiCheckCircle, FiAlertTriangle, FiX, FiTool,
  FiCheckSquare, FiSquare, FiRotateCcw, FiCheck, FiDownload
} from 'react-icons/fi';
import { computeDatasetMetrics, planLocalSmartLayout } from '../../utils/localDataEngine';
import { getDatasetColumnGroups } from '../../utils/graphConfiguration';
import { toNumber } from '../../utils/chartDataTransforms';
import { runLocalTransform } from '../../utils/localTransforms';
import { useDashboard } from '../../context/DashboardContext';
import { useOperationStatus } from '../../context/OperationStatusContext';
import { DEFAULT_CLEAN_OPTIONS } from '../../utils/dataCleaner';
import { SERVER_WORKSPACE_ENABLED } from '../../config/workspace';
import { approveQualityRevision, getCellProvenance, newDatasetRevision, qualityRevisionKey } from '../../utils/qualityReview';

const NUMERIC_FILL_OPTIONS = [
  { value: 'keep', label: 'Leave unchanged (recommended)' },
  { value: 'median', label: 'Median' },
  { value: 'mean', label: 'Mean average' },
  { value: 'zero', label: 'Zero' },
  { value: 'dropRow', label: 'Drop affected rows' }
];

const CATEGORICAL_FILL_OPTIONS = [
  { value: 'keep', label: 'Leave unchanged (recommended)' },
  { value: 'unknown', label: 'Fill with "Unknown"' },
  { value: 'mode', label: 'Most frequent value' },
  { value: 'dropRow', label: 'Drop affected rows' }
];

const DEFAULT_OPTIONS = DEFAULT_CLEAN_OPTIONS;
const cleaningColumns = (dataset, columns = dataset?.columns || []) => columns.map((column) => {
  const name = typeof column === 'string' ? column : column.name;
  return { ...(typeof column === 'object' ? column : { name }), ...(dataset.columnOverrides?.[name] || {}) };
});

const buildWorkingDataset = (dataset, rawRows, columnNames, columnOverrides = dataset.columnOverrides || {}) => {
  const metrics = computeDatasetMetrics(rawRows, columnNames);
  const activeOverrides = Object.fromEntries(Object.entries(columnOverrides).filter(([name]) => columnNames.includes(name)));
  const columns = columnNames.map((name) => ({
    name,
    type: activeOverrides[name]?.type || (metrics.columnGroups.numeric.includes(name)
      ? 'number'
      : metrics.columnGroups.date.includes(name) ? 'date' : 'string')
  }));
  const updated = { ...dataset, rawRows, columns, metrics, columnOverrides: activeOverrides };
  metrics.columnGroups = getDatasetColumnGroups(updated);
  metrics.numericColumns = metrics.columnGroups.numeric.length;
  metrics.categoricalColumns = metrics.columnGroups.categorical.length;
  metrics.primaryMetricColumn = metrics.columnGroups.measures[0] || null;
  const primaryValues = metrics.primaryMetricColumn
    ? rawRows.map((row) => toNumber(row?.[metrics.primaryMetricColumn])).filter((value) => value !== null)
    : [];
  metrics.primaryMean = primaryValues.length
    ? meanFinite(primaryValues)
    : null;
  return {
    ...updated,
    rawRows,
    rowCount: rawRows.length,
    columns,
    metrics,
    columnOverrides: activeOverrides,
    smartLayout: planLocalSmartLayout(dataset.id, metrics.columnGroups),
    updatedAt: new Date().toISOString(),
    revision: newDatasetRevision()
  };
};

export default function DataQualityPanel({ dataset, onClose, requiredReview = false }) {
  const { updateLocalDataset, commitLocalDataset } = useDashboard();
  const { startOperation } = useOperationStatus();
  const preserveRows = !SERVER_WORKSPACE_ENABLED;
  const [options, setOptions] = useState(() => ({ ...DEFAULT_OPTIONS, preserveRows, columnPolicies: {} }));
  const [applyError, setApplyError] = useState('');
  const [inspectRow, setInspectRow] = useState(1);
  const [inspectColumn, setInspectColumn] = useState('');
  const persistReviewedDataset = (next) => commitLocalDataset(next, { expectedRevision: qualityRevisionKey(dataset) });
  const [quality, setQuality] = useState(null);
  const [sourceQuality, setSourceQuality] = useState(null);
  const [qualityError, setQualityError] = useState('');
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [profiledDataset, setProfiledDataset] = useState(null);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [historyAction, setHistoryAction] = useState('');
  const dialog = useRef(null); useModalFocus(dialog, { onClose: applying || historyAction ? undefined : onClose, resetKey: qualityError ? 'error' : quality ? 'ready' : 'loading' });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setQuality(null);
    setSourceQuality(null);
    setQualityError('');
    setProfile(null);
    setProfileError('');
    setProfiledDataset(null);
    runLocalTransform('quality-profile', { dataset }, { signal: controller.signal })
      .then((result) => {
        if (!cancelled) {
          setQuality(result.quality);
          setSourceQuality(result.sourceQuality || null);
          setProfile(result.profile);
          setProfiledDataset(dataset);
        }
      })
      .catch((error) => {
        if (!cancelled && error.name !== 'AbortError') {
          setQualityError(error.message || 'Could not analyze this local dataset.');
          setProfileError(error.message || 'Could not profile this local dataset.');
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dataset]);

  useEffect(() => {
    if (!quality || !profile || profiledDataset !== dataset) {
      setPreview(null);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    setPreview(null);
    setPreviewError('');
    runLocalTransform('clean-preview', { rows: dataset?.rawRows || [], columns: cleaningColumns(dataset), options }, { signal: controller.signal })
      .then((result) => {
        if (!cancelled) setPreview({
          ...result,
          options: { ...options },
          sourceRows: dataset.rawRows,
          sourceColumns: dataset.columns
        });
      })
      .catch((error) => {
        if (!cancelled && error.name !== 'AbortError') setPreviewError(error.message || 'Could not preview these changes.');
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dataset, options, profile, profiledDataset, quality]);

  const toggleOption = (key) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const updateColumnOverride = (name, key, value) => {
    const detected = profile?.columns?.find((column) => column.name === name);
    const current = dataset.columnOverrides?.[name] || { type: detected?.inferredType || 'string', role: detected?.inferredRole || 'dimension' };
    const next = { ...current, [key]: value };
    if (key === 'type' && value !== 'number' && next.role === 'measure') next.role = 'dimension';
    const columnOverrides = { ...(dataset.columnOverrides || {}), [name]: next };
    updateLocalDataset(buildWorkingDataset(dataset, dataset.rawRows, dataset.columns.map((column) => typeof column === 'string' ? column : column.name), columnOverrides));
  };

  const applyDetectedRoles = () => {
    if (!profile) return;
    const columnOverrides = { ...(dataset.columnOverrides || {}) };
    profile.columns.forEach((column) => {
      if (!columnOverrides[column.name]) {
        columnOverrides[column.name] = { type: column.inferredType, role: column.inferredRole };
      }
    });
    updateLocalDataset(buildWorkingDataset(dataset, dataset.rawRows, dataset.columns.map((column) => typeof column === 'string' ? column : column.name), columnOverrides));
  };

  const replayRecipe = async (recipe) => {
    const result = await runLocalTransform('replay-cleaning-recipe', {
      rows: dataset.sourceRows || dataset.rawRows,
      columns: cleaningColumns(dataset, dataset.sourceColumns || dataset.columns),
      recipe
    });
    const next = buildWorkingDataset(dataset, result.rawRows, result.columns);
    next.cleaningRecipe = recipe;
    next.cleaningLog = (dataset.cleaningLog || []).slice(0, recipe.length).map((entry, index) => ({ ...entry,
      changes: result.steps[index], operations: result.operationSteps[index] }));
    if (recipe.length) {
      next.sourceRows = dataset.sourceRows || dataset.rawRows.map((row) => ({ ...row }));
      next.sourceColumns = dataset.sourceColumns || dataset.columns;
    } else {
      delete next.sourceRows;
      delete next.sourceColumns;
      delete next.cleaningRecipe;
      delete next.cleaningLog;
    }
    if (preserveRows) next.qualityReviewRequired = true;
    return next;
  };

  const handleApply = async () => {
    if (!dataset?.rawRows?.length) return;
    setApplying(true);
    setApplyError('');
    const operation = startOperation('Cleaning local dataset');
    operation.update('Applying selected fixes in your browser…');

    try {
      for (const [field, counts] of Object.entries(profile?.precisionRisks || {})) {
        const column = profile.columns.find((item) => item.name === field); const override = dataset.columnOverrides?.[field];
        const type = override?.type || column?.inferredType; const role = override?.role || column?.inferredRole;
        if (type === 'number' && role === 'measure' && !['exact', 'native'].includes(override?.precision)) throw new Error(`Review ${field}'s precision before approving. Exact decimal preserves integer text; choose native explicitly to accept approximation.`);
        if (type === 'number' && role === 'measure' && override?.precision === 'exact' && counts['stored-number']) throw new Error(`${field} already contains unsafe stored Numbers. Re-import those values as text for exact arithmetic, or explicitly choose native approximation.`);
      }
      if (!preview || preview.sourceRows !== dataset.rawRows || preview.sourceColumns !== dataset.columns
        || JSON.stringify(preview.options) !== JSON.stringify(options)) {
        throw new Error('Wait for the cleaning preview to finish.');
      }
      if ((dataset.cleaningRecipe || []).length >= 50) throw new Error('Cleaning history reached 50 steps. Reset the data before applying another step.');
      const baselineRows = dataset.sourceRows || dataset.rawRows.map((row) => ({ ...row }));
      const baselineColumns = cleaningColumns(dataset, dataset.sourceColumns || dataset.columns);
      const recipe = [...(dataset.cleaningRecipe || []), { ...options }];
      const replay = await runLocalTransform('replay-cleaning-recipe', {
        rows: baselineRows,
        columns: baselineColumns,
        recipe
      });
      const { rawRows, columns: cleanedColumns } = replay;
      const changes = preview.changes;
      if (preserveRows && (rawRows.length !== baselineRows.length || cleanedColumns.length !== baselineColumns.length)) {
        throw new Error('An older cleaning recipe removed source data. Reset to imported data, then review again.');
      }

      if (!rawRows.length) {
        operation.fail('Cleaning would remove every row. Adjust the options.');
        setApplying(false);
        return;
      }

      await persistReviewedDataset(approveQualityRevision({
        ...buildWorkingDataset(dataset, rawRows, cleanedColumns),
        sourceRows: baselineRows,
        sourceColumns: baselineColumns,
        cleaningRecipe: recipe,
        cleaningLog: [
          ...(dataset.sourceRows ? (dataset.cleaningLog || []).map((entry, index) => ({ ...entry,
            changes: replay.steps[index], operations: replay.operationSteps[index] })) : []),
          { at: new Date().toISOString(), options: { ...options }, beforeRows: dataset.rawRows.length, afterRows: rawRows.length, changes,
            operations: replay.operationSteps?.at(-1) || [] }
        ],
      }));

      operation.succeed(`${changes.length} fix${changes.length === 1 ? '' : 'es'} applied.`);
      onClose();
    } catch (err) {
      setApplyError(err.message || 'Failed to save reviewed data.');
      operation.fail(err.message || 'Failed to clean dataset');
    } finally {
      setApplying(false);
    }
  };

  const downloadOriginal = async () => {
    const operation = startOperation('Downloading original file');
    try {
      const { loadLocalSourceFile } = await import('../../utils/localDatasetStore');
      const source = await loadLocalSourceFile(dataset.sourceFile.id);
      if (!source?.blob) throw new Error('The original file is unavailable. Keep your source file or import it again.');
      const url = URL.createObjectURL(source.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = source.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      operation.succeed('Original file downloaded unchanged.');
    } catch (error) { operation.fail(error.message || 'Could not read the original file.'); }
  };

  const handleUndo = async () => {
    const recipe = dataset.cleaningRecipe || [];
    if (!recipe.length) return;
    setHistoryAction('undo');
    const operation = startOperation('Undoing local cleaning');
    try {
      await persistReviewedDataset(await replayRecipe(recipe.slice(0, -1)));
      operation.succeed('Undid the last cleaning step.');
    } catch (error) {
      setApplyError(error.message || 'Could not undo cleaning.');
      operation.fail(error.message || 'Could not undo cleaning.');
    } finally {
      setHistoryAction('');
    }
  };

  const handleReset = async () => {
    if (!dataset.sourceRows) return;
    setHistoryAction('reset');
    const operation = startOperation('Resetting local cleaning');
    try {
      await persistReviewedDataset(await replayRecipe([]));
      operation.succeed('Restored the imported rows.');
    } catch (error) {
      setApplyError(error.message || 'Could not restore imported rows.');
      operation.fail(error.message || 'Could not restore imported rows.');
    } finally {
      setHistoryAction('');
    }
  };

  if (qualityError) {
    return (
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Data quality error" className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
          <h3 className="text-base font-bold text-slate-900">Data Health unavailable</h3>
          <p className="mt-2 text-sm text-rose-700">{qualityError}</p>
          <button type="button" onClick={onClose} className="mt-5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">Close</button>
        </div>
      </div>
    );
  }

  if (!quality) {
    return (
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Loading data quality review" aria-busy="true" className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
        <div className="rounded-3xl bg-white px-6 py-5 text-sm font-semibold text-slate-700 shadow-2xl">Analyzing local data in the background…</div>
      </div>
    );
  }

  const scoreColor =
    quality.qualityScore >= 90 ? 'text-emerald-600' : quality.qualityScore >= 70 ? 'text-amber-600' : 'text-rose-600';
  const provenance = getCellProvenance(dataset, Math.min(dataset.rawRows.length, Math.max(1, inspectRow)) - 1,
    inspectColumn || (typeof dataset.columns[0] === 'string' ? dataset.columns[0] : dataset.columns[0].name));
  const displayCell = (value) => value === undefined ? '(missing)' : JSON.stringify(value);

  return (
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="data-quality-title" className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="data-review-panel max-h-[90vh] min-w-0 w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
              <FiShield />
            </span>
            <div>
              <h3 id="data-quality-title" className="text-base font-bold text-slate-900">Data Quality &amp; Cleaning</h3>
              <p className="text-xs font-medium text-slate-500">{dataset?.name}</p>
              {dataset.sourceFile && <button type="button" onClick={downloadOriginal} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"><FiDownload /> Original File</button>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <FiX className="text-lg" />
          </button>
        </div>

        <fieldset disabled={applying || Boolean(historyAction)} className="space-y-5 px-6 py-5">
          {requiredReview && <p className="rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900">Review column types and missing-value policies before visualization. Keeping unresolved cells is an explicit choice; every source row stays.</p>}
          <SourceGrainReview dataset={dataset} onReview={(rowGrain) => updateLocalDataset({ ...buildWorkingDataset(dataset, dataset.rawRows, dataset.columns.map((column) => typeof column === 'string' ? column : column.name)), rowGrain })} />
          {Object.entries(profile?.precisionRisks || {}).map(([field, counts]) => <p key={field} className="rounded-sm border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">{field}: {counts['integer-text']} integer text values exceed safe Number precision; {counts['stored-number']} stored Numbers may already have lost integer detail. Choose Exact decimal for preserved text, explicitly choose native approximation, or review the identifier role.</p>)}
          {applyError && <p role="alert" className="text-sm text-rose-700">{applyError}</p>}
          {/* Quality Score */}
          {sourceQuality && <p className="text-xs text-slate-600">Imported source completeness: {Math.round(100 * (1 - sourceQuality.missingCells / Math.max(1, sourceQuality.totalRows * sourceQuality.totalColumns)))}% · Working completeness: {Math.round(100 * (1 - quality.missingCells / Math.max(1, quality.totalRows * quality.totalColumns)))}%. Filled cells are reviewed estimates, not recovered source values.</p>}
          <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="text-center">
              <p className={`text-4xl font-black ${scoreColor}`}>{quality.qualityScore}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Health Score</p>
            </div>
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
              <IssueChip icon={<FiAlertTriangle className="text-amber-500" />} label="Missing cells" value={quality.missingCells.toLocaleString()} bad={quality.missingCells > 0} />
              <IssueChip icon={<FiAlertTriangle className="text-rose-500" />} label="Duplicate rows" value={quality.duplicateRows.toLocaleString()} bad={quality.duplicateRows > 0} />
              <IssueChip icon={<FiAlertTriangle className="text-orange-500" />} label="Empty rows" value={quality.emptyRows.toLocaleString()} bad={quality.emptyRows > 0} />
              <IssueChip icon={<FiAlertTriangle className="text-sky-500" />} label="Whitespace cells" value={quality.whitespaceCells.toLocaleString()} bad={quality.whitespaceCells > 0} />
              <IssueChip icon={<FiAlertTriangle className="text-indigo-500" />} label="Empty columns" value={String(quality.emptyColumns.length)} bad={quality.emptyColumns.length > 0} />
              <IssueChip icon={<FiAlertTriangle className="text-indigo-500" />} label="Mixed-type cols" value={String(quality.mixedTypeColumns.length)} bad={quality.mixedTypeColumns.length > 0} />
            </div>
          </div>

          <section className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-950">Column profiles</h4>
                <p className="mt-1 text-xs text-slate-600">
                  Evidence-based estimates from {profile?.sampledRows?.toLocaleString() || '…'} sampled rows; missing counts scan all {profile?.rowCount?.toLocaleString() || '…'} rows.
                </p>
              </div>
              {profile && <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-indigo-800">{profile.columns.length} columns</span>}
            </div>
            {profileError && <p role="alert" className="mt-2 text-sm text-rose-700">{profileError}</p>}
            {!profile && !profileError && <p className="mt-2 text-sm text-slate-600">Profiling columns in the background…</p>}
            {profile && (
              <>
                <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-700">
                  <strong>Possible row grain:</strong> {profile.rowGrain.description}. {profile.rowGrain.evidence}
                </p>
                {profile.columns.some((column) => !dataset.columnOverrides?.[column.name]) && (
                  <button type="button" onClick={applyDetectedRoles} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-900 hover:bg-indigo-50">
                    <FiCheck /> Use detected types and roles for unreviewed columns
                  </button>
                )}
                <details className="mt-3" open>
                  <summary className="cursor-pointer text-xs font-semibold text-indigo-900">Review and correct column roles</summary>
                  <div className="mt-2 max-h-96 space-y-2 overflow-y-auto pr-1">
                    {profile.columns.map((column) => {
                      const override = dataset.columnOverrides?.[column.name];
                      const type = override?.type || column.inferredType;
                      const role = override?.role || column.inferredRole;
                      return (
                        <article key={column.name} className="rounded-xl border border-indigo-100 bg-white p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-40 flex-1">
                              <h5 className="break-words text-sm font-bold text-slate-900">{column.name}</h5>
                              <p className="mt-0.5 text-[11px] text-slate-500">Detected {column.inferredType} · {column.inferredRole}{override ? ' · corrected' : ''}</p>
                            </div>
                            <div className="flex min-w-0 flex-wrap gap-2">
                              <label className="text-[10px] font-semibold text-slate-600">
                                Type
                                <select aria-label={`${column.name} data type`} value={type} onChange={(event) => updateColumnOverride(column.name, 'type', event.target.value)} className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-800">
                                  <option value="number" disabled={column.inferredType !== 'number' && column.formattedNumericCount > 0}>Number{column.formattedNumericCount > 0 && column.inferredType !== 'number' ? ' (normalize formatted values first)' : ''}</option><option value="date">Date</option><option value="string">Text / category</option>
                                </select>
                              </label>
                              {type === 'number' && <label className="text-xs">Precision
                                <select aria-label={`${column.name} precision`} value={override?.precision || (profile?.precisionRisks?.[column.name] ? '' : 'native')} onChange={(event) => updateColumnOverride(column.name, 'precision', event.target.value)} className="mt-1 block rounded-sm border border-slate-300 px-2 py-2">
                                  {profile?.precisionRisks?.[column.name] && !override?.precision && <option value="" disabled>Choose precision</option>}
                                  <option value="native">Native floating point</option><option value="exact">Exact decimal tools</option>
                                </select>
                              </label>}
                              <label className="text-xs">Unit / currency
                                <input aria-label={`${column.name} unit`} key={`${column.name}:${override?.unit || ''}`} defaultValue={override?.unit || ''} maxLength={40} onBlur={(event) => { if (event.target.value !== (override?.unit || '')) updateColumnOverride(column.name, 'unit', event.target.value.trim()); }} className="mt-1 block w-28 rounded-sm border border-slate-300 px-2 py-2" />
                              </label>
                              {type === 'date' && <label className="text-xs">Calendar rule
                                <select aria-label={`${column.name} calendar rule`} value={override?.dateKind || 'verbatim'} onChange={(event) => updateColumnOverride(column.name, 'dateKind', event.target.value)} className="mt-1 block rounded-sm border border-slate-300 px-2 py-2">
                                  <option value="verbatim">Keep source groups</option><option value="date-only">YYYY-MM-DD date</option><option value="instant-day">Instant by calendar day</option>
                                </select>
                                <input aria-label={`${column.name} timezone`} defaultValue={override?.timeZone || 'UTC'} maxLength={80} onBlur={(event) => { try { new Intl.DateTimeFormat('en', { timeZone: event.target.value }); updateColumnOverride(column.name, 'timeZone', event.target.value); } catch { setApplyError('Choose a valid IANA timezone such as UTC or Asia/Kolkata.'); } }} className="mt-1 block w-32 rounded-sm border border-slate-300 px-2 py-2" />
                              </label>}
                              <label className="text-[10px] font-semibold text-slate-600">
                                Role
                                <select aria-label={`${column.name} analysis role`} value={role} onChange={(event) => updateColumnOverride(column.name, 'role', event.target.value)} className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-800">
                                  <option value="measure" disabled={type !== 'number'}>Measure</option><option value="dimension">Dimension</option><option value="identifier">Identifier</option><option value="ignore">Ignore in analysis</option>
                                </select>
                              </label>
                            </div>
                          </div>
                          <p className="mt-2 text-[11px] leading-5 text-slate-600">
                            {column.missingCount.toLocaleString()} missing · {column.distinctSampleCount.toLocaleString()} distinct in sample
                            {column.formattedNumericCount ? ` · ${column.formattedNumericCount.toLocaleString()} formatted numeric samples` : ''}
                            {column.outlierCount ? ` · ${column.outlierCount.toLocaleString()} sampled values outside the 1.5×IQR range` : ''}
                            {column.currencyHint ? ` · currency hint: ${column.currencyHint}` : ''}
                            {column.unitHint ? ` · unit hint: ${column.unitHint}` : ''}
                            {column.min !== undefined ? ` · sample range ${column.min} to ${column.max}` : ''}
                            {column.minDate ? ` · sample dates ${new Date(column.minDate).toLocaleDateString()} to ${new Date(column.maxDate).toLocaleDateString()}` : ''}
                          </p>
                          <ul className="mt-1 list-inside list-disc text-[10px] leading-4 text-slate-500">
                            {column.evidence.map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </article>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500">Currency and unit hints are suggestions only; values are never converted automatically.</p>
                </details>
              </>
            )}
          </section>

          {/* Missing values by column */}
          {Object.entries(quality.missingByColumn).filter(([, count]) => count > 0).length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Missing Values by Column</h4>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(quality.missingByColumn)
                  .filter(([, count]) => count > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([col, count]) => (
                    <span key={col} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                      {col}: {count.toLocaleString()}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Cleaning Options */}
          <div>
            <h4 className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
              <FiTool /> Cleaning Actions
            </h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <OptionToggle label="Trim whitespace" desc="Strip leading/trailing spaces" checked={options.trimWhitespace} onChange={() => toggleOption('trimWhitespace')} />
              {!preserveRows && <>
                <OptionToggle label="Remove duplicate rows" desc="Keep first occurrence only" checked={options.removeDuplicates} onChange={() => toggleOption('removeDuplicates')} />
                <OptionToggle label="Remove empty rows" desc="Drop fully-blank records" checked={options.removeEmptyRows} onChange={() => toggleOption('removeEmptyRows')} />
                <OptionToggle label="Drop empty columns" desc="Remove all-missing columns" checked={options.dropEmptyColumns} onChange={() => toggleOption('dropEmptyColumns')} />
              </>}

              <label className="rounded-xl border border-slate-200 bg-white p-3">
                <span className="block text-xs font-bold text-slate-700">Missing numbers →</span>
                <select
                  aria-label="Missing numbers"
                  value={options.missingNumeric}
                  onChange={(e) => setOptions((prev) => ({ ...prev, missingNumeric: e.target.value }))}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 focus:border-emerald-500 focus:outline-hidden"
                >
                  {NUMERIC_FILL_OPTIONS.filter((o) => !preserveRows || o.value !== 'dropRow').map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>

              <label className="rounded-xl border border-slate-200 bg-white p-3">
                <span className="block text-xs font-bold text-slate-700">Missing categories →</span>
                <select
                  aria-label="Missing categories"
                  value={options.missingCategorical}
                  onChange={(e) => setOptions((prev) => ({ ...prev, missingCategorical: e.target.value }))}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 focus:border-emerald-500 focus:outline-hidden"
                >
                  {CATEGORICAL_FILL_OPTIONS.filter((o) => !preserveRows || o.value !== 'dropRow').map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <details className="mt-3 rounded-xl border border-slate-200 p-3" open={requiredReview}>
              <summary className="cursor-pointer text-xs font-bold text-slate-700">Missing-value policy for each column</summary>
              <div className="mt-2 space-y-3">
                {cleaningColumns(dataset).map((column) => {
                  const protectedColumn = ['identifier', 'ignore'].includes(column.role)
                    || /(^|[\s_])(id|uuid|guid|sku|postal_code|zip_code)($|[\s_])/i.test(column.name);
                  const policy = options.columnPolicies[column.name];
                  const choices = column.type === 'number' ? ['keep', 'mean', 'median', 'mode', 'zero', 'value']
                    : column.type === 'date' ? ['keep', 'value'] : ['keep', 'mode', 'unknown', 'value'];
                  return <div key={column.name} className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="min-w-40 flex-1 text-slate-700">{column.name}
                      <select aria-label={`${column.name} missing-value policy`} disabled={protectedColumn} value={policy?.method || ''}
                        onChange={(event) => setOptions((prev) => ({ ...prev, columnPolicies: { ...prev.columnPolicies,
                          [column.name]: { method: event.target.value, value: prev.columnPolicies[column.name]?.value || '' } } }))}
                        className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5">
                        <option value="">{protectedColumn ? 'Protected identifier / ignored column' : 'Use overall policy'}</option>
                        {choices.map((method) => <option key={method} value={method}>{method === 'value' ? 'Custom replacement' : method}</option>)}
                      </select>
                    </label>
                    {policy?.method === 'value' && <input aria-label={`${column.name} replacement`} value={policy.value}
                      onChange={(event) => setOptions((prev) => ({ ...prev, columnPolicies: { ...prev.columnPolicies,
                        [column.name]: { ...policy, value: event.target.value } } }))}
                      className="w-36 rounded-lg border border-slate-200 px-2 py-1.5" />}
                  </div>;
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">Mean, median and mode need observed values. An entirely empty column stays unresolved unless you choose a custom value, zero or Unknown. Date replacements need an explicit choice.</p>
            </details>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Every row and column stays by default, including duplicates and fully blank records. Choose mean or median for missing numbers and mode for missing categories; review the preview before applying.
              Exact decimal fields use validated calculation tools and exact report statistics. Native chart axes and KPI templates omit these fields; source values remain available in tables and exports. Units label values without converting them.
              Identifier columns stay unchanged during filling to avoid inventing keys.
              Applying reversible cleaning keeps a source copy in this browser and uses additional local storage until reset.
            </p>
          </div>

          <section aria-live="polite" className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-900">Cleaning preview</h4>
            {!preview && !previewError && <p className="mt-2 text-sm text-slate-600">Preparing preview…</p>}
            {previewError && <p role="alert" className="mt-2 text-sm text-rose-700">{previewError}</p>}
            {preview && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <PreviewCount label="Rows before → after" value={`${preview.summary.rowsBefore.toLocaleString()} → ${preview.summary.rowsAfter.toLocaleString()}`} />
                  <PreviewCount label="Rows removed" value={preview.summary.rowsRemoved.toLocaleString()} />
                  <PreviewCount label="Columns before → after" value={`${preview.summary.columnsBefore} → ${preview.summary.columnsAfter}`} />
                  <PreviewCount label="Columns removed" value={preview.summary.columnsRemoved.toLocaleString()} />
                </div>
                <ul className="mt-3 space-y-1 text-xs text-slate-700">
                  {preview.changes.length
                    ? preview.changes.map((change, index) => <li key={`${change.type}-${index}`}>• {change.label}</li>)
                    : <li>No changes with these options.</li>}
                </ul>
                {preview.sampleRows.length > 0 && preview.columns.length > 0 && (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-indigo-100 bg-white">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600"><tr>{preview.columns.map((column) => <th key={column} className="px-3 py-2 font-semibold">{column}</th>)}</tr></thead>
                      <tbody>{preview.sampleRows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-t border-slate-100">{preview.columns.map((column) => <td key={column} className="max-w-48 truncate px-3 py-2 text-slate-700">{row[column] == null || row[column] === '' ? '—' : String(row[column])}</td>)}</tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Prior cleaning history */}
          {dataset.sourceRows && <details className="rounded-xl border border-slate-200 p-3">
            <summary className="cursor-pointer text-xs font-bold text-slate-700">Inspect cell history</summary>
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <label>Source row <input aria-label="Inspect source row" type="number" min="1" max={dataset.rawRows.length}
                value={inspectRow} onChange={(event) => setInspectRow(Number(event.target.value) || 1)} className="ml-2 w-20 rounded-sm border p-1" /></label>
              <label>Column <select aria-label="Inspect source column" value={provenance.column} onChange={(event) => setInspectColumn(event.target.value)} className="ml-2 rounded-sm border p-1">
                {dataset.columns.map((column) => { const name = typeof column === 'string' ? column : column.name; return <option key={name}>{name}</option>; })}
              </select></label>
            </div>
            <p className="mt-2 break-all text-xs text-slate-500">Source row ID: {provenance.sourceRowId}</p>
            <p className="mt-2 break-words text-xs">Original: {displayCell(provenance.original)} · Current: {displayCell(provenance.current)}</p>
            <ol className="mt-2 space-y-1 text-xs text-slate-600">{provenance.steps.map((step, index) => <li key={index}>Step {step.step}: {step.method} · {displayCell(step.before)} → {displayCell(step.after)}</li>)}</ol>
            {!provenance.steps.length && <p className="mt-2 text-xs text-slate-500">No recorded cell changes. Older backups may lack cell-level history.</p>}
          </details>}
          {dataset.cleaningLog?.length > 0 && (
            <div className="rounded-xl bg-emerald-50/70 p-3 ring-1 ring-emerald-100">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Applied cleaning steps</p>
              <ol className="mt-2 space-y-1.5 text-xs text-slate-700">
                {dataset.cleaningLog.map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    {index + 1}. {new Date(entry.at).toLocaleString()} · {entry.beforeRows ?? '—'} → {entry.afterRows ?? '—'} rows · {entry.changes?.length || 0} changes
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={handleUndo} disabled={Boolean(historyAction) || !(dataset.cleaningRecipe?.length)} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-50">
                  <FiRotateCcw /> Undo last step
                </button>
                <button type="button" onClick={handleReset} disabled={Boolean(historyAction) || !dataset.sourceRows} className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-50">
                  Reset to imported data
                </button>
              </div>
            </div>
          )}
        </fieldset>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <p className="text-xs font-medium text-slate-500">
            {quality.hasIssues
              ? `${quality.totalIssues.toLocaleString()} issue${quality.totalIssues === 1 ? '' : 's'} detected`
              : 'No issues found — this dataset looks healthy!'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-xs hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={applying || Boolean(historyAction) || !preview || preview.summary.rowsAfter === 0 || (!requiredReview && preview.changes.length === 0)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              <FiCheckCircle /> {applying ? 'Saving…' : requiredReview ? 'Approve Data' : 'Apply Preview'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IssueChip({ icon, label, value, bad }) {
  return (
    <div className={`flex items-center gap-1.5 ${bad ? 'font-bold text-slate-800' : 'text-slate-500'}`}>
      {bad ? icon : <FiCheckCircle className="text-emerald-500" />}
      <span>{value}</span>
      <span className="truncate">{label}</span>
    </div>
  );
}

function PreviewCount({ label, value }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-bold text-slate-900">{value}</p>
    </div>
  );
}

function OptionToggle({ label, desc, checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
        checked ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      {checked ? <FiCheckSquare className="mt-0.5 shrink-0 text-emerald-600" /> : <FiSquare className="mt-0.5 shrink-0 text-slate-300" />}
      <span>
        <span className="block text-xs font-bold text-slate-800">{label}</span>
        <span className="block text-[11px] text-slate-500">{desc}</span>
      </span>
    </button>
  );
}

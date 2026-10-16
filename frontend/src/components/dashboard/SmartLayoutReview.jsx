import { useRef, useState } from 'react';
import { SERVER_WORKSPACE_ENABLED } from '../../config/workspace';
import useModalFocus from '../../hooks/useModalFocus';

const GOALS = [['overview', 'Overview'], ['trends', 'Trends'], ['comparisons', 'Comparisons'], ['distribution', 'Distribution']];

export default function SmartLayoutReview({ candidates, goal, loading, feedbackCount, aiAvailable, aiConsent, aiLoading, aiError, onConsentChange, onRequestAI, onGoalChange, onChoose, onFeedback, onClose }) {
  const [purpose, setPurpose] = useState('');
  const dialog = useRef(null); useModalFocus(dialog, { onClose });
  return <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="smart-layout-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4">
    <section className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Dashboard options</p><h2 id="smart-layout-title" className="mt-1 text-xl font-bold text-slate-900">Choose an analysis goal</h2><p className="mt-1 text-sm text-slate-600">Local candidates use available fields, valid chart settings, field coverage, and chart variety. Preview each plan before applying it.</p></div>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Close</button>
      </div>
      <label className="mt-4 block max-w-sm text-sm font-semibold text-slate-700">Analysis goal<select aria-label="Analysis goal" value={goal === 'auto' ? 'overview' : goal} onChange={(event) => onGoalChange(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2">{GOALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <section className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
        <h3 className="font-semibold text-violet-950">{SERVER_WORKSPACE_ENABLED ? 'Optional AI layout ideas' : 'Browser-local analysis'}</h3>
        {!SERVER_WORKSPACE_ENABLED && <p className="mt-1 text-sm text-violet-900">These recommendations are calculated on your device. For browser-local LLM layout proposals, load a model and use the data assistant's agent mode.</p>}
        {SERVER_WORKSPACE_ENABLED && !aiAvailable && <p className="mt-1 text-sm text-violet-900">AI suggestions are disabled or not configured for this site.</p>}
        {SERVER_WORKSPACE_ENABLED && aiAvailable && <>
          <label className="mt-2 block text-sm text-violet-950">Optional purpose<input value={purpose} onChange={(event) => setPurpose(event.target.value.slice(0, 200))} maxLength={200} placeholder="e.g. find regional sales trends" className="mt-1 block w-full rounded-lg border border-violet-300 bg-white p-2" /></label>
          <label className="mt-3 flex items-start gap-2 text-sm text-violet-950"><input type="checkbox" checked={aiConsent} onChange={(event) => onConsentChange(event.target.checked)} className="mt-1" /><span>Send column names, inferred types and roles, row count, selected goal, and purpose to OpenAI. No row values, files, or calculated results are sent.</span></label>
          <button type="button" disabled={!aiConsent || aiLoading} onClick={() => onRequestAI(purpose)} className="mt-3 rounded-lg bg-violet-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{aiLoading ? 'Requesting AI ideas…' : 'Request AI layout ideas'}</button>
          {aiError && <p role="alert" className="mt-2 text-sm text-red-800">{aiError}</p>}
        </>}
      </section>
      {loading && <p role="status" className="mt-4 text-sm text-slate-600">Building and validating dashboard options…</p>}
      {feedbackCount > 0 && <p role="status" className="mt-3 text-sm text-emerald-800">Saved {feedbackCount} response{feedbackCount === 1 ? '' : 's'} in this browser.</p>}
      {!loading && !candidates.length && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This dataset does not have enough usable fields for a recommended layout yet. You can build one in the manual editor.</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {candidates.map((candidate) => <article key={candidate.id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{candidate.name}</h3><p className="mt-1 text-sm text-slate-600">{candidate.description}</p></div><span className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-800">Score {candidate.score}/100</span></div>
          <p className="mt-3 text-xs text-slate-600">Fields: {candidate.coverage.length ? candidate.coverage.join(', ') : 'row counts only'}</p>
          {candidate.profile && <p className="mt-1 text-xs text-slate-500">Field selection checked {candidate.profile.sampledRows.toLocaleString()} of {candidate.profile.totalRows.toLocaleString()} rows{candidate.profile.complete ? '' : ' in an evenly spaced sample'}. Chart calculations use their full eligible scope.</p>}
          <ul className="mt-2 space-y-1 text-sm text-slate-800">{candidate.layout.map((card) => <li key={card.i}>{card.title} <span className="text-slate-500">· {card.chartType}</span></li>)}</ul>
          <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={loading} onClick={() => onChoose(candidate)} className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Use this layout</button><button type="button" disabled={loading} onClick={() => onFeedback(candidate, 'rejected')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">Not useful</button></div>
        </article>)}
      </div>
      <p className="mt-4 text-xs text-slate-500">Scores describe rule-based field and chart fit, not statistical confidence. Recommendation feedback stays in this browser and contains only goal, chart types, score, and choice.</p>
    </section>
  </div>;
}

import { useRef } from 'react';
import useModalFocus from '../../hooks/useModalFocus';

export default function AgentLayoutReview({ proposal, computations, onApply, onClose, editing = false }) {
  const dialog = useRef(null); useModalFocus(dialog, { onClose });
  return <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="agent-layout-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4">
    <section className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
      <h2 id="agent-layout-title" className="text-xl font-bold">{proposal.title}</h2>
      <p className="mt-2 text-sm text-slate-600">Review the proposed cards and verified calculations. {editing ? 'Applying changes only the selected chart configuration and keeps its position and size.' : "Applying replaces the current layout's cards."} You can undo the change from the dashboard toolbar.</p>
      <div className={`mt-4 grid gap-3 ${proposal.density === 'compact' ? 'sm:grid-cols-2' : ''}`}>{proposal.cards.map((card) => {
        const calculation = computations.find((item) => item.evidenceId === card.evidenceId);
        return <article key={card.i} className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <h3 className="font-semibold">{card.title}</h3><p className="mt-1 text-xs">{card.chartType} · {card.aggregation} {card.preferredY}{card.preferredX ? ` by ${card.preferredX}` : ''}</p>
          <ul className="mt-2 text-sm">{calculation?.results.slice(0, 4).map((result, index) => <li key={index}>{result.group ?? '(Missing group)'}: {result.value ?? 'uncomputable'}</li>)}</ul>
          <p className="mt-2 text-xs text-slate-600">{calculation?.eligibleRows} eligible rows; {calculation?.missingRows} missing or invalid values excluded. Evidence: {card.evidenceId}.</p>
        </article>;
      })}</div>
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2">Cancel</button><button type="button" onClick={onApply} className="rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white">Apply reviewed layout</button></div>
    </section>
  </div>;
}

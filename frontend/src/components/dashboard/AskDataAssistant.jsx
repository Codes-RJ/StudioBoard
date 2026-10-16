import { lazy, Suspense, useState, useRef, useEffect, useMemo, useId } from 'react';
import { FiZap, FiSearch, FiArrowRight, FiCheck, FiSliders, FiFilter, FiRotateCcw, FiX, FiChevronDown } from 'react-icons/fi';
import { generateQuestionLibrary, generateSuggestedPrompts, getDatasetRevision } from '../../utils/aiDatasetIdentity';
import { askDatasetQuestion, cancelAssistantWork } from '../../utils/aiQueryClient';
import { qualityRevisionKey } from '../../utils/qualityReview';
import useAssistantConversation from '../../hooks/useAssistantConversation';
import { experimentalLocalLLM } from '../../utils/localAI/releasePolicy';
import { prepareAssistantMessage } from '../../utils/assistantConversation';
const LocalAIControls = lazy(() => import('./LocalAIControls'));
const AgentLayoutReview = lazy(() => import('./AgentLayoutReview'));
const ExactMetricCalculator = lazy(() => import('./ExactMetricCalculator'));
import { addLayoutCard } from '../../utils/layoutModel';
import { getDatasetColumnGroups, validateGraphConfiguration } from '../../utils/graphConfiguration';
import { formatChartTypeLabel } from '../../utils/chartTypes';
import { useDashboard } from '../../context/DashboardContext';
import toast from 'react-hot-toast';
import DisclosurePanel from '../common/DisclosurePanel';

let messageId = 0;
const nextId = () => `msg_${Date.now()}_${messageId++}`;

/**
 * Conversational "Ask Your Data" AI assistant.
 * Multi-turn chat with history — each answer includes direct answers,
 * analyst-style insights, and one-click actions (chart / filter).
 */
export default function AskDataAssistant({ dataset, onCardAdded, compact = false }) {
  const [expanded, setExpanded] = useState(!compact);
  const bodyId = useId();
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [addedCardIds, setAddedCardIds] = useState({});
  const [isThinking, setIsThinking] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [mode, setMode] = useState('rules');
  const [agentStatus, setAgentStatus] = useState('');
  const [layoutReview, setLayoutReview] = useState(null);
  const { currentLayout, applyLayoutChange, setGlobalFilter, globalFilters, datasets = [dataset], loadLocalDatasets } = useDashboard();
  const scrollRef = useRef(null);
  const requestRef = useRef(null);
  const datasetRevision = qualityRevisionKey(dataset);
  const dashboardScopeKey = JSON.stringify(Object.entries(globalFilters || {}).sort(([left], [right]) => left.localeCompare(right)));
  const activeScopeCount = Object.keys(globalFilters || {}).length;
  const relationships = datasets.flatMap((source) => source.relationships || []);
  const aiSources = datasets.filter((source) => (source.rawRows?.length || source.metadataOnly && source.rowCount > 0) && !source.isFolderOverview && (source.id !== 'local_sample_saas' || source.id === dataset.id));
  const graphScopeKey = ['agent', 'rag'].includes(mode) ? JSON.stringify([aiSources.map((source) => qualityRevisionKey(source)), relationships]) : '';
  const conversationKey = `conversation:${JSON.stringify([datasetRevision, dashboardScopeKey, mode, graphScopeKey])}`;
  const { restored: conversationReady, storageError, clear: clearConversation } = useAssistantConversation(conversationKey, ['agent', 'rag'].includes(mode) ? aiSources.map((source) => source.id) : [dataset.id], messages, setMessages);

  const suggestedPrompts = useMemo(() => generateSuggestedPrompts(dataset), [datasetRevision]);
  const questionLibrary = useMemo(() => generateQuestionLibrary(dataset), [datasetRevision]);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight,
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth' });
  }, [messages, isThinking]);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setMessages([]);
    setAddedCardIds({});
    setLayoutReview(null);
    setQuery('');
    setIsThinking(false);
    void import('../../utils/localAI/client').then(({ clearMemoryEvidence }) => clearMemoryEvidence());
    return () => { requestRef.current?.abort(); cancelAssistantWork(); };
  }, [datasetRevision]);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    // Answers and actions are scoped to the dashboard filters that produced
    // them. Remove stale recommendations when that scope changes so a chart
    // cannot be created from an answer computed against a different slice.
    setMessages([]);
    setAddedCardIds({});
    setIsThinking(false);
  }, [dashboardScopeKey, mode, graphScopeKey]);

  useEffect(() => { setLayoutReview(null); }, [datasetRevision, dashboardScopeKey, mode, graphScopeKey]);

  const handleAsk = async (textToAsk = query) => {
    if (!textToAsk || !textToAsk.trim() || isThinking || isIndexing || !conversationReady) return;

    setExpanded(true);
    const userMsg = { id: nextId(), role: 'user', text: textToAsk.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setQuery('');
    setIsThinking(true);

    const controller = new AbortController();
    requestRef.current = controller;
    const previousContext = [...messages].reverse().find((message) => (
      message.role === 'assistant' && message.result?.interpretation && !message.result?.error
    ))?.result.interpretation || null;
    try {
      const sources = ['agent', 'rag'].includes(mode) ? aiSources.map((source) => source.id === dataset.id ? dataset : source) : [dataset];
      if (controller.signal.aborted) return;
      const options = {
        signal: controller.signal,
        scopeFilters: globalFilters || {},
        context: previousContext,
        datasets: sources, relationships, layout: currentLayout, mode, history: messages,
        onStep: (step) => setAgentStatus(step.status)
      };
      const message = prepareAssistantMessage(textToAsk);
      const answer = message.reply || (mode === 'rules' ? await askDatasetQuestion(message.query, dataset, options)
        : await (await import('../../utils/localAI/client')).askWithLocalAI(message.query, dataset, options));
      if (controller.signal.aborted) return;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          result: answer.error ? { error: answer.error } : answer
        }
      ]);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setMessages((prev) => [...prev, {
          id: nextId(), role: 'assistant', result: { error: error?.message || 'Analysis failed.', ...(error.agentSteps ? { steps: error.agentSteps } : {}) }
        }]);
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (requestRef.current === null) setIsThinking(false);
      setAgentStatus('');
    }
  };

  const handleClearChat = () => {
    setLayoutReview(null);
    requestRef.current?.abort();
    requestRef.current = null;
    setMessages([]);
    setAddedCardIds({});
    setQuery('');
    setIsThinking(false);
    void clearConversation();
  };

  const handleApplyToCard = (result, assistantMessageId) => {
    if (!result?.recommendedCard) return;
    if (!currentLayout) {
      toast.error('Create or select a dashboard layout before adding a chart.');
      return;
    }

    const existingCardId = addedCardIds[assistantMessageId];
    const existingCardStillExists = existingCardId && currentLayout.layout?.some((item) => item.i === existingCardId);
    if (existingCardStillExists) {
      onCardAdded?.(existingCardId);
      toast('This chart is already on the dashboard.');
      return;
    }

    const updatedLayoutItems = addLayoutCard(currentLayout.layout, result.recommendedCard);
    const addedCard = updatedLayoutItems.at(-1);
    const validation = validateGraphConfiguration(addedCard, getDatasetColumnGroups(dataset));
    if (!validation.valid) {
      toast.error(`This chart needs adjustment: ${validation.issues.join(' ')}`);
      return;
    }
    const updated = { ...currentLayout, layout: updatedLayoutItems };
    applyLayoutChange(updated);
    setAddedCardIds((current) => ({ ...current, [assistantMessageId]: addedCard.i }));
    onCardAdded?.(addedCard.i);
    toast((toastInstance) => (
      <span className="flex items-center gap-3">
        Added &quot;{result.recommendedCard.title}&quot;.
        <button
          type="button"
          className="font-semibold text-indigo-800 underline underline-offset-4 hover:text-indigo-950"
          onClick={() => {
            // Remove the exact chart created by this answer. A generic history
            // undo could accidentally revert a newer edit made while this toast
            // was visible.
            applyLayoutChange((activeLayout) => {
              if (!activeLayout?.layout?.some((item) => item.i === addedCard.i)) return activeLayout;
              return {
                ...activeLayout,
                layout: activeLayout.layout.filter((item) => item.i !== addedCard.i)
              };
            });
            setAddedCardIds((current) => {
              const next = { ...current };
              delete next[assistantMessageId];
              return next;
            });
            toast.dismiss(toastInstance.id);
          }}
        >
          Undo
        </button>
      </span>
    ), { duration: 6000 });
  };

  const handleApplyFilter = (filterAction) => {
    if (filterAction && setGlobalFilter) {
      setGlobalFilter(filterAction.column, filterAction.value);
      toast.success(`Applied filter: ${filterAction.column} = "${filterAction.value}"`);
    }
  };

  const hasAnalyzableRows = Array.isArray(dataset?.rawRows) && dataset.rawRows.length > 0;
  if (!hasAnalyzableRows) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5" aria-labelledby="data-assistant-unavailable-title">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-600 text-white"><FiZap aria-hidden="true" /></span>
          <h3 id="data-assistant-unavailable-title" className="text-sm font-bold text-amber-950">Local Data Assistant unavailable</h3>
        </div>
        <p className="mt-2 text-sm leading-6 text-amber-900">
          The assistant analyzes rows loaded in this browser. Open or import a local CSV or Excel file to ask questions; server-only datasets are not sent to the local analysis engine.
        </p>
      </section>
    );
  }

  return (
    <div className={`assistant-panel ${compact ? 'assistant-compact' : ''}`}>
      {layoutReview && <Suspense fallback={<p role="status">Loading layout preview…</p>}><AgentLayoutReview editing={Boolean(layoutReview.result.chartEditProposal)} proposal={layoutReview.result.layoutProposal || { title: layoutReview.result.chartEditProposal.card.title, cards: [{ ...layoutReview.result.chartEditProposal.card, i: layoutReview.result.chartEditProposal.cardId }] }} computations={layoutReview.result.computations || []} onClose={() => setLayoutReview(null)} onApply={() => {
        if (!currentLayout || JSON.stringify(currentLayout) !== layoutReview.layoutSnapshot) { toast.error('The current layout changed. Close and reopen this preview.'); return; }
        const edit = layoutReview.result.chartEditProposal;
        if (edit) {
          const target = currentLayout.layout.find((card) => card.i === edit.cardId);
          if (edit.sourceRevision !== qualityRevisionKey(dataset) || edit.layoutId !== currentLayout.id || JSON.stringify(target) !== edit.before || !validateGraphConfiguration(edit.card, getDatasetColumnGroups(dataset)).valid) { toast.error('The chart or source changed. Ask for a new proposal.'); return; }
          applyLayoutChange({ ...currentLayout, layout: currentLayout.layout.map((card) => card.i === edit.cardId ? { ...card, ...edit.card } : card) });
          setLayoutReview(null); toast.success('Reviewed chart edit applied. Use Undo to restore it.'); return;
        }
        const cards = layoutReview.result.layoutProposal.cards;
        if (cards.some((card) => !validateGraphConfiguration(card, getDatasetColumnGroups(dataset)).valid)) { toast.error('A proposed card is no longer valid for this source.'); return; }
        applyLayoutChange({ ...currentLayout, name: layoutReview.result.layoutProposal.title, layout: cards });
        setLayoutReview(null); toast.success('Reviewed layout applied. Use Undo to restore the previous cards.');
      }} /></Suspense>}
      <div className="flex flex-col gap-3">

        {/* Header */}
        <div className="assistant-heading">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
              <FiZap className="text-sm" />
            </span>
            <h3 className="text-sm font-bold tracking-tight text-indigo-950">Local Data Assistant</h3>
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
              {mode === 'rules' ? 'Rule-based' : mode === 'search' ? 'Local evidence' : mode === 'rag' ? 'Local LLM RAG' : 'Local LLM agent'}
            </span>
            {activeScopeCount > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                {activeScopeCount} dashboard filter{activeScopeCount === 1 ? '' : 's'} applied
              </span>
            )}
          </div>
          <div className="assistant-header-actions">
            <DisclosurePanel label="Browser AI and local search">        <p className="text-xs font-medium leading-5 text-slate-600">
          {mode === 'rules' ? 'Uses deterministic calculations over the currently loaded local rows.' : 'Uses local evidence with source and revision citations. Numerical tools scan the complete eligible rows.'} Validate important decisions against the source data.
        </p>
        <Suspense fallback={<p className="text-xs text-slate-600">Loading browser AI controls…</p>}><LocalAIControls inline mode={mode} onModeChange={setMode} busy={isThinking} dataset={dataset} filters={globalFilters || {}} onIndexBusy={setIsIndexing} /></Suspense>
</DisclosurePanel>
            <button type="button" className="info-button" aria-label={expanded ? 'Collapse assistant details' : 'Expand assistant details'} aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded(value => !value)}><FiChevronDown aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} /></button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClearChat}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-white hover:text-slate-800 transition-colors"
              title="Clear conversation"
            >
              <FiRotateCcw /> Clear Chat
            </button>
          )}
          </div>
        </div>

        {/* Query Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk();
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <FiSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              aria-label="Ask a question about this dataset"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask about a total, trend or comparison…"
              className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm font-medium text-slate-800 shadow-xs placeholder:text-slate-400 focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <button
            type="submit"
            data-assistant-lifecycle={experimentalLocalLLM ? JSON.stringify({ isThinking, isIndexing, conversationReady, mode,
              requestActive: Boolean(requestRef.current), sourceRevision: datasetRevision, renderedAt: Date.now() }) : undefined}
            disabled={isThinking || isIndexing || !conversationReady}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            Ask <FiArrowRight />
          </button>
          {isThinking && (
            <button
              type="button"
              onClick={() => requestRef.current?.abort()}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <FiX /> Cancel
            </button>
          )}
        </form>

        {storageError && <p role="status" className="text-xs text-amber-800">{storageError}</p>}
        {!conversationReady && <p role="status" className="text-xs text-slate-600">Restoring conversation…</p>}
        {agentStatus && <p role="status" className="text-xs text-indigo-800">{agentStatus}</p>}

        <div id={bodyId} hidden={!expanded} className="assistant-details">
        {Object.values(dataset.columnOverrides || {}).some((override) => override.precision === 'exact' && override.role === 'measure') && <Suspense fallback={null}><ExactMetricCalculator dataset={dataset} filters={globalFilters} /></Suspense>}

        {/* Conversation Thread */}
        {messages.length > 0 && (
          <div
            ref={scrollRef}
            className="max-h-[380px] space-y-4 overflow-y-auto rounded-2xl border border-indigo-100 bg-white/80 p-4 shadow-inner"
          >
            {messages.map((msg) =>
              msg.role === 'user' ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <AssistantMessage
                  key={msg.id}
                  result={msg.result}
                  isChartAdded={Boolean(addedCardIds[msg.id] && currentLayout?.layout?.some((item) => item.i === addedCardIds[msg.id]))}
                  onApplyChart={(result) => handleApplyToCard(result, msg.id)}
                  onReviewLayout={(result) => setLayoutReview({ result, layoutSnapshot: JSON.stringify(currentLayout) })}
                  onApplyFilter={handleApplyFilter}
                  onClarify={(option) => handleAsk(`${msg.result.query} using ${option}`)}
                />
              )
            )}

            {isThinking && (
              <div className="flex justify-start" aria-live="polite" aria-label="Analyzing question">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-indigo-100 bg-white px-4 py-3 shadow-xs">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="h-2 w-2 animate-bounce rounded-full bg-indigo-400"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Suggested Prompt Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="mr-1 text-xs font-medium text-slate-500">Try asking:</span>
          {suggestedPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handleAsk(prompt)}
              disabled={isThinking || isIndexing || !conversationReady}
              className="rounded-full border border-indigo-200/80 bg-white px-3 py-1 text-xs font-medium text-indigo-900 shadow-2xs transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
            >
              <FiArrowRight className="mr-1 inline-block h-3 w-3" aria-hidden="true" />{prompt}
            </button>
          ))}
        </div>

        <details className="rounded-2xl border border-indigo-100 bg-white/75 px-4 py-3">
          <summary className="cursor-pointer text-xs font-bold text-indigo-900">
            What can I ask? Browse {questionLibrary.reduce((total, group) => total + group.questions.length, 0)} examples
          </summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {questionLibrary.map((group) => (
              <section key={group.category} aria-labelledby={`question-group-${group.category.replaceAll(' ', '-').toLowerCase()}`}>
                <h4 id={`question-group-${group.category.replaceAll(' ', '-').toLowerCase()}`} className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  {group.category}
                </h4>
                <div className="space-y-1">
                  {group.questions.map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => handleAsk(question)}
                      disabled={isThinking || isIndexing || !conversationReady}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium leading-4 text-slate-700 transition-colors hover:bg-indigo-50 hover:text-indigo-900 disabled:opacity-50"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </details>
        </div>
      </div>
    </div>
  );
}

/**
 * A single assistant response bubble with direct answer + insights + actions.
 */
function AssistantMessage({ result, isChartAdded, onApplyChart, onReviewLayout, onApplyFilter, onClarify }) {
  if (result.error) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 shadow-xs">
          {result.error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] space-y-2.5 rounded-2xl rounded-bl-md border border-indigo-100 bg-white p-3.5 shadow-xs">
        {/* Intent badge + direct answer */}
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/80 p-3">
          {result.intent && (
            <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">
              {result.intent.replaceAll('_', ' ')}
            </p>
          )}
          <p className="mt-0.5 text-sm font-bold leading-snug text-slate-900">{result.directAnswer}</p>
        </div>
        {result.modelNarrative && <p className="text-xs text-slate-600"><strong>Model interpretation (verify against cited facts):</strong> {result.modelNarrative}</p>}
        {result.coverage && <p className="text-xs text-slate-600">Search coverage: {result.coverage.indexedRows} of {result.coverage.eligibleRows} eligible rows; {result.coverage.indexedColumns} of {result.coverage.totalColumns} fields per row. {result.coverage.retrieval || 'Stored evidence retrieval; coverage is bounded.'} Returned text is clipped. Calculations use full eligible rows. {result.semanticRecords ?? 0} stored evidence records have semantic vectors.</p>}
        {result.coverage?.semantic && <p className="text-xs text-slate-600">Saved semantic index: {result.coverage.semantic.complete ? 'complete' : 'partial'}; {result.coverage.semantic.completedSourcePositions} of {result.coverage.semantic.totalSourceRows} source positions processed. Only eligible rows are embedded.</p>}
        {result.retrievalCoverage?.map((coverage) => <p key={coverage.datasetId} className="text-xs text-slate-600">Search scope for {coverage.source}: {coverage.indexedRows} of {coverage.eligibleRows} eligible rows; {coverage.indexedColumns} of {coverage.totalColumns} fields per row; {coverage.semanticRecords} semantic records. Text is clipped.</p>)}
        {result.graphCoverage && <p className="text-xs text-slate-600">Reviewed graph: {result.graphCoverage.approvedSources} sources, {result.graphCoverage.acceptedEdges} valid relationships, {result.graphCoverage.excludedEdges} excluded relationships. Entity nodes are bounded examples; join calculations use complete eligible sources.</p>}
        {result.computations?.length > 0 && <details className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600"><summary className="cursor-pointer font-semibold">Calculation scope and missing values</summary>{result.computations.map((calculation, index) => <div key={index} className="mt-2">
          <p>{calculation.metric}: {calculation.aggregation}{calculation.weight ? ` weighted by ${calculation.weight}` : ''} · {calculation.scope}</p>
          {(calculation.precision || calculation.unit) && <p>{calculation.precision}{calculation.unit ? ` · Unit: ${calculation.unit}; no unit conversion` : ''}</p>}
          {calculation.eligibleRows != null && <p>{calculation.eligibleRows} eligible rows of {calculation.sourceRows} source rows; {calculation.contributingRows} contribute; {calculation.missingRows} excluded missing/invalid values.</p>}
          {calculation.imputedMeasureRows > 0 && <p>{calculation.imputedMeasureRows} contributing measures were filled during reviewed cleaning; these are transformed values.</p>}
          {calculation.imputedWeightRows > 0 && <p>{calculation.imputedWeightRows} contributing weights were filled during reviewed cleaning.</p>}
          {calculation.matchedRows != null && <p>{calculation.matchedRows} joined rows; {calculation.missingRows} missing/invalid measures.</p>}
          <p>{calculation.results.length} displayed groups of {calculation.totalGroups}. Missing numeric results remain uncomputable.</p>
        </div>)}</details>}
        {result.citations?.length > 0 && <details className="rounded-xl border border-slate-200 p-3 text-xs">
          <summary className="cursor-pointer font-semibold">Source evidence ({result.citations.length})</summary>
          <ol className="mt-2 space-y-3">{result.citations.map((citation) => <li key={citation.id}>
            <p className="font-semibold">{citation.source}{citation.worksheet ? ` / ${citation.worksheet}` : ''} · {citation.fields?.join(', ')}</p>
            {citation.documentBlock && <p>Document {citation.documentPage ? `page ${citation.documentPage}, ` : ''}block {citation.documentBlock}</p>}
            <p className="whitespace-pre-wrap break-words">{citation.text}</p>
            {citation.transformedFields?.length > 0 && <p className="text-amber-800">Reviewed transformations affect: {citation.transformedFields.join(', ')}. Inspect cell history in Data Health.</p>}
            <p className="mt-1 break-all text-slate-500">{citation.sourceRowId || citation.id} · Revision: {citation.revision}</p>
          </li>)}</ol>
        </details>}
        {result.steps?.length > 0 && <details className="text-xs text-slate-600"><summary className="cursor-pointer">Local tool steps</summary>{result.steps.map((step, index) => <p key={index}>{step.tool}: {step.success ? 'completed' : step.error}</p>)}</details>}
        {result.graphEvidence?.length > 0 && <details className="text-xs text-slate-600"><summary className="cursor-pointer">Reviewed relationship path</summary>{result.graphEvidence.map((join, index) => <p key={index}>{join.from} → {join.to} ({join.leftColumns.join(', ')} ↔ {join.rightColumns.join(', ')}): {join.matchedTuples} joined rows; {join.unmatchedTuples} unmatched input rows; {join.unmatchedSourceRows} unmatched target rows.</p>)}</details>}

        {/* Bullet takeaways */}
        {result.clarification?.options?.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Clarification options">
          {result.clarification.options.map((option) => <button key={option} type="button" onClick={() => onClarify(option)} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-800">Use {option}</button>)}
        </div>}
        {result.keyInsights?.length > 0 && (
          <div className="space-y-1 pl-1">
            {result.keyInsights.map((insight, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs font-medium text-slate-600">
                <FiCheck className="mt-0.5 shrink-0 text-emerald-600" />
                <span>{insight}</span>
              </div>
            ))}
          </div>
        )}

        {result.interpretation && (
          <details className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <summary className="cursor-pointer font-semibold text-slate-700">
              How I interpreted this · {Math.round((result.confidence || 0) * 100)}% confidence
            </summary>
            <div className="mt-2 space-y-1">
              <p>Measures: {result.interpretation.metrics?.join(', ') || 'none'}</p>
              <p>Dimensions: {result.interpretation.dimensions?.join(', ') || 'none'}</p>
              <p>Aggregation: {result.interpretation.aggregation || 'none'} · Matching rows: {result.interpretation.matchedRows ?? 'not run'}</p>
              {result.interpretation.filters?.length > 0 && (
                <p>Filters: {result.interpretation.filters.map((filter) => `${filter.column} ${filter.operator} ${filter.value}`).join('; ')}</p>
              )}
              {result.interpretation.dashboardFilters?.length > 0 && (
                <p>Dashboard scope: {result.interpretation.dashboardFilters.map((filter) => `${filter.column} = ${filter.value}`).join('; ')}</p>
              )}
              {result.assumptions?.map((assumption) => <p key={assumption}>Assumption: {assumption}</p>)}
            </div>
          </details>
        )}

        {/* Action buttons */}
        {(result.layoutProposal || result.chartEditProposal) && <button type="button" onClick={() => onReviewLayout(result)} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white">{result.chartEditProposal ? 'Preview chart edit' : 'Preview proposed layout'}</button>}
        {(result.recommendedCard || result.filterAction) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
            {result.recommendedCard && (
              <button
                type="button"
                onClick={() => onApplyChart(result)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold shadow-2xs transition-colors ${isChartAdded ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
              >
                {isChartAdded ? <FiCheck /> : <FiSliders />}
                {isChartAdded ? 'View added chart' : `Add ${formatChartTypeLabel(result.recommendedCard.chartType)} chart: ${result.recommendedCard.title}`}
              </button>
            )}
            {result.filterAction && (
              <button
                type="button"
                onClick={() => onApplyFilter(result.filterAction)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
              >
                <FiFilter /> Filter to &quot;{result.filterAction.value}&quot;
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { FiChevronDown, FiCopy, FiEdit3, FiPlus, FiSave, FiStar, FiTrash2 } from 'react-icons/fi';
import { useDashboard } from '../../context/DashboardContext';
import toast from 'react-hot-toast';
import DisclosurePanel from '../common/DisclosurePanel';
import { describeApiError } from '../../utils/apiError';
import { addLayoutCard } from '../../utils/layoutModel';
import { recordDashboardFeedback } from '../../utils/layoutFeedback';
import api from '../../services/api';
import { SERVER_WORKSPACE_ENABLED } from '../../config/workspace';
import { useSiteSettings } from '../../context/SiteSettingsContext';
import { qualityRevisionKey } from '../../utils/qualityReview';

const SmartLayoutReview = lazy(() => import('./SmartLayoutReview'));

export default function LayoutSelector({ compact = false }) {
  const { settings } = useSiteSettings();
  const {
    layouts,
    currentLayout,
    selectLayout,
    applyLayoutChange,
    saveLayout,
    renameLayout,
    duplicateLayout,
    setDefaultLayout,
    defaultLayoutId,
    deleteLayout,
    selectedDataset,
    generateSmartLayout,
    resetToDefaultLayout,
    confirmDiscardLayoutChanges
  } = useDashboard();
  const [newLayoutName, setNewLayoutName] = useState('');
  const [showNewLayout, setShowNewLayout] = useState(false);
  const [showSmartReview, setShowSmartReview] = useState(false);
  const [candidateGoal, setCandidateGoal] = useState('auto');
  const [candidates, setCandidates] = useState([]);
  const [isPlanning, setIsPlanning] = useState(false);
  const [feedbackCount, setFeedbackCount] = useState(0);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const reviewVersion = useRef(0);
  const aiRequest = useRef(null);
  const reviewDatasetKey = useRef(null);
  const localPlanner = useRef(null);
  const selectedDatasetKey = selectedDataset ? `${selectedDataset.id}:${qualityRevisionKey(selectedDataset)}` : null;

  useEffect(() => {
    reviewVersion.current += 1;
    aiRequest.current?.abort();
    setShowSmartReview(false);
    setCandidates([]);
    setAiConsent(false);
    setAiLoading(false);
    setIsPlanning(false);
    return () => {
      reviewVersion.current += 1;
      aiRequest.current?.abort();
    };
  }, [selectedDatasetKey]);

  const closeSmartReview = () => {
    reviewVersion.current += 1;
    aiRequest.current?.abort();
    setShowSmartReview(false);
    setAiConsent(false);
    setAiLoading(false);
    setIsPlanning(false);
  };

  const isGeneratedLayout = currentLayout?.source === 'planner';
  const currentLayoutValue = isGeneratedLayout ? '__generated__' : (currentLayout?.id || '');

  const handleSaveLayout = () => {
    if (!newLayoutName.trim()) {
      toast.error('Please enter a layout name');
      return;
    }

    saveLayout({ name: newLayoutName, layout: currentLayout?.layout || [] });
    setNewLayoutName('');
    setShowNewLayout(false);
  };

  const handleAddCard = () => {
    if (!currentLayout) {
      toast.error('Select or create a layout before adding a card.');
      return;
    }

    const updatedLayout = {
      ...currentLayout,
      layout: addLayoutCard(currentLayout.layout)
    };

    applyLayoutChange(updatedLayout);
  };

  const handleDeleteLayout = (id) => {
    if (!confirmDiscardLayoutChanges()) return;
    if (confirm('Are you sure you want to delete this layout?')) deleteLayout(id);
  };

  const handleRenameLayout = async () => {
    const name = window.prompt('Rename dashboard layout', currentLayout?.name || '');
    if (name?.trim()) await renameLayout(currentLayout.id, name);
  };

  const handleGenerateSmartLayout = async () => {
    if (!selectedDataset) return;
    if (!confirmDiscardLayoutChanges()) return;
    const version = ++reviewVersion.current;
    reviewDatasetKey.current = selectedDatasetKey;
    aiRequest.current?.abort();
    setAiLoading(false);
    setCandidateGoal('overview');
    setCandidates([]);
    setFeedbackCount(0);
    setAiConsent(false);
    setAiError('');
    setAiAvailable(false);
    setShowSmartReview(true);
    setIsPlanning(true);
    try {
      const [{ getDatasetColumnGroups }, { generateDashboardCandidates }, { profileDashboardPlanning }] = await Promise.all([
        import('../../utils/graphConfiguration'),
        import('../../utils/dashboardCandidatePlanner'),
        import('../../utils/dashboardPlanningProfile'),
      ]);
      if (version !== reviewVersion.current) return;
      localPlanner.current = { getDatasetColumnGroups, generateDashboardCandidates, profileDashboardPlanning };
      const groups = profileDashboardPlanning(selectedDataset, getDatasetColumnGroups(selectedDataset));
      const options = generateDashboardCandidates(selectedDataset.id, groups, { goal: 'overview' });
      if (!options.length && !selectedDataset.rawRows) {
        const legacy = await generateSmartLayout(selectedDataset.id);
        if (version !== reviewVersion.current) return;
        setCandidates([{ ...legacy, id: legacy.id, score: 60, goal: 'overview', description: 'Server-provided layout plan.', coverage: [], layout: legacy.layout }]);
      } else setCandidates(options);
      if (SERVER_WORKSPACE_ENABLED && settings.features.aiLayoutSuggestions !== 'disabled') {
        try {
          const { data } = await api.get('/ai/status');
          if (version === reviewVersion.current) setAiAvailable(Boolean(data.available));
        } catch {
          if (version === reviewVersion.current) setAiAvailable(false);
        }
      }
    } catch (error) {
      if (version !== reviewVersion.current) return;
      toast.error(describeApiError(error, 'Failed to generate smart layout.').text);
      setShowSmartReview(false);
    } finally {
      if (version === reviewVersion.current) setIsPlanning(false);
    }
  };
  const handleGoalChange = async (goal) => {
    const version = ++reviewVersion.current;
    aiRequest.current?.abort();
    setAiLoading(false);
    setAiConsent(false);
    setCandidateGoal(goal);
    setAiError('');
    try {
      if (!localPlanner.current) setIsPlanning(true);
      const planner = localPlanner.current || await Promise.all([
        import('../../utils/graphConfiguration'), import('../../utils/dashboardCandidatePlanner'), import('../../utils/dashboardPlanningProfile')
      ]).then(([graph, candidates, profile]) => ({ getDatasetColumnGroups: graph.getDatasetColumnGroups,
        generateDashboardCandidates: candidates.generateDashboardCandidates, profileDashboardPlanning: profile.profileDashboardPlanning }));
      const { getDatasetColumnGroups, generateDashboardCandidates, profileDashboardPlanning } = planner;
      if (version === reviewVersion.current) setCandidates(generateDashboardCandidates(selectedDataset.id, profileDashboardPlanning(selectedDataset, getDatasetColumnGroups(selectedDataset)), { goal }));
    } catch (error) {
      if (version === reviewVersion.current) toast.error(describeApiError(error, 'Failed to generate smart layout.').text);
    } finally {
      if (version === reviewVersion.current) setIsPlanning(false);
    }
  };
  const handleChooseCandidate = (candidate) => {
    if (reviewDatasetKey.current !== selectedDatasetKey || isPlanning) return;
    recordDashboardFeedback({ goal: candidate.goal, score: candidate.score, chartTypes: candidate.layout.map(({ chartType }) => chartType), decision: 'accepted' });
    selectLayout({
      ...candidate,
      id: `layout_${selectedDataset.id}_${candidate.goal}`,
      name: `${selectedDataset.name || 'Dataset'} · ${candidate.name}`,
      source: 'planner',
      localOnly: Boolean(selectedDataset.isLocal || selectedDataset.rawRows),
      sourceDatasetId: selectedDataset.id,
      layout: candidate.layout,
    });
    closeSmartReview();
  };
  const handleCandidateFeedback = (candidate, decision) => {
    recordDashboardFeedback({ goal: candidate.goal, score: candidate.score, chartTypes: candidate.layout.map(({ chartType }) => chartType), decision });
    setFeedbackCount((count) => count + 1);
  };
  const handleRequestAI = async (purpose) => {
    if (!SERVER_WORKSPACE_ENABLED || !aiConsent || !selectedDataset || aiLoading) return;
    const version = reviewVersion.current;
    const controller = new AbortController();
    aiRequest.current?.abort();
    aiRequest.current = controller;
    setAiConsent(false);
    setAiLoading(true);
    setAiError('');
    try {
      const { buildAIDashboardProfile, validateAIDashboardProposal } = await import('../../utils/aiLayoutProposal');
      if (controller.signal.aborted || version !== reviewVersion.current) return;
      const profile = buildAIDashboardProfile(selectedDataset, candidateGoal === 'auto' ? 'overview' : candidateGoal, purpose);
      const { data } = await api.post('/ai/dashboard-plan', profile, { signal: controller.signal });
      if (controller.signal.aborted || version !== reviewVersion.current) return;
      const proposal = validateAIDashboardProposal(data, selectedDataset, candidateGoal === 'auto' ? 'overview' : candidateGoal);
      setCandidates((current) => [proposal, ...current.filter(({ aiGenerated }) => !aiGenerated)].slice(0, 4));
      toast.success('AI proposal received and its charts validated locally.');
    } catch (error) {
      if (!controller.signal.aborted && version === reviewVersion.current) setAiError(describeApiError(error, 'Optional AI suggestions are unavailable.').text);
    } finally {
      if (aiRequest.current === controller) {
        aiRequest.current = null;
        if (version === reviewVersion.current) setAiLoading(false);
      }
    }
  };

  const layoutActions = <>
      {currentLayout && !isGeneratedLayout && (
        <button type="button" onClick={handleAddCard} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50">
          <FiPlus /> Add Card
        </button>
      )}

      {currentLayout?.id && !isGeneratedLayout && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleRenameLayout} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" aria-label="Rename current layout"><FiEdit3 /> Rename</button>
          <button type="button" onClick={() => void duplicateLayout(currentLayout.id)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" aria-label="Duplicate current layout"><FiCopy /> Duplicate</button>
          <button type="button" disabled={defaultLayoutId === currentLayout.id} onClick={() => setDefaultLayout(currentLayout.id)} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:cursor-default disabled:bg-amber-50 disabled:opacity-70" aria-label={defaultLayoutId === currentLayout.id ? 'Current layout is default' : 'Set current layout as default'}><FiStar /> {defaultLayoutId === currentLayout.id ? 'Default' : 'Set default'}</button>
          <button type="button" onClick={() => handleDeleteLayout(currentLayout.id)} className="inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">
            <FiTrash2 /> Delete Layout
          </button>
        </div>
      )}
  </>;

  return (
    <div className="layout-selector flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <div className="relative w-full min-w-0 max-w-full sm:w-auto">
      <select
        value={currentLayoutValue}
        onChange={(e) => {
          if (e.target.value === '__generated__') return;
          const nextLayout = layouts.find((layout) => layout.id === e.target.value);
          if (nextLayout && confirmDiscardLayoutChanges()) selectLayout(nextLayout);
        }}
        className="w-full min-w-0 max-w-full appearance-none rounded-xl border border-slate-300 bg-white py-2 pl-4 pr-10 text-sm font-semibold text-slate-700 shadow-xs"
        aria-label="Select dashboard layout"
      >
        <option value="">Select Layout</option>
        {isGeneratedLayout && <option value="__generated__">{currentLayout?.name || 'Smart Layout'}</option>}
        {layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}
      </select>
      <FiChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-600" />
      </div>

      {!showNewLayout ? (
        <button type="button" onClick={() => setShowNewLayout(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50">
          <FiPlus /> New Layout
        </button>
      ) : (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <input type="text" value={newLayoutName} onChange={(e) => setNewLayoutName(e.target.value)} placeholder="Layout name" aria-label="Layout name" className="min-w-0 max-w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" autoFocus />
          <button type="button" onClick={handleSaveLayout} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"><FiSave /> Save</button>
          <button type="button" onClick={() => setShowNewLayout(false)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
        </div>
      )}

      {selectedDataset && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleGenerateSmartLayout} className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100">Smart Layout</button>
          {isGeneratedLayout && <button type="button" onClick={() => confirmDiscardLayoutChanges() && resetToDefaultLayout()} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Exit Smart</button>}
        </div>
      )}

      {compact ? (
        <DisclosurePanel label="Manage current layout" trigger={<>Layout options <FiChevronDown aria-hidden="true" /></>} className="layout-options">
          {layoutActions}
        </DisclosurePanel>
      ) : layoutActions}

      {showSmartReview && <Suspense fallback={<div role="status" className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 text-white">Loading dashboard options…</div>}><SmartLayoutReview candidates={candidates} goal={candidateGoal} loading={isPlanning} feedbackCount={feedbackCount} aiAvailable={aiAvailable} aiConsent={aiConsent} aiLoading={aiLoading} aiError={aiError} onConsentChange={setAiConsent} onRequestAI={handleRequestAI} onGoalChange={handleGoalChange} onChoose={handleChooseCandidate} onFeedback={handleCandidateFeedback} onClose={closeSmartReview} /></Suspense>}


    </div>
  );
}

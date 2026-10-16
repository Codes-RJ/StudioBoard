const FEEDBACK_KEY = 'analytics-dashboard-layout-feedback';
const MAX_FEEDBACK_ENTRIES = 100;

/** Store only local recommendation metadata; no dataset values are recorded. */
export const recordDashboardFeedback = ({ goal, score, chartTypes, decision }) => {
  try {
    const existing = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]');
    const entries = Array.isArray(existing) ? existing : [];
    const next = [...entries, {
      at: new Date().toISOString(),
      goal: String(goal || '').slice(0, 40),
      score: Number.isFinite(score) ? score : null,
      chartTypes: [...new Set((chartTypes || []).map((type) => String(type).slice(0, 40)))].slice(0, 20),
      decision: decision === 'accepted' ? 'accepted' : 'rejected',
    }].slice(-MAX_FEEDBACK_ENTRIES);
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
};

export const readDashboardFeedback = () => {
  try {
    const value = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]');
    return Array.isArray(value) ? value.slice(-MAX_FEEDBACK_ENTRIES) : [];
  } catch {
    return [];
  }
};

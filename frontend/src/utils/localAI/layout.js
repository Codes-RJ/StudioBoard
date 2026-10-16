import { getDatasetColumnGroups, validateGraphConfiguration } from '../graphConfiguration';
import { qualityRevisionKey } from '../qualityReview';

export const validateAgentChart = (card, dataset, computations) => {
  if (!card || Object.keys(card).some((key) => !['title', 'chartType', 'preferredX', 'preferredY', 'aggregation'].includes(key))
    || typeof card.title !== 'string' || !card.title.trim() || card.title.length > 120
    || !['bar', 'line', 'pie', 'table'].includes(card.chartType) || !['sum', 'average', 'count', 'min', 'max', 'median'].includes(card.aggregation)) throw new Error('Unsupported chart proposal.');
  const validation = validateGraphConfiguration(card, getDatasetColumnGroups(dataset));
  if (!validation.valid) throw new Error(validation.issues.join(' '));
  const metric = card.preferredY === '__count__' ? '__rows__' : card.preferredY;
  const calculation = computations.find((result) => result.datasetId === dataset.id && result.metric === metric
    && result.dimension === (card.preferredX || '') && result.aggregation === card.aggregation && !result.joins);
  if (!calculation) throw new Error('Calculate this chart measure and grouping on the selected source first.');
  return { ...card, title: card.title.trim(), evidenceId: calculation.evidenceId };
};

export const validateAgentLayout = (proposal, dataset, computations) => {
  if (typeof proposal.title !== 'string' || !proposal.title.trim() || proposal.title.length > 120
    || !Array.isArray(proposal.cards) || proposal.cards.length < 1 || proposal.cards.length > 5
    || !['compact', 'comfortable'].includes(proposal.density || 'comfortable')) throw new Error('Choose a titled layout with 1–5 cards and compact or comfortable density.');
  const width = proposal.density === 'compact' ? 6 : 12; const height = proposal.density === 'compact' ? 3 : 4;
  const cards = proposal.cards.map((card, index) => ({ ...validateAgentChart(card, dataset, computations),
    i: `agent_${index + 1}`, x: width === 6 ? index % 2 * 6 : 0, y: (width === 6 ? Math.floor(index / 2) : index) * height, w: width, h: height }));
  return { title: proposal.title.trim(), density: proposal.density || 'comfortable', cards, datasetId: dataset.id };
};

export const validateAgentChartEdit = ({ cardId, ...card }, dataset, computations, layout) => {
  const existing = layout?.layout?.find((item) => item.i === cardId);
  if (!existing || typeof cardId !== 'string') throw new Error('Choose an existing chart ID from list_charts.');
  return { cardId, card: validateAgentChart(card, dataset, computations), layoutId: layout.id,
    sourceRevision: qualityRevisionKey(dataset), before: JSON.stringify(existing) };
};

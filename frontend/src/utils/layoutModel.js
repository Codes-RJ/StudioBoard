import { normalizeChartAppearance } from './chartAppearance';
import { CHART_TYPE_VALUES } from './chartTypes';

export const GRID_COLUMNS = 12;
export const CARD_MIN_WIDTH = 2;
export const CARD_MAX_WIDTH = GRID_COLUMNS;
export const CARD_MIN_HEIGHT = 2;
export const CARD_MAX_HEIGHT = 8;

export const SUPPORTED_CHART_TYPES = new Set(CHART_TYPE_VALUES);
export const SUPPORTED_AGGREGATIONS = new Set(['auto', 'count', 'sum', 'average', 'median', 'min', 'max']);

export const CHART_SIZE_CONSTRAINTS = {
  line: { minW: 4, maxW: 12, minH: 3, maxH: 8 },
  spline: { minW: 4, maxW: 12, minH: 3, maxH: 8 },
  smoothArea: { minW: 4, maxW: 12, minH: 3, maxH: 8 },
  waveform: { minW: 4, maxW: 12, minH: 3, maxH: 8 },
  sineWave: { minW: 4, maxW: 12, minH: 3, maxH: 8 },
  area: { minW: 4, maxW: 12, minH: 3, maxH: 8 },
  bar: { minW: 4, maxW: 12, minH: 3, maxH: 8 },
  pie: { minW: 3, maxW: 6, minH: 3, maxH: 6 },
  scatter: { minW: 4, maxW: 12, minH: 3, maxH: 8 },
  heatmap: { minW: 4, maxW: 12, minH: 3, maxH: 8 },
  gauge: { minW: 3, maxW: 6, minH: 2, maxH: 4 },
  funnel: { minW: 3, maxW: 8, minH: 3, maxH: 6 },
  treemap: { minW: 3, maxW: 8, minH: 3, maxH: 6 },
  sankey: { minW: 6, maxW: 12, minH: 3, maxH: 8 },
  kpi: { minW: 2, maxW: 4, minH: 2, maxH: 3 },
  table: { minW: 6, maxW: 12, minH: 3, maxH: 8 }
};

const LARGE_CHART_TYPES = new Set([
  'stackedBar', 'density', 'contour', 'scatter3d', 'surface3d', 'mesh3d',
  'bubble4d', 'parallelCoordinates', 'candlestick', 'sunburst', 'multiSpline',
  'streamgraph', 'rangeArea'
]);

export const getChartSizeConstraints = (chartType, columns = GRID_COLUMNS) => {
  const constraints = CHART_SIZE_CONSTRAINTS[chartType]
    || (LARGE_CHART_TYPES.has(chartType) ? { minW: 6, maxW: 12, minH: 4, maxH: 8 } : CHART_SIZE_CONSTRAINTS.line);
  return {
    minW: Math.min(constraints.minW, columns),
    maxW: Math.min(constraints.maxW, columns),
    minH: constraints.minH,
    maxH: constraints.maxH
  };
};

const BASE_LAYOUT_ITEMS = [
  { i: '1', x: 0, y: 0, w: 6, h: 3, title: 'Live Trend', chartType: 'line' },
  { i: '2', x: 6, y: 0, w: 6, h: 3, title: 'Correlation Heatmap', chartType: 'heatmap' },
  { i: '3', x: 0, y: 3, w: 4, h: 3, title: 'KPI Gauge', chartType: 'gauge' },
  { i: '4', x: 4, y: 3, w: 4, h: 3, title: 'Segment Funnel', chartType: 'funnel' },
  { i: '5', x: 8, y: 3, w: 4, h: 3, title: 'Category Treemap', chartType: 'treemap' },
  { i: '6', x: 0, y: 6, w: 12, h: 3, title: 'Flow Analysis', chartType: 'sankey' }
];

const toFiniteNumber = (value, fallback) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const clampInteger = (value, minimum, maximum, fallback) => (
  Math.min(maximum, Math.max(minimum, Math.round(toFiniteNumber(value, fallback))))
);

export const normalizeLayoutItem = (item = {}, index = 0, id = item.i ?? index + 1) => {
  const chartType = SUPPORTED_CHART_TYPES.has(item.chartType) ? item.chartType : 'line';
  const constraints = getChartSizeConstraints(chartType);
  const appearance = normalizeChartAppearance(item, chartType);
  const width = clampInteger(item.w, constraints.minW, constraints.maxW, 4);
  const x = clampInteger(item.x, 0, GRID_COLUMNS - width, 0);
  const aggregation = SUPPORTED_AGGREGATIONS.has(item.aggregation) ? item.aggregation : 'auto';

  return {
    i: String(id),
    x,
    y: Math.max(0, Math.round(toFiniteNumber(item.y, 0))),
    w: width,
    h: clampInteger(item.h, constraints.minH, constraints.maxH, 3),
    ...constraints,
    title: String(item.title || `Card ${index + 1}`).trim() || `Card ${index + 1}`,
    chartType,
    preferredX: item.preferredX || '',
    preferredY: item.preferredY || '',
    preferredZ: item.preferredZ || '',
    preferredSize: item.preferredSize || '',
    preferredColor: item.preferredColor || '',
    preferredGroup: item.preferredGroup || '',
    preferredOpen: item.preferredOpen || '',
    preferredHigh: item.preferredHigh || '',
    preferredLow: item.preferredLow || '',
    dataScope: item.dataScope === 'sample' ? 'sample' : 'full',
    dataLimit: clampInteger(item.dataLimit, 1, 500, 180),
    dataPage: Math.max(1, Math.round(toFiniteNumber(item.dataPage, 1))),
    sortBy: item.sortBy || '',
    sortOrder: item.sortOrder === 'desc' ? 'desc' : 'asc',
    aggregation,
    topN: clampInteger(item.topN, 3, 50, 12),
    ...appearance,
    ...(item.intent === undefined ? {} : { intent: item.intent })
  };
};

export const normalizeLayoutItems = (items = []) => {
  const usedIds = new Set();

  return (Array.isArray(items) ? items : []).map((item, index) => {
    let id = String(item?.i ?? index + 1);
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}-${suffix}`)) suffix += 1;
      id = `${id}-${suffix}`;
    }
    usedIds.add(id);
    return normalizeLayoutItem(item, index, id);
  });
};

export const DEFAULT_LAYOUT_ITEMS = normalizeLayoutItems(BASE_LAYOUT_ITEMS);

const overlaps = (left, right) => !(
  left.x + left.w <= right.x ||
  right.x + right.w <= left.x ||
  left.y + left.h <= right.y ||
  right.y + right.h <= left.y
);

export const findFirstAvailablePosition = (items = [], width = 4, height = 3) => {
  const normalizedItems = normalizeLayoutItems(items);
  const cardWidth = clampInteger(width, CARD_MIN_WIDTH, CARD_MAX_WIDTH, 4);
  const cardHeight = clampInteger(height, CARD_MIN_HEIGHT, CARD_MAX_HEIGHT, 3);
  const bottom = normalizedItems.reduce((maximum, item) => Math.max(maximum, item.y + item.h), 0);

  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x <= GRID_COLUMNS - cardWidth; x += 1) {
      const candidate = { x, y, w: cardWidth, h: cardHeight };
      if (!normalizedItems.some((item) => overlaps(candidate, item))) return candidate;
    }
  }

  return { x: 0, y: bottom, w: cardWidth, h: cardHeight };
};

export const addLayoutCard = (items = [], overrides = {}) => {
  const normalizedItems = normalizeLayoutItems(items);
  const usedIds = new Set(normalizedItems.map(({ i }) => i));
  let nextId = Math.max(1, normalizedItems.length + 1);
  while (usedIds.has(String(nextId))) nextId += 1;

  const position = findFirstAvailablePosition(
    normalizedItems,
    overrides.w ?? 4,
    overrides.h ?? 3
  );
  const newCard = normalizeLayoutItem({
    ...position,
    title: `Card ${nextId}`,
    chartType: 'line',
    ...overrides,
    i: String(nextId)
  }, normalizedItems.length, String(nextId));

  return [...normalizedItems, newCard];
};

export const removeLayoutCard = (items = [], itemId) => (
  normalizeLayoutItems(items).filter(({ i }) => i !== String(itemId))
);

export const duplicateLayoutCard = (items = [], itemId) => {
  const normalizedItems = normalizeLayoutItems(items);
  const source = normalizedItems.find(({ i }) => i === String(itemId));
  if (!source) return normalizedItems;

  const { i: _id, x: _x, y: _y, ...configuration } = source;
  return addLayoutCard(normalizedItems, {
    ...configuration,
    title: `${source.title} copy`
  });
};

export const resetLayoutCard = (items = [], itemId) => {
  const normalizedItems = normalizeLayoutItems(items);
  const targetId = String(itemId);

  return normalizedItems.map((item, index) => (
    item.i === targetId
      ? normalizeLayoutItem({
          i: item.i,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          title: `Card ${index + 1}`,
          chartType: 'line'
        }, index, item.i)
      : item
  ));
};

const replaceCardWithoutOverlap = (items, itemId, update) => {
  const normalizedItems = normalizeLayoutItems(items);
  const targetId = String(itemId);
  const targetIndex = normalizedItems.findIndex(({ i }) => i === targetId);
  if (targetIndex < 0) return normalizedItems;

  const candidate = normalizeLayoutItem(
    { ...normalizedItems[targetIndex], ...update(normalizedItems[targetIndex]) },
    targetIndex,
    targetId
  );
  const collides = normalizedItems.some((item, index) => index !== targetIndex && overlaps(candidate, item));
  if (collides) return normalizedItems;
  return normalizedItems.map((item, index) => (index === targetIndex ? candidate : item));
};

export const moveLayoutCard = (items = [], itemId, deltaX = 0, deltaY = 0) => (
  replaceCardWithoutOverlap(items, itemId, (item) => ({
    x: item.x + Math.round(deltaX),
    y: item.y + Math.round(deltaY)
  }))
);

export const resizeLayoutCard = (items = [], itemId, deltaWidth = 0, deltaHeight = 0) => (
  resizeLayoutCardToFit(items, itemId, deltaWidth, deltaHeight)
);

/*
 * Keep resize controls dependable: an expansion should not be silently ignored
 * merely because another card occupies the requested space. The resized card
 * stays in place and cards in its way flow downward, matching the grid's visual
 * compaction behaviour while preserving a non-overlapping saved layout.
 */
const resizeLayoutCardToFit = (items = [], itemId, deltaWidth = 0, deltaHeight = 0) => {
  const normalizedItems = normalizeLayoutItems(items);
  const targetId = String(itemId);
  const targetIndex = normalizedItems.findIndex(({ i }) => i === targetId);
  if (targetIndex < 0) return normalizedItems;

  const target = normalizedItems[targetIndex];
  const resizedTarget = normalizeLayoutItem({
    ...target,
    w: target.w + Math.round(deltaWidth),
    h: target.h + Math.round(deltaHeight)
  }, targetIndex, targetId);

  const placed = [resizedTarget];
  const reflowedById = new Map([[targetId, resizedTarget]]);
  normalizedItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.i !== targetId)
    .sort((left, right) => left.item.y - right.item.y || left.item.x - right.item.x || left.index - right.index)
    .forEach(({ item }) => {
      let nextItem = { ...item };
      let collidingCards = placed.filter((placedItem) => overlaps(nextItem, placedItem));
      while (collidingCards.length > 0) {
        nextItem = {
          ...nextItem,
          y: Math.max(...collidingCards.map((placedItem) => placedItem.y + placedItem.h))
        };
        collidingCards = placed.filter((placedItem) => overlaps(nextItem, placedItem));
      }
      placed.push(nextItem);
      reflowedById.set(nextItem.i, nextItem);
    });

  return normalizedItems.map((item) => reflowedById.get(item.i) || item);
};

export const reorderLayoutCard = (items = [], itemId, direction = 0) => {
  const normalizedItems = normalizeLayoutItems(items);
  const sourceIndex = normalizedItems.findIndex(({ i }) => i === String(itemId));
  const targetIndex = sourceIndex + Math.sign(direction);
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= normalizedItems.length) return normalizedItems;

  const nextItems = [...normalizedItems];
  const [source] = nextItems.splice(sourceIndex, 1);
  nextItems.splice(targetIndex, 0, source);
  return nextItems;
};

const createResponsiveLayout = (items, columns, stack) => {
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  return normalizeLayoutItems(items).map((item) => {
    const constraints = getChartSizeConstraints(item.chartType, columns);
    const width = stack ? columns : Math.min(item.w, constraints.maxW, columns);
    if (!stack && cursorX + width > columns) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }
    const responsiveItem = {
      ...item,
      x: stack ? 0 : cursorX,
      y: cursorY,
      w: width,
      minW: constraints.minW,
      maxW: constraints.maxW,
      minH: constraints.minH,
      maxH: constraints.maxH
    };
    if (stack) cursorY += responsiveItem.h;
    else {
      cursorX += width;
      rowHeight = Math.max(rowHeight, responsiveItem.h);
    }
    return responsiveItem;
  });
};

export const buildResponsiveLayouts = (items = []) => ({
  lg: normalizeLayoutItems(items),
  md: createResponsiveLayout(items, 10, false),
  sm: createResponsiveLayout(items, 6, true),
  xs: createResponsiveLayout(items, 4, true),
  xxs: createResponsiveLayout(items, 2, true)
});

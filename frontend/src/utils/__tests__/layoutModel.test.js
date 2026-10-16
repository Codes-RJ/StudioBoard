import { describe, expect, it } from 'vitest';
import {
  addLayoutCard,
  buildResponsiveLayouts,
  duplicateLayoutCard,
  findFirstAvailablePosition,
  moveLayoutCard,
  normalizeLayoutItems,
  removeLayoutCard,
  reorderLayoutCard,
  resizeLayoutCard,
  resetLayoutCard
} from '../layoutModel';

describe('layout model', () => {
  it('normalizes unsafe card values and repairs duplicate IDs', () => {
    const cards = normalizeLayoutItems([
      {
        i: 'chart',
        x: 99,
        y: -5,
        w: 99,
        h: 0,
        chartType: 'unknown',
        aggregation: 'unknown',
        colorPalette: 'unknown',
        seriesColor: 'red',
        numberFormat: 'unknown',
        decimalPlaces: 9,
        dataLimit: 900,
        dataPage: 0,
        topN: 2
      },
      { i: 'chart', chartType: 'bar' }
    ]);

    expect(cards[0]).toMatchObject({
      i: 'chart',
      x: 0,
      y: 0,
      w: 12,
      h: 3,
      minW: 4,
      maxW: 12,
      chartType: 'line',
      aggregation: 'auto',
      colorPalette: 'inherit',
      seriesColor: '',
      numberFormat: 'auto',
      decimalPlaces: 4,
      dataLimit: 500,
      dataPage: 1,
      topN: 3
    });
    expect(cards[1].i).toBe('chart-2');
  });

  it('places a new card in the first open grid position', () => {
    const cards = [
      { i: '1', x: 0, y: 0, w: 4, h: 3 },
      { i: '2', x: 4, y: 0, w: 4, h: 3 }
    ];

    expect(findFirstAvailablePosition(cards)).toEqual({ x: 8, y: 0, w: 4, h: 3 });
    expect(addLayoutCard(cards).at(-1)).toMatchObject({
      i: '3',
      x: 8,
      y: 0,
      w: 4,
      h: 3,
      title: 'Card 3',
      chartType: 'line'
    });
  });

  it('removes only the requested card', () => {
    const cards = [
      { i: '1', x: 0, y: 0, w: 4, h: 3 },
      { i: '2', x: 4, y: 0, w: 4, h: 3 }
    ];

    expect(removeLayoutCard(cards, 1).map(({ i }) => i)).toEqual(['2']);
  });

  it('duplicates a card configuration into the first available position', () => {
    const cards = [
      { i: '1', x: 0, y: 0, w: 4, h: 3, title: 'Revenue', chartType: 'bar', aggregation: 'sum', colorPalette: 'red', showLegend: false },
      { i: '2', x: 4, y: 0, w: 4, h: 3, title: 'Customers', chartType: 'line' }
    ];

    expect(duplicateLayoutCard(cards, '1').at(-1)).toMatchObject({
      i: '3',
      x: 8,
      y: 0,
      title: 'Revenue copy',
      chartType: 'bar',
      aggregation: 'sum',
      colorPalette: 'red',
      showLegend: false
    });
  });

  it('resets configuration without moving or resizing the card', () => {
    const cards = [{
      i: 'chart',
      x: 4,
      y: 5,
      w: 6,
      h: 4,
      title: 'Revenue',
      chartType: 'bar',
      preferredX: 'month',
      aggregation: 'sum'
    }];

    expect(resetLayoutCard(cards, 'chart')[0]).toMatchObject({
      i: 'chart',
      x: 4,
      y: 5,
      w: 6,
      h: 4,
      title: 'Card 1',
      chartType: 'line',
      preferredX: '',
      aggregation: 'auto'
    });
  });

  it('applies chart-specific resize constraints', () => {
    const [gauge, sankey] = normalizeLayoutItems([
      { i: 'gauge', chartType: 'gauge', w: 12, h: 9 },
      { i: 'flow', chartType: 'sankey', w: 2, h: 1 }
    ]);
    expect(gauge).toMatchObject({ w: 6, h: 4, minW: 3, maxW: 6, minH: 2, maxH: 4 });
    expect(sankey).toMatchObject({ w: 6, h: 3, minW: 6, maxW: 12, minH: 3, maxH: 8 });
  });

  it('keeps moves collision-safe and reflows obstructing cards during resize', () => {
    const cards = [
      { i: '1', x: 0, y: 0, w: 4, h: 3, chartType: 'bar' },
      { i: '2', x: 4, y: 0, w: 4, h: 3, chartType: 'bar' }
    ];
    expect(moveLayoutCard(cards, '1', 1, 0)[0]).toMatchObject({ x: 0, y: 0 });
    expect(moveLayoutCard(cards, '1', 0, 3)[0]).toMatchObject({ x: 0, y: 3 });
    const resized = resizeLayoutCard(cards, '1', 1, 0);
    expect(resized[0]).toMatchObject({ w: 5, h: 3 });
    expect(resized[1]).toMatchObject({ x: 4, y: 3, w: 4, h: 3 });
    expect(resizeLayoutCard(cards, '2', 0, 1)[1]).toMatchObject({ w: 4, h: 4 });
  });

  it('cascades resize reflow without creating overlaps', () => {
    const cards = [
      { i: '1', x: 0, y: 0, w: 4, h: 3, chartType: 'bar' },
      { i: '2', x: 4, y: 0, w: 4, h: 3, chartType: 'bar' },
      { i: '3', x: 4, y: 3, w: 4, h: 3, chartType: 'bar' }
    ];
    const resized = resizeLayoutCard(cards, '1', 1, 0);
    expect(resized.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))).toEqual([
      { i: '1', x: 0, y: 0, w: 5, h: 3 },
      { i: '2', x: 4, y: 3, w: 4, h: 3 },
      { i: '3', x: 4, y: 6, w: 4, h: 3 }
    ]);
  });

  it('stacks cards at mobile breakpoints with constraints that fit each grid', () => {
    const layouts = buildResponsiveLayouts([
      { i: '1', x: 0, y: 0, w: 6, h: 3, chartType: 'line' },
      { i: '2', x: 6, y: 0, w: 6, h: 3, chartType: 'sankey' }
    ]);
    expect(layouts.xs.map(({ x, y, w, minW, maxW }) => ({ x, y, w, minW, maxW }))).toEqual([
      { x: 0, y: 0, w: 4, minW: 4, maxW: 4 },
      { x: 0, y: 3, w: 4, minW: 4, maxW: 4 }
    ]);
    expect(layouts.xxs.every(({ x, w, minW, maxW }) => x === 0 && w === 2 && minW === 2 && maxW === 2)).toBe(true);
  });

  it('supports KPI/table constraints and touch-friendly card ordering', () => {
    const cards = normalizeLayoutItems([
      { i: 'kpi', chartType: 'kpi', w: 12, h: 8 },
      { i: 'table', chartType: 'table', w: 2, h: 2 }
    ]);
    expect(cards[0]).toMatchObject({ chartType: 'kpi', w: 4, h: 3, minW: 2, maxW: 4 });
    expect(cards[1]).toMatchObject({ chartType: 'table', w: 6, h: 3, minW: 6, maxW: 12 });
    expect(reorderLayoutCard(cards, 'table', -1).map(({ i }) => i)).toEqual(['table', 'kpi']);
    expect(reorderLayoutCard(cards, 'kpi', -1).map(({ i }) => i)).toEqual(['kpi', 'table']);
  });

  it('persists multidimensional column mappings and gives 3D charts a large canvas', () => {
    const [chart] = normalizeLayoutItems([{
      i: 'four-d',
      chartType: 'bubble4d',
      preferredX: 'height',
      preferredY: 'width',
      preferredZ: 'depth',
      preferredSize: 'weight',
      w: 2,
      h: 2
    }]);

    expect(chart).toMatchObject({
      chartType: 'bubble4d',
      preferredX: 'height',
      preferredY: 'width',
      preferredZ: 'depth',
      preferredSize: 'weight',
      w: 6,
      h: 4,
      minW: 6,
      minH: 4
    });
  });
});

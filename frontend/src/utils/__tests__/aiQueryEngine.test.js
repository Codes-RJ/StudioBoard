import { describe, it, expect } from 'vitest';
import {
  analyzeQueryWithData,
  buildDatasetProfile,
  computeTrendChange,
  computeCorrelation,
  computeLossProfit,
  generateSuggestedPrompts,
  rankColumnsInQuery
} from '../aiQueryEngine';
import { generateQuestionLibrary } from '../aiDatasetIdentity';
import { getDatasetColumnGroups, validateGraphConfiguration } from '../graphConfiguration';

const makeDataset = () => {
  const months = [
    '2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01', '2025-05-01', '2025-06-01',
    '2025-07-01', '2025-08-01', '2025-09-01', '2025-10-01', '2025-11-01', '2025-12-01'
  ];
  const mrr = [100, 110, 120, 130, 140, 150, 90, 80, 70, 60, 50, 40];
  const plans = ['Enterprise', 'Starter', 'Pro'];

  return {
    id: 'ds_test',
    name: 'Test',
    columns: [
      { name: 'Month', type: 'date' },
      { name: 'Plan', type: 'string' },
      { name: 'MRR', type: 'number' }
    ],
    metrics: {
      rows: months.length,
      columns: 3,
      numericColumns: 1,
      categoricalColumns: 1,
      missingValues: 0,
      completeness: 100,
      primaryMetricColumn: 'MRR',
      primaryMean: 95,
      columnGroups: {
        all: ['Month', 'Plan', 'MRR'],
        numeric: ['MRR'],
        categorical: ['Plan'],
        date: ['Month'],
        dimensions: ['Month', 'Plan'],
        measures: ['MRR']
      }
    },
    rawRows: months.map((m, i) => ({
      Month: m,
      Plan: plans[i % plans.length],
      MRR: mrr[i]
    }))
  };
};

describe('computeTrendChange', () => {
  it('detects a decrease and identifies contributing categories', () => {
    const ds = makeDataset();
    const tc = computeTrendChange(ds.rawRows, 'MRR', 'Month', 'Plan');

    expect(tc.direction).toBe('decrease');
    expect(tc.firstTotal).toBe(750); // 100+110+120+130+140+150
    expect(tc.secondTotal).toBe(390); // 90+80+70+60+50+40
    expect(tc.pctChange).toBe(-48);
    expect(tc.topDecliners.length).toBeGreaterThan(0);
  });

  it('detects growth when the second half is larger', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ Month: `2025-0${i + 1}-01`, v: i * 10 }));
    const tc = computeTrendChange(rows, 'v', 'Month', null);
    expect(tc.direction).toBe('increase');
  });
});

describe('computeCorrelation', () => {
  it('keeps constant columns unavailable rather than presenting a measured zero', () => {
    expect(computeCorrelation([{ a: 2, b: 1 }, { a: 2, b: 2 }, { a: 2, b: 3 }], 'a', 'b')).toMatchObject({ r: null, n: 3 });
  });

  it('preserves real zero and large finite correlations', () => {
    expect(computeCorrelation([{ a: -1, b: 1 }, { a: 0, b: -2 }, { a: 1, b: 1 }], 'a', 'b').r).toBe(0);
    expect(computeCorrelation([{ a: 1e308, b: 1e308 }, { a: 5e307, b: 5e307 }, { a: -1e308, b: -1e308 }], 'a', 'b').r).toBe(1);
  });

  it('explains a constant pair as unavailable in an actual assistant answer', () => {
    const dataset = { id: 'constant', columns: [{ name: 'Revenue', type: 'number' }, { name: 'Cost', type: 'number' }],
      rawRows: [{ Revenue: 10, Cost: 1 }, { Revenue: 10, Cost: 2 }, { Revenue: 10, Cost: 3 }] };
    const answer = analyzeQueryWithData('Correlation between Revenue and Cost', dataset);
    expect(answer.directAnswer).toMatch(/unavailable|no variation/i);
    expect(answer.directAnswer).not.toMatch(/positive correlation|r = 0/);
  });

  it('returns 1 for perfectly correlated series', () => {
    const rows = [{ a: 1, b: 2 }, { a: 2, b: 4 }, { a: 3, b: 6 }];
    expect(computeCorrelation(rows, 'a', 'b').r).toBe(1);
  });

  it('returns -1 for perfectly inverse series', () => {
    const rows = [{ a: 1, b: 6 }, { a: 2, b: 4 }, { a: 3, b: 2 }];
    expect(computeCorrelation(rows, 'a', 'b').r).toBe(-1);
  });
});

describe('computeLossProfit', () => {
  it('separates losses from gains and computes the net result', () => {
    const lp = computeLossProfit(
      [{ p: -100 }, { p: 250 }, { p: -50 }],
      'p'
    );
    expect(lp.totalLoss).toBe(-150);
    expect(lp.totalGain).toBe(250);
    expect(lp.net).toBe(100);
    expect(lp.allPositive).toBe(false);
  });

  it('flags all-positive columns as having no explicit losses', () => {
    const lp = computeLossProfit([{ p: 10 }, { p: 20 }], 'p');
    expect(lp.allPositive).toBe(true);
    expect(lp.totalLoss).toBe(0);
  });
});

describe('analyzeQueryWithData — conversational intents', () => {
  it('answers "Why is sales decreasing?" with a trend-change diagnosis', () => {
    const res = analyzeQueryWithData('Why is sales decreasing?', makeDataset());
    expect(res.intent).toBe('TREND_CHANGE_DIAGNOSIS');
    expect(res.directAnswer).toContain('decreased');
    expect(res.keyInsights.length).toBeGreaterThan(0);
  });

  it('answers loss questions with concrete numbers', () => {
    const res = analyzeQueryWithData('How much loss happened to us?', {
      ...makeDataset(),
      rawRows: makeDataset().rawRows.map((r) => ({ ...r, Profit: r.MRR < 70 ? -30 : 20 }))
    });
    // falls back to the first matching/primary metric and reports totals
    expect(res.intent).toBe('LOSS_PROFIT');
    expect(res.directAnswer).toMatch(/loss|positive|total/i);
  });

  it('answers summary questions with a dataset overview', () => {
    const res = analyzeQueryWithData('Summarize this dataset', makeDataset());
    expect(res.intent).toBe('DATASET_SUMMARY');
    expect(res.directAnswer).toContain('rows');
  });

  it('answers correlation questions with the coefficient', () => {
    const res = analyzeQueryWithData('What is the relationship between MRR and MRR2?', {
      ...makeDataset(),
      rawRows: makeDataset().rawRows.map((r) => ({ ...r, MRR2: r.MRR * 2 })),
      metrics: {
        ...makeDataset().metrics,
        columnGroups: {
          ...makeDataset().metrics.columnGroups,
          numeric: ['MRR', 'MRR2'],
          measures: ['MRR', 'MRR2']
        }
      }
    });
    expect(res.intent).toBe('CORRELATION_ANALYSIS');
    expect(res.directAnswer).toContain('strong positive');
  });

  it('still handles classic aggregations (regression safety)', () => {
    const res = analyzeQueryWithData('Total MRR by Plan', makeDataset());
    expect(res.intent).toBe('AGGREGATION_BY_DIMENSION');
    expect(res.directAnswer).toContain('Total MRR');
    expect(res.recommendedCard.title).toBe('Total MRR by Plan');
    expect(res.recommendedCard.preferredX).toBe('Plan');
    expect(res.recommendedCard.preferredY).toBe('MRR');
  });

  it('keeps an explicit ranking limit in both the answer and chart recommendation', () => {
    const rawRows = Array.from({ length: 6 }, (_, index) => ({ Plan: `Plan ${index + 1}`, MRR: 100 - index }));
    const rankedDataset = {
      ...makeDataset(),
      rawRows,
      columns: [{ name: 'Plan', type: 'string' }, { name: 'MRR', type: 'number' }]
    };
    const result = analyzeQueryWithData('Top 2 Plan by MRR', rankedDataset);
    expect(result.keyInsights).toHaveLength(2);
    expect(result.recommendedCard.topN).toBe(2);
  });

  it('recommends compatible distribution charts for ungrouped loss and outlier questions', () => {
    const metricOnly = {
      id: 'metric-only',
      columns: [{ name: 'Profit', type: 'number' }],
      rawRows: [{ Profit: -20 }, { Profit: 10 }, { Profit: 40 }, { Profit: 900 }]
    };
    expect(analyzeQueryWithData('How much loss is in Profit?', metricOnly).recommendedCard).toMatchObject({
      chartType: 'histogram', preferredX: 'Profit'
    });
    expect(analyzeQueryWithData('Find outliers in Profit', metricOnly).recommendedCard).toMatchObject({
      chartType: 'box', preferredY: 'Profit'
    });
  });

  it.each([
    'How many rows are there?',
    'Explain MRR',
    'What are the distinct Plan values?',
    'How much loss is in MRR?',
    'Find outliers in MRR',
    'Why is MRR decreasing?',
    'What is total MRR?',
    'Total MRR by Plan',
    'Show the trend of MRR over Month',
    'What percentage of MRR comes from each Plan?'
  ])('only emits a schema-valid chart recommendation for "%s"', (query) => {
    const result = analyzeQueryWithData(query, makeDataset());
    expect(result.recommendedCard).toBeTruthy();
    expect(validateGraphConfiguration(
      result.recommendedCard,
      getDatasetColumnGroups(makeDataset())
    )).toMatchObject({ valid: true });
  });

  it('handles outlier queries (regression safety)', () => {
    const res = analyzeQueryWithData('Find top outliers in MRR', makeDataset());
    expect(res.intent).toBe('OUTLIER_DETECTION');
  });

  it('errors gracefully without a dataset or empty query', () => {
    expect(analyzeQueryWithData('anything', null).error).toBeTruthy();
    expect(analyzeQueryWithData('', makeDataset()).error).toBeTruthy();
  });
});

describe('robust phrasing (AI tuning regressions)', () => {
  const ds = makeDataset();

  it.each([
    'Why did sales go down?',
    'How come sales are falling?',
    'Sales seem to be dropping lately',
    'What happened to sales vs last period?'
  ])('resolves trend diagnosis for "%s"', (query) => {
    const res = analyzeQueryWithData(query, ds);
    expect(res.intent).toBe('TREND_CHANGE_DIAGNOSIS');
    expect(res.directAnswer.toLowerCase()).toContain('decreased');
  });

  it('matches multi-word and concatenated column names', () => {
    const richDs = {
      ...ds,
      columns: [...ds.columns, { name: 'New Customers', type: 'number' }],
      metrics: {
        ...ds.metrics,
        columnGroups: {
          ...ds.metrics.columnGroups,
          numeric: ['MRR', 'New Customers']
        }
      }
    };
    expect(rankColumnsInQuery('how are new customers doing?', ['MRR', 'Plan', 'New Customers'])).toEqual(['New Customers']);
    const res = analyzeQueryWithData('why are new customers dropping?', richDs);
    expect(res.intent).toBe('TREND_CHANGE_DIAGNOSIS');
    expect(res.recommendedCard.preferredY).toBe('New Customers');
  });

  it('does not hijack "top plans by revenue" as an outlier question', () => {
    const res = analyzeQueryWithData('Show top plans by sales', ds);
    expect(res.intent).toBe('RANKING');
    expect(res.recommendedCard.preferredX).toBe('Plan');
    expect(res.recommendedCard.preferredY).toBe('MRR'); // synonym bridge: sales -> MRR
  });

  it('still detects explicit outlier wording', () => {
    expect(analyzeQueryWithData('find outliers in MRR', ds).intent).toBe('OUTLIER_DETECTION');
    expect(analyzeQueryWithData('any anomalies in MRR?', ds).intent).toBe('OUTLIER_DETECTION');
  });

  it('handles plural question forms without breaking', () => {
    expect(analyzeQueryWithData('Which months had the highest MRR?', ds).intent).toBeTruthy();
    expect(analyzeQueryWithData('total orders per plan', { ...ds }).intent).toBeTruthy();
  });
});

describe('generateSuggestedPrompts', () => {
  it('builds contextual prompts from real column names', () => {
    const prompts = generateSuggestedPrompts(makeDataset());
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((p) => p.includes('MRR'))).toBe(true);
  });

  it('falls back gracefully for malformed datasets', () => {
    expect(generateSuggestedPrompts(null).length).toBeGreaterThan(0);
  });
});

describe('broad analytical question coverage', () => {
  const dataset = {
    id: 'commercial',
    updatedAt: '2026-01-01',
    columns: [
      { name: 'Order Date', type: 'date' },
      { name: 'Region', type: 'string' },
      { name: 'Revenue', type: 'number' },
      { name: 'Cost', type: 'number' }
    ],
    metrics: { columnGroups: {
      all: ['Order Date', 'Region', 'Revenue', 'Cost'],
      numeric: ['Revenue', 'Cost'], categorical: ['Region'], date: ['Order Date'],
      dimensions: ['Order Date', 'Region'], measures: ['Revenue', 'Cost']
    } },
    rawRows: [
      { 'Order Date': '2025-01-01', Region: 'East', Revenue: 100, Cost: 60 },
      { 'Order Date': '2025-02-01', Region: 'West', Revenue: 80, Cost: 55 },
      { 'Order Date': '2025-03-01', Region: 'East', Revenue: 150, Cost: 70 },
      { 'Order Date': '2025-04-01', Region: 'West', Revenue: 120, Cost: 75 },
      { 'Order Date': '2025-05-01', Region: 'North', Revenue: '200', Cost: 90 },
      { 'Order Date': '2025-06-01', Region: 'North', Revenue: null, Cost: 95 }
    ]
  };

  it('profiles normalized types, summaries, ranges, values, and a stable revision', () => {
    const profile = buildDatasetProfile(dataset);
    expect(profile.numeric).toEqual(['Revenue', 'Cost']);
    expect(profile.date).toEqual(['Order Date']);
    expect(profile.columns.find((column) => column.name === 'Revenue')).toMatchObject({ min: 80, max: 200, mean: 130 });
    expect(profile.columns.find((column) => column.name === 'Order Date').maxDate).toContain('2025-06-01');
    expect(profile.columns.find((column) => column.name === 'Region').commonValues[0].count).toBe(2);
  });

  it('uses corrected column roles instead of treating numeric identifiers as measures', () => {
    const corrected = {
      ...dataset,
      columns: [...dataset.columns, { name: 'Account ID', type: 'number' }],
      rawRows: dataset.rawRows.map((row, index) => ({ ...row, 'Account ID': index + 100 })),
      columnOverrides: { 'Account ID': { type: 'number', role: 'identifier' } },
      metrics: { columnGroups: {
        ...dataset.metrics.columnGroups,
        all: [...dataset.metrics.columnGroups.all, 'Account ID'],
        numeric: [...dataset.metrics.columnGroups.numeric, 'Account ID'],
        measures: [...dataset.metrics.columnGroups.measures, 'Account ID']
      } }
    };
    const profile = buildDatasetProfile(corrected);
    expect(profile.numeric).not.toContain('Account ID');
    expect(profile.columns.find(({ name }) => name === 'Account ID').type).toBe('identifier');
  });

  it.each([
    'Explain this dataset',
    'Explain this data',
    'Walk me through this data',
    'Describe this dataset',
    'Summarize this table',
    'Give me an overview of the data',
    'What columns and data types are present?',
    'What does this dataset contain?',
    'What is the schema?',
    'What are the key insights?',
    'What are the key takeaways?',
    'Give me the big picture',
    'Help me understand this dataset'
  ])('treats "%s" as a whole-dataset explanation', (query) => {
    const result = analyzeQueryWithData(query, dataset);
    expect(result.intent).toBe('DATASET_SUMMARY');
    expect(result.directAnswer).toMatch(/tabular dataset/i);
    expect(result.recommendedCard).toBeNull();
    expect(result.interpretation.metrics).toEqual([]);
  });

  it.each([
    ['Explain Revenue', 'COLUMN_PROFILE'],
    ['Profile Revenue', 'COLUMN_PROFILE'],
    ['Describe the distribution of Revenue', 'COLUMN_PROFILE'],
    ['Show descriptive statistics for Revenue', 'COLUMN_PROFILE'],
    ['What is the range of Revenue?', 'COLUMN_PROFILE'],
    ['What unique values are in Region?', 'DISTINCT_VALUES'],
    ['How many unique Region values are there?', 'DISTINCT_VALUES'],
    ['What is the most common Region?', 'DISTINCT_VALUES'],
    ['Frequency of Region', 'DISTINCT_VALUES']
  ])('distinguishes column questions: "%s"', (query, intent) => {
    const result = analyzeQueryWithData(query, dataset);
    expect(result.intent).toBe(intent);
    expect(result.directAnswer).toBeTruthy();
  });

  it.each([
    ['How many rows are there?', 'ROW_COUNT'],
    ['What is the row count?', 'ROW_COUNT'],
    ['Are there missing values?', 'MISSING_VALUES'],
    ['Which columns have the most missing data?', 'MISSING_VALUES'],
    ['Are there data quality issues?', 'DATA_QUALITY'],
    ['How complete is the data?', 'MISSING_VALUES'],
    ['Are there duplicate rows?', 'DUPLICATE_ROWS'],
    ['Does the data have repeated records?', 'DUPLICATE_ROWS']
  ])('answers structural judgement question "%s"', (query, intent) => {
    const source = /duplicate|repeated/i.test(query)
      ? { ...dataset, rawRows: [...dataset.rawRows, { ...dataset.rawRows[0] }] }
      : dataset;
    const result = analyzeQueryWithData(query, source);
    expect(result.intent).toBe(intent);
    expect(result.directAnswer).toBeTruthy();
  });

  it('counts rows by a category without exposing the internal count field', () => {
    const result = analyzeQueryWithData('Count rows by Region', dataset);
    expect(result.intent).toBe('AGGREGATION_BY_DIMENSION');
    expect(result.recommendedCard).toMatchObject({ preferredX: 'Region', preferredY: '__count__', aggregation: 'count' });
    expect(result.directAnswer).not.toContain('__count__');
  });

  it('explains the currently filtered dataset scope instead of silently describing all rows', () => {
    const result = analyzeQueryWithData('Explain the dataset', dataset, null, { scopeFilters: { Region: 'East' } });
    expect(result.directAnswer).toContain('2 of 6 rows');
    expect(result.interpretation.matchedRows).toBe(2);
  });

  it('generates dozens of answerable, dataset-specific examples', () => {
    const groups = generateQuestionLibrary(dataset);
    const questions = groups.flatMap((group) => group.questions);
    expect(groups.map((group) => group.category)).toEqual(expect.arrayContaining([
      'Understand the data', 'Quality and structure', 'Metrics and distributions', 'Rank and compare', 'Time', 'Relationships'
    ]));
    expect(questions.length).toBeGreaterThanOrEqual(50);
    expect(questions).toContain('Explain Revenue');
    expect(questions).toContain('Correlation between Revenue and Cost');
    for (const question of questions) {
      const result = analyzeQueryWithData(question, dataset);
      expect(result.error, question).toBeUndefined();
      expect(result.intent, question).not.toBe('CLARIFICATION_REQUIRED');
      expect(result.directAnswer, question).toBeTruthy();
    }
  });

  it.each([
    ['Top 2 regions by revenue', 'RANKING'],
    ['What percentage of revenue comes from each region?', 'PERCENTAGE_CONTRIBUTION'],
    ['Compare revenue for East vs West', 'COMPARISON'],
    ['Average revenue', 'SINGLE_METRIC'],
    ['Show revenue trend over Order Date by Region', 'TREND_ANALYSIS'],
    ['How many values are missing?', 'MISSING_VALUES']
  ])('supports "%s" as %s', (query, intent) => {
    const result = analyzeQueryWithData(query, dataset);
    expect(result.intent).toBe(intent);
    expect(result.directAnswer).toBeTruthy();
    expect(result.interpretation).toBeTruthy();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.assumptions).toBeInstanceOf(Array);
  });

  it('limits explicit comparisons to the requested values', () => {
    const result = analyzeQueryWithData('Compare revenue for East vs West', dataset);
    expect(result.interpretation.comparisonValues).toEqual(expect.arrayContaining(['East', 'West']));
    expect(result.interpretation.matchedRows).toBe(4);
    expect(result.directAnswer).toContain('East');
    expect(result.directAnswer).toContain('West');
  });

  it('combines categorical, numeric, and date filters', () => {
    const result = analyzeQueryWithData(
      'Total Revenue by Region where Region is East and Revenue >= 120 between 2025-02-01 and 2025-04-30',
      dataset
    );
    expect(result.interpretation.matchedRows).toBe(1);
    expect(result.interpretation.filters).toHaveLength(2);
    expect(result.interpretation.dateRange).toMatchObject({ column: 'Order Date' });
  });

  it('inherits dashboard filters and reports that analytical scope', () => {
    const result = analyzeQueryWithData('Average revenue', dataset, null, {
      scopeFilters: { Region: 'East' }
    });
    expect(result.interpretation.matchedRows).toBe(2);
    expect(result.interpretation.dashboardFilters).toEqual([
      { column: 'Region', operator: '=', value: 'East', source: 'dashboard' }
    ]);
    expect(result.directAnswer).toContain('125');
  });

  it('returns an empty result when question and dashboard filters conflict', () => {
    const result = analyzeQueryWithData('Total revenue by Region where Region is West', dataset, null, {
      scopeFilters: { Region: 'East' }
    });
    expect(result.interpretation.matchedRows).toBe(0);
    expect(result.directAnswer).toMatch(/no rows match/i);
  });

  it('understands a misspelled column name without hiding the interpretation', () => {
    const result = analyzeQueryWithData('average reveneu', dataset);
    expect(result.intent).toBe('SINGLE_METRIC');
    expect(result.interpretation.metrics).toEqual(['Revenue']);
  });

  it('returns a clarification instead of guessing unsupported questions', () => {
    const result = analyzeQueryWithData('Can you forecast our business strategy?', dataset);
    expect(result.intent).toBe('CLARIFICATION_REQUIRED');
    expect(result.clarification.options).toContain('Revenue');
    expect(result.recommendedCard).toBeNull();
  });

  it('reports empty filtered results safely', () => {
    const result = analyzeQueryWithData('Total Revenue by Region where Region is Atlantis', dataset);
    expect(result.directAnswer).toMatch(/no rows match/i);
    expect(result.recommendedCard).toBeNull();
  });

  it('creates a grouped trend chart when a series dimension is named', () => {
    const result = analyzeQueryWithData('Show revenue trend over Order Date by Region', dataset);
    expect(result.recommendedCard).toMatchObject({
      chartType: 'multiSpline', preferredX: 'Order Date', preferredY: 'Revenue', preferredGroup: 'Region'
    });
  });

  it('supports explicit conversational follow-ups without silently carrying old query filters', () => {
    const first = analyzeQueryWithData('Top 2 regions by revenue', dataset);
    const followUp = analyzeQueryWithData('Now only West', dataset, null, {
      context: first.interpretation
    });
    expect(followUp.intent).toBe('RANKING');
    expect(followUp.interpretation).toMatchObject({
      metrics: ['Revenue'], dimensions: ['Region'], aggregation: 'sum', matchedRows: 2
    });
    expect(followUp.interpretation.filters).toEqual([
      { column: 'Region', operator: '=', value: 'West' }
    ]);
    expect(followUp.assumptions[0]).toMatch(/previous answer/i);
  });

  it('can change the measure while retaining the prior grouping', () => {
    const first = analyzeQueryWithData('Top 2 regions by revenue', dataset);
    const followUp = analyzeQueryWithData('What about cost?', dataset, null, {
      context: first.interpretation
    });
    expect(followUp.intent).toBe('RANKING');
    expect(followUp.interpretation.metrics).toEqual(['Cost']);
    expect(followUp.interpretation.dimensions).toEqual(['Region']);
  });
});

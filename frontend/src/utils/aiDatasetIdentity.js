const columnNames = (dataset) => {
  const declared = (dataset?.columns || []).map((column) =>
    typeof column === 'string' ? column : column?.name).filter(Boolean);
  return [...new Set([...declared, ...(dataset?.rowStorage?.firstRowFields || Object.keys(dataset?.rawRows?.[0] || {}))])];
};

const columnType = (dataset, name) => String((dataset?.columns || []).find((entry) =>
  typeof entry === 'object' && entry?.name === name)?.type || '').toLowerCase();

export const getDatasetRevision = (dataset) => dataset?.metadataOnly ? dataset.datasetRevision : [
  dataset?.id || dataset?.name || 'dataset',
  dataset?.revision || dataset?.checksum || dataset?.updatedAt || '',
  dataset?.rawRows?.length || dataset?.rowStorage?.streams?.rawRows?.length || dataset?.rowCount || 0,
  columnNames(dataset).join('|')
].join('::');

/** Generate prompts from existing metadata without scanning source rows. */
export const generateSuggestedPrompts = (dataset) => {
  const names = columnNames(dataset || {});
  const groups = dataset?.metrics?.columnGroups || {};
  const numeric = groups.numeric || names.filter((name) =>
    ['number', 'numeric', 'integer', 'float'].includes(columnType(dataset, name)));
  const dates = groups.date || names.filter((name) =>
    ['date', 'datetime', 'timestamp'].includes(columnType(dataset, name)));
  const categorical = groups.dimensions?.length
    ? groups.dimensions.filter((name) => !dates.includes(name))
    : groups.categorical || names.filter((name) => !numeric.includes(name) && !dates.includes(name));
  const metric = numeric[0]; const second = numeric[1];
  const category = categorical[0]; const date = dates[0]; const prompts = [];
  if (metric && date) prompts.push(`Trend of ${metric} over ${date}`);
  if (metric && category) prompts.push(`Top 5 ${category} by ${metric}`, `Percentage contribution of ${metric} by ${category}`);
  if (metric) prompts.push(`Find outliers in ${metric}`);
  if (metric && second) prompts.push(`Correlation between ${metric} and ${second}`);
  prompts.push('Summarize this dataset');
  return [...new Set(prompts)].slice(0, 4);
};

/** A broad, dataset-specific question catalogue shown on demand in the assistant. */
export const generateQuestionLibrary = (dataset) => {
  const names = columnNames(dataset || {});
  const groups = dataset?.metrics?.columnGroups || {};
  const numeric = groups.numeric || names.filter((name) => ['number', 'numeric', 'integer', 'float'].includes(columnType(dataset, name)));
  const dates = groups.date || names.filter((name) => ['date', 'datetime', 'timestamp'].includes(columnType(dataset, name)));
  const categorical = groups.dimensions?.length
    ? groups.dimensions.filter((name) => !dates.includes(name))
    : groups.categorical || names.filter((name) => !numeric.includes(name) && !dates.includes(name));
  const metric = numeric[0] || 'numeric column'; const secondMetric = numeric[1];
  const category = categorical[0] || 'category'; const date = dates[0];
  const values = [...new Set((dataset?.rawRows || []).slice(0, 500).map((row) => row?.[category]).filter((value) => value !== null && value !== undefined && value !== ''))].slice(0, 2);
  return [
    { category: 'Understand the data', questions: [
      'Explain this dataset', 'Walk me through this data', 'Describe this dataset', 'Summarize this table',
      'Give me an overview of the data', 'What columns and data types are present?', 'What is the schema?',
      'How many rows are there?', 'What are the key insights?', 'Give me the big picture'
    ] },
    { category: 'Quality and structure', questions: [
      'Are there missing values?', 'Which columns have the most missing data?', 'Are there duplicate rows?',
      'Are there data quality issues?', 'How complete is the dataset?', 'Which columns are fully populated?',
      'Are there blank or null cells?', 'Does the data have repeated records?',
      `What unique values are in ${category}?`, `What is the most common ${category}?`
    ] },
    { category: 'Metrics and distributions', questions: [
      `Explain ${metric}`, `Profile ${metric}`, `Describe the distribution of ${metric}`,
      `Show descriptive statistics for ${metric}`, `What is the range of ${metric}?`, `What is a typical ${metric}?`,
      `What is the total ${metric}?`, `What is the average ${metric}?`, `What is the median ${metric}?`,
      `What is the minimum ${metric}?`, `What is the maximum ${metric}?`, `Find unusual values in ${metric}`,
      `Are there spikes or anomalies in ${metric}?`
    ] },
    { category: 'Rank and compare', questions: [
      `Top 5 ${category} by ${metric}`, `Bottom 5 ${category} by ${metric}`,
      `Rank ${category} by ${metric}`, `Which ${category} has the highest ${metric}?`,
      `Which ${category} has the lowest ${metric}?`, `What percentage of ${metric} comes from each ${category}?`,
      `Show the ${metric} contribution by ${category}`, `Count rows by ${category}`,
      `Average ${metric} by ${category}`, `Total ${metric} by ${category}`,
      ...(values.length >= 2 ? [`Compare ${metric} for ${values[0]} vs ${values[1]}`] : [])
    ] },
    { category: 'Time', questions: [
      ...(date ? [`Show the trend of ${metric} over ${date}`, `Plot ${metric} over ${date}`,
        `Why did ${metric} change over ${date}?`, `Is ${metric} increasing or decreasing?`,
        `Show ${metric} over ${date} by ${category}`, `Top 5 ${date} by ${metric}`,
        `Total ${metric} between 2025-01-01 and 2025-12-31`, `What happened to ${metric} in the last period?`] : [])
    ] },
    { category: 'Relationships', questions: [
      ...(secondMetric ? [`Correlation between ${metric} and ${secondMetric}`, `What is the relationship between ${metric} and ${secondMetric}?`,
        `How is ${metric} related to ${secondMetric}?`, `Is ${metric} associated with ${secondMetric}?`] : [])
    ] }
  ].filter(({ questions }) => questions.length > 0);
};

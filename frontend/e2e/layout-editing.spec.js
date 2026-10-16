import { openLayoutOptions } from './review-helpers.js';
import { expect, test } from '@playwright/test';

test('the assistant explains the dataset and graph previews match responsive renderers', async ({ page }) => {
  await page.goto('/dashboard');

  await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill('Explain this dataset');
  await page.getByRole('button', { name: /^Ask$/ }).click();
  await expect(page.getByText(/This is a tabular dataset with/i)).toBeVisible();
  await expect(page.getByText('DATASET SUMMARY', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit dashboard' });
  await expect(editor.locator('svg[data-preview-type]')).toHaveCount(42);
  await expect(editor.locator('svg[data-preview-type="heatmap"] rect')).toHaveCount(16);
  await editor.getByRole('button', { name: 'Add Correlation heatmap graph' }).click();

  const card = page.locator('.react-grid-item').filter({
    has: page.locator('input[aria-label="Chart title"][value="Heatmap chart"]')
  });
  await expect(card.getByRole('img', { name: /annotated Pearson correlation matrix/i })).toBeVisible();
  await expect(card.getByTestId('correlation-heatmap')).toBeVisible();

  const widthBefore = (await card.boundingBox()).width;
  await card.getByRole('button', { name: 'Increase graph width' }).click();
  await expect.poll(async () => (await card.boundingBox()).width).toBeGreaterThan(widthBefore);
  await expect(card.getByRole('img', { name: /annotated Pearson correlation matrix/i })).toBeVisible();
});

test('a chat recommendation keeps its metric contract, avoids duplicates, supports undo, and survives reload', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401, json: { detail: 'Guest mode' } }));
  await page.goto('/dashboard');
  const cards = page.locator('.react-grid-item');
  await expect(cards.first()).toBeVisible();
  const originalCount = await cards.count();

  await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill('Top 5 Plan by MRR');
  await page.getByRole('button', { name: /^Ask$/ }).click();
  await expect(page.getByText(/Starter leads with 385,000 Total MRR/i)).toBeVisible();

  const addButton = page.getByRole('button', { name: 'Add Bar chart: Total MRR by Plan' });
  await addButton.click();
  await expect(cards).toHaveCount(originalCount + 1);

  const chart = page.getByRole('figure', {
    name: /Total MRR by Plan\. bar chart showing MRR by Plan, using sum, across 12 loaded rows\. Leading values: Starter 385,000, Pro 348,000, Enterprise 319,000/i
  });
  await expect(chart).toBeVisible();
  const card = page.locator('.react-grid-item').filter({ has: chart });
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(await card.getAttribute('id'));
  await expect(card.locator('svg').getByText('Starter', { exact: true })).toBeVisible();
  await expect(card.locator('svg').getByText('Pro', { exact: true })).toBeVisible();
  await expect(card.locator('svg').getByText('Enterprise', { exact: true })).toBeVisible();
  await expect(card.getByText('Count', { exact: true })).toHaveCount(0);

  const viewButton = page.getByRole('button', { name: 'View added chart' });
  await viewButton.click();
  await expect(cards).toHaveCount(originalCount + 1);

  await page.getByRole('button', { name: 'Undo', exact: true }).last().click();
  await expect(cards).toHaveCount(originalCount);
  await expect(page.getByRole('button', { name: 'Add Bar chart: Total MRR by Plan' })).toBeVisible();

  await page.getByRole('button', { name: 'Add Bar chart: Total MRR by Plan' }).click();
  await expect(cards).toHaveCount(originalCount + 1);
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('local_dashboard_layout') || '{"layout":[]}');
    return saved.layout.map((item) => item.title);
  })).toContain('Total MRR by Plan');
  await page.reload();
  await expect(page.getByRole('figure', { name: /Total MRR by Plan\. bar chart showing MRR by Plan, using sum/i })).toBeVisible();
});

test('the generated smart dashboard exposes the full graph editor', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Smart Layout' }).click();
  const review = page.getByRole('dialog', { name: 'Choose an analysis goal' });
  await expect(review).toBeVisible();
  await review.getByLabel('Analysis goal').selectOption('comparisons');
  await review.locator('article').filter({ has: page.getByRole('heading', { name: 'Comparisons dashboard' }) }).getByRole('button', { name: 'Use this layout' }).click();
  await expect(review).toBeHidden();
  await expect(page.getByRole('button', { name: 'Exit Smart', exact: true })).toBeVisible();

  const cards = page.locator('.react-grid-item');
  const originalCount = await cards.count();

  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit dashboard' });
  await expect(editor).toBeVisible();

  await editor.getByRole('button', { name: 'Add Bar graph' }).click();
  await expect(cards).toHaveCount(originalCount + 1);

  const addedCard = cards.last();
  await expect(addedCard.getByText('Graph configuration is valid')).toBeVisible();
  await addedCard.getByLabel('Chart title').fill('Editable smart chart');
  await addedCard.getByLabel('Chart title').press('Enter');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(addedCard.getByRole('heading', { name: 'Editable smart chart', exact: true })).toBeVisible();
});

test('a four-column numeric dataset renders an interactive 4D graph', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit dashboard' });
  await editor.getByLabel('Search graph types').fill('4D');
  await editor.getByRole('button', { name: 'Add 4D bubble graph' }).click();

  const chart = page.getByRole('img', { name: '4D bubble chart interactive visualization' });
  await expect(chart).toBeVisible();
  await expect(chart.locator('.gl-container')).toHaveCount(1);
  await expect(page.getByLabel('Z Axis')).toHaveValue('ChurnRate');
  await expect(page.getByLabel('4th dimension (size)')).toHaveValue('CAC');
  await expect(chart.locator('.plot-container')).toBeVisible({ timeout: 15000 });
});

test('wave and curve graphs are discoverable and render through both chart engines', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit dashboard' });
  await editor.getByLabel('Search graph types').fill('Wave & curves');

  for (const name of [
    'Spline / smooth line', 'Smooth area', 'Multi-series spline', 'Streamgraph',
    'Range area / confidence band', 'Real-time waveform', 'Sine wave generator'
  ]) {
    await expect(editor.getByRole('button', { name: `Add ${name} graph` })).toBeVisible();
  }

  await editor.getByRole('button', { name: 'Add Spline / smooth line graph' }).click();
  const card = page.locator('.react-grid-item').filter({
    has: page.locator('input[aria-label="Chart title"][value="Spline / smooth line chart"]')
  });
  const configurationButton = card.getByRole('button', { name: 'Configure Spline / smooth line chart' });
  await configurationButton.click();
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.recharts-wrapper')).toBeVisible();
  await expect(card.locator('.recharts-line-curve')).toHaveCount(1);

  await configurationButton.click();
  await card.getByLabel('Chart type').selectOption('smoothArea');
  await configurationButton.click();
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.recharts-wrapper')).toBeVisible();
  await expect(card.locator('.recharts-area-area')).toHaveCount(1);
  await configurationButton.click();
  await card.getByLabel('Chart type').selectOption('waveform');
  await configurationButton.click();
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.recharts-wrapper')).toBeVisible();
  await expect(card.locator('.recharts-line-curve')).toHaveCount(1);
  await configurationButton.click();
  await card.getByLabel('Chart type').selectOption('sineWave');
  await configurationButton.click();
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.recharts-wrapper')).toBeVisible();
  await expect(card.locator('.recharts-line-curve')).toHaveCount(1);

  await configurationButton.click();
  await card.getByLabel('Chart type').selectOption('streamgraph');
  await configurationButton.click({ force: true });
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.plot-container')).toBeVisible({ timeout: 15000 });
});

test('categorical chart sections use distinct solid colors', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit dashboard' });
  await editor.getByRole('button', { name: 'Add Pie graph' }).click();

  const card = page.locator('.react-grid-item').filter({
    has: page.locator('input[aria-label="Chart title"][value="Pie chart"]')
  });
  await card.getByRole('button', { name: 'Configure Pie chart' }).click();
  await card.scrollIntoViewIfNeeded();
  const slices = card.locator('.recharts-pie-sector path');
  await expect(slices).toHaveCount(12);
  const firstFourColors = await slices.evaluateAll((nodes) => (
    nodes.slice(0, 4).map((node) => node.getAttribute('fill'))
  ));
  expect(firstFourColors).toEqual(['#DC2626', '#2563EB', '#16A34A', '#EAB308']);
});

test('a local dashboard supports add, delete, undo, redo, and autosave', async ({ page }) => {
  // This exercises an entire edit/drag/resize/reload journey on every engine.
  // Windows WebKit spends longer waiting for actionable animation frames;
  // individual correctness assertions retain their normal deadlines.
  test.setTimeout(120_000);
  await page.goto('/upload');
  await page.getByRole('button', { name: /explore sample data/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole('button', { name: 'New Layout' }).click();
  await page.getByPlaceholder('Layout name').fill('Editing lifecycle');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await openLayoutOptions(page);
  await expect(page.getByRole('button', { name: 'Add Card' })).toBeVisible();

  const cards = page.locator('.react-grid-item');
  const saveStatus = page.locator('.dashboard-toolbar [role="status"]');
  const originalCount = await cards.count();

  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit dashboard' });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Add KPI graph' }).click();
  await expect(cards).toHaveCount(originalCount + 1);
  await page.getByRole('button', { name: 'Cancel changes' }).click();
  await expect(cards).toHaveCount(originalCount);

  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Add Bar graph' }).click();
  await expect(cards).toHaveCount(originalCount + 1);
  await expect(editor).toBeHidden();
  const barCard = cards.last();
  await expect(barCard.getByText('Graph configuration is valid')).toBeVisible();
  await barCard.getByLabel('Graph color').selectOption('orange');
  await barCard.getByLabel('Show legend').uncheck();
  await barCard.getByLabel('Show data labels').check();
  await barCard.getByLabel('Number format').selectOption('compact');
  await expect(barCard.getByLabel('Graph color')).toHaveValue('orange');
  await barCard.getByRole('button', { name: 'Configure Bar chart' }).click();
  await expect(barCard.locator('.recharts-bar-rectangle path').first()).toHaveAttribute('fill', '#DC2626');
  await expect(barCard.locator('.recharts-legend-wrapper')).toHaveCount(0);
  await expect(barCard.locator('text.recharts-label').first()).toBeVisible();
  await barCard.getByRole('button', { name: 'Configure Bar chart' }).click();
  await barCard.getByLabel('Chart type').selectOption('scatter');
  await expect(barCard.getByLabel('X Axis')).not.toHaveValue('');
  await expect(barCard.getByLabel('Y Axis')).not.toHaveValue('');
  await expect(barCard.getByText('Graph configuration is valid')).toBeVisible();
  const moveHandle = page.getByRole('button', { name: 'Move or resize Bar chart' });
  await expect(moveHandle).toBeVisible();
  const heightBeforeKeyboardResize = (await barCard.boundingBox()).height;
  await moveHandle.press('Shift+ArrowDown');
  await expect.poll(async () => (await barCard.boundingBox()).height).toBeGreaterThan(heightBeforeKeyboardResize);

  await barCard.getByRole('button', { name: 'Configure Bar chart' }).click();
  const xBeforePointerDrag = (await barCard.boundingBox()).x;
  const moveBox = await moveHandle.boundingBox();
  await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(moveBox.x + moveBox.width / 2 + 360, moveBox.y + moveBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await barCard.boundingBox()).x).toBeGreaterThan(xBeforePointerDrag + 100);

  const heightBeforePointerResize = (await barCard.boundingBox()).height;
  const resizeHandle = barCard.locator('.react-resizable-handle-se');
  await resizeHandle.scrollIntoViewIfNeeded();
  const resizeBox = await resizeHandle.boundingBox();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2 - 110, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await barCard.boundingBox()).height).toBeLessThan(heightBeforePointerResize);

  await page.getByRole('button', { name: 'Manage graphs' }).click();
  await editor.getByRole('button', { name: 'Duplicate Bar chart' }).click();
  await expect(cards).toHaveCount(originalCount + 2);
  await editor.getByRole('button', { name: 'Reset Bar chart copy' }).click();
  await expect(editor.getByRole('button', { name: 'View Bar chart' })).toBeVisible();

  await editor.getByRole('button', { name: 'View Bar chart' }).click();
  await expect(editor).toBeHidden();
  await expect(moveHandle).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(moveHandle).toBeHidden();

  const editedCount = originalCount + 2;

  await openLayoutOptions(page);
  await page.getByRole('button', { name: 'Add Card' }).click();
  await expect(cards).toHaveCount(editedCount + 1);
  await expect(saveStatus).toContainText(/unsaved|saving|saved/i);

  await page.getByRole('button', { name: 'Undo dashboard change' }).click();
  await expect(cards).toHaveCount(editedCount);
  await page.getByRole('button', { name: 'Redo dashboard change' }).click();
  await expect(cards).toHaveCount(editedCount + 1);

  const addedCard = cards.last();
  await addedCard.getByRole('button', { name: /configure/i }).click();
  await addedCard.getByRole('button', { name: 'Remove card' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).last().click();
  await expect(cards).toHaveCount(editedCount + 1);
  await expect(saveStatus).toContainText(/saved/i, { timeout: 3000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => {
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    return Math.abs(first.x - second.x);
  }).toBeLessThan(2);
  const firstMobileCard = await cards.nth(0).boundingBox();
  const secondMobileCard = await cards.nth(1).boundingBox();
  expect(Math.abs(firstMobileCard.width - secondMobileCard.width)).toBeLessThan(2);
  expect(secondMobileCard.y).toBeGreaterThan(firstMobileCard.y);
});

test('KPI and table templates persist while reset and touch ordering remain cancelable', async ({ page }) => {
  await page.goto('/upload');
  await page.getByRole('button', { name: /explore sample data/i }).click();
  await page.getByRole('button', { name: 'New Layout' }).click();
  await page.getByPlaceholder('Layout name').fill('Template coverage');
  await page.getByRole('button', { name: /^Save$/ }).click();
  const cards = page.locator('.react-grid-item');
  const originalCount = await cards.count();

  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit dashboard' });
  await editor.getByRole('button', { name: 'Add KPI graph' }).click();
  const kpiCard = cards.last();
  await kpiCard.getByRole('button', { name: 'Configure KPI chart' }).click();
  await expect(kpiCard.getByText('Row count')).toBeVisible();

  await page.getByRole('button', { name: 'Manage graphs' }).click();
  await editor.getByRole('button', { name: 'Add Table graph' }).click();
  const tableCard = cards.last();
  await tableCard.getByRole('button', { name: 'Configure Table chart' }).click();
  await expect(tableCard.getByRole('region', { name: 'Table chart data preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(cards).toHaveCount(originalCount + 2);

  await page.reload();
  await expect(cards).toHaveCount(originalCount + 2);
  await expect(page.locator('input[aria-label="Chart title"][value="KPI chart"]')).toBeVisible();
  await expect(page.locator('input[aria-label="Chart title"][value="Table chart"]')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept('Renamed template layout'));
  await openLayoutOptions(page);
  await page.getByRole('button', { name: 'Rename current layout' }).click();
  await expect(page.getByRole('combobox', { name: 'Select dashboard layout' })).toContainText('Renamed template layout');
  await openLayoutOptions(page);
  await page.getByRole('button', { name: 'Duplicate current layout' }).click();
  await expect(page.getByRole('combobox', { name: 'Select dashboard layout' })).toHaveValue(/^local_/);
  await openLayoutOptions(page);
  await page.getByRole('button', { name: 'Set current layout as default' }).click();
  await openLayoutOptions(page);
  await expect(page.getByRole('button', { name: 'Current layout is default' })).toBeDisabled();

  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  await editor.getByRole('button', { name: 'Move Table chart earlier' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await editor.getByRole('button', { name: 'Reset entire dashboard' }).click();
  await editor.getByRole('button', { name: 'Cancel changes' }).click();
  await expect(cards).toHaveCount(originalCount + 2);
});

test('an authenticated layout survives a server save and reload', async ({ page }) => {
  test.skip(process.env.E2E_SERVER_WORKSPACE !== 'true', 'Server saves are disabled in the personal build.');
  const timestamps = { createdAt: '2026-09-11T10:00:00Z', updatedAt: '2026-09-11T10:00:00Z' };
  const serverDataset = {
    id: 'server-dataset', name: 'Server sales', rowCount: 2,
    columns: [{ name: 'Region', type: 'string' }, { name: 'Revenue', type: 'number' }]
  };
  const serverRows = [{ Region: 'West', Revenue: 10 }, { Region: 'East', Revenue: 20 }];
  let savedLayout = {
    id: 'server-layout',
    name: 'Server dashboard',
    version: 1,
    userId: 'user-1',
    ...timestamps,
    layout: [{ i: '1', x: 0, y: 0, w: 4, h: 3, title: 'Server chart', chartType: 'bar' }]
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 'user-1', email: 'owner@example.com', name: 'Owner', role: 'ADMIN' } });
    if (path.endsWith('/config')) return route.fulfill({ json: {
      branding: { siteName: 'Analytics Dashboard', homeTitle: 'Analytics Dashboard', homeDescription: '', primaryColor: '#2563EB', template: 'standard' },
      sections: { showCapabilities: true, showDashboard: true, showUpload: true },
      features: { localUpload: true, urlImport: true, dataAssistant: false, reports: true, exports: true, serverWorkspace: 'admin', serverAnalytics: 'admin', serverLayouts: 'admin', serverExports: 'admin' }
    } });
    if (path.endsWith('/datasets')) return route.fulfill({ json: { datasets: [serverDataset], pagination: { total: 1 } } });
    if (path.endsWith('/datasets/server-dataset/data')) return route.fulfill({ json: { data: serverRows, total: 2, page: 1, limit: 50 } });
    if (path.endsWith('/analytics/descriptive')) return route.fulfill({ json: { Revenue: { count: 2, mean: 15, missing: 0 } } });
    if (path.endsWith('/layouts') && request.method() === 'GET') return route.fulfill({ json: [savedLayout] });
    if (path.endsWith('/layouts/server-layout') && request.method() === 'PUT') {
      const payload = request.postDataJSON();
      savedLayout = { ...savedLayout, ...payload, version: savedLayout.version + 1, updatedAt: '2026-09-11T10:05:00Z' };
      return route.fulfill({ json: savedLayout });
    }
    return route.fulfill({ status: 404, json: { detail: 'Not mocked' } });
  });

  await page.goto('/dashboard');
  const datasetSelector = page.locator('select:has(option[value="server-dataset"])').first();
  await expect(datasetSelector).toBeVisible();
  await datasetSelector.selectOption('server-dataset');
  const layoutSelector = page.getByRole('combobox', { name: 'Select dashboard layout' });
  await expect(layoutSelector.locator('option[value="server-layout"]')).toHaveCount(1);
  await layoutSelector.selectOption('server-layout');
  await expect(page.locator('input[aria-label="Chart title"][value="Server chart"]')).toBeVisible();
  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  const card = page.locator('.react-grid-item').first();
  await card.getByLabel('Chart title').fill('Persisted server chart');
  await card.getByLabel('Chart title').press('Enter');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => savedLayout.layout[0].title).toBe('Persisted server chart');

  await page.reload();
  await expect(datasetSelector).toBeVisible();
  await datasetSelector.selectOption('server-dataset');
  await expect(layoutSelector.locator('option[value="server-layout"]')).toHaveCount(1);
  await layoutSelector.selectOption('server-layout');
  await expect(page.locator('input[aria-label="Chart title"][value="Persisted server chart"]')).toBeVisible();
});

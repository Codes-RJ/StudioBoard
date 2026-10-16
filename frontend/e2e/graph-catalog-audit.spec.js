import { expect, test } from '@playwright/test';
import { CHART_TYPE_OPTIONS } from '../src/utils/chartCatalog.js';

for (const { value, label } of CHART_TYPE_OPTIONS) {
  test(`graph catalog: ${label} renders or explains missing fields`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Edit dashboard' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit dashboard' });
    const add = editor.getByRole('button', { name: `Add ${label} graph`, exact: true });
    if (await add.isDisabled()) {
      expect(await add.getAttribute('title')).toBeTruthy();
      await expect(add).toContainText(/need|require|numeric|column|field/i);
      return;
    }
    const cards = page.locator('.react-grid-item');
    const count = await cards.count();
    await add.click();
    await expect(cards).toHaveCount(count + 1);
    // Adding a graph closes the gallery and focuses its configuration.
    const card = cards.last();
    await card.scrollIntoViewIfNeeded();
    if (await card.getByText('Graph configuration is valid', { exact: false }).count()) {
      await card.getByRole('button', { name: /^Configure / }).click();
    }
    if (value === 'table') await expect(card.locator('table')).toBeVisible();
    else if (value === 'kpi') {
      await expect(card.getByText('Row count', { exact: true })).toBeVisible();
      await expect(card.locator('p').filter({ hasText: /^12$/ })).toBeVisible();
    }
    else await expect(card.locator('.recharts-wrapper, .plot-container, [data-testid="correlation-heatmap"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText(/failed|could not|cannot render|invalid configuration/i)).toHaveCount(0);
    expect(errors).toEqual([]);
    if (['bar', 'heatmap', 'scatter3d', 'sankey'].includes(value)) {
      await card.screenshot({ path: test.info().outputPath(`${value}.png`) });
    }
  });
}

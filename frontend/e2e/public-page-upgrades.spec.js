import { expect, test } from '@playwright/test';

test('a themed skeleton covers initial bundle loading and a delayed page transition', async ({ page }) => {
  let releaseBoot;
  const boot = new Promise((resolve) => { releaseBoot = resolve; });
  await page.route('**/assets/index-*.js', async (route) => { await boot; await route.continue(); });
  try {
    // A deferred module blocks DOMContentLoaded; inspect the HTML before it runs.
    await page.goto('/upload', { waitUntil: 'commit' });
    await expect(page.getByRole('status', { name: 'Loading page' })).toBeVisible();
    await expect(page.locator('.skeleton-chart')).toBeVisible();
  } finally { releaseBoot(); }
  await expect(page.getByLabel('Choose a data file', { exact: true })).toBeAttached();

  let releaseRoute;
  const pendingRoute = new Promise((resolve) => { releaseRoute = resolve; });
  await page.route('**/assets/HowItWorks-*.js', async (route) => { await pendingRoute; await route.continue(); });
  try {
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'How it works', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Loading page' })).toBeVisible();
    await expect(page.locator('.skeleton-panel')).toBeVisible();
  } finally { releaseRoute(); }
  await expect(page.getByRole('heading', { name: /Good questions/ })).toBeVisible();
});

test('guide opening and four steps each fill 98 percent of desktop screens', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1024, height: 640 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/how-it-works', { waitUntil: 'networkidle' });
    await expect(page.locator('.guide-page')).toHaveAttribute('data-motion', 'reduced');
    const sizes = await page.evaluate(() => ({
      opening: document.querySelector('.site-header').getBoundingClientRect().height + document.querySelector('.guide-opening').getBoundingClientRect().height,
      steps: [...document.querySelectorAll('.guide-stage')].map((node) => node.getBoundingClientRect().height)
    }));
    for (const height of [sizes.opening, ...sizes.steps]) expect(Math.abs(height - viewport.height * .98)).toBeLessThan(1);
    expect(sizes.steps).toHaveLength(4);
  }
});

test('public SVG illustrations lift with a shadow and reduced motion stops the effect', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/privacy', { waitUntil: 'networkidle' });
  const art = page.locator('.document-art');
  await art.hover();
  await expect.poll(() => art.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m42)).toBeLessThan(-7);
  await expect(art).toHaveCSS('filter', /drop-shadow/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(art).toHaveCSS('transform', 'none');
  for (const route of ['/privacy', '/terms']) {
    await page.goto(route, { waitUntil: 'networkidle' });
    await expect(page.locator('.document-heading-art svg')).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/Last updated:|Effective date:/i);
  }
  await expect(page.getByRole('link', { name: /Visit me/ })).toHaveAttribute('href', '/');
});

test('scrolling into the workflow produces a visible reveal and settles without moving controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.editorial-motion')).toHaveAttribute('data-motion', 'enabled');
  const step = page.locator('.workflow-steps article').first();
  await step.evaluate((node) => window.scrollTo({ top: node.getBoundingClientRect().top + scrollY - innerHeight * .6, behavior: 'instant' }));
  await expect.poll(() => step.evaluate((node) => {
    const styles = getComputedStyle(node);
    return Number(styles.opacity) < .95 && new DOMMatrix(styles.transform).m42 > 8;
  }), { intervals: [16, 32, 50] }).toBe(true);
  await expect.poll(() => step.evaluate((node) => Number(getComputedStyle(node).opacity))).toBe(1);
  await expect.poll(() => step.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m42)).toBe(0);
});

test('guide and legal content remain readable at doubled text size', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const route of ['/how-it-works', '/privacy', '/terms']) {
    await page.goto(route, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.locator('h1')).toBeVisible();
    if (route === '/how-it-works') {
      await expect(page.locator('#review')).toHaveCSS('overflow', 'visible');
      expect(await page.locator('#review').evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    }
  }
});

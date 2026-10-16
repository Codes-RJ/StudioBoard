import { expect } from '@playwright/test';

export async function openWorkspaceActions(page) {
  const button = page.getByRole('button', { name: 'More actions', exact: true });
  await expect(button).toBeVisible();
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}

export async function openLayoutOptions(page) {
  const button = page.getByRole('button', { name: 'Manage current layout', exact: true });
  await expect(button).toBeVisible();
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}

export async function approveImportedData(page, { timeout } = {}) {
  if (process.env.E2E_SERVER_WORKSPACE === 'true') return;
  const gate = page.getByRole('heading', { name: 'Review data before visualization' });
  const assertionOptions = timeout === undefined ? {} : { timeout };
  await expect(gate).toBeVisible(assertionOptions);
  while (await gate.isVisible()) {
    const source = page.getByRole('listitem').filter({ hasText: 'Review required' }).first();
    await source.getByRole('button', { name: 'Review Data' }).click();
    const review = page.getByRole('dialog', { name: 'Data Quality & Cleaning' });
    await review.getByRole('button', { name: 'Approve Data' }).click();
    await expect(review).toBeHidden(assertionOptions);
  }
}

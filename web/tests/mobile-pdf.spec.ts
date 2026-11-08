import { expect, Page, test } from '@playwright/test';
import { syntheticPDF } from './synthetic-pdf';
import type { CV } from '../lib/api';

async function upload(page: Page, name: string, bytes = syntheticPDF) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('link', { name: 'CV library', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByLabel('PDF · up to 10 MiB').setInputFiles({
    name: 'synthetic-mobile.pdf',
    mimeType: 'application/pdf',
    buffer: bytes,
  });
  await page.getByRole('button', { name: '↑ Upload PDF' }).click();
  const card = page
    .locator('.cv-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(card).toBeVisible();
  return card;
}

async function centerPixel(page: Page) {
  return page
    .getByRole('dialog')
    .locator('canvas')
    .evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const data = canvas
        .getContext('2d')!
        .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      return [...data];
    });
}

test('mobile PDF paints both pages inline, zooms, and keeps all assets private and local', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/.test(message.text()))
      errors.push(message.text());
  });
  const card = await upload(page, 'Synthetic mobile reader ' + info.project.name);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await card.getByRole('button', { name: 'View PDF', exact: true }).click();
  await expect(page.getByRole('img', { name: 'PDF page 1 of 2' })).toBeVisible();
  const first = await centerPixel(page);
  expect(first[2]).toBeGreaterThan(150);
  expect(first[0]).toBeLessThan(80);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByRole('img', { name: 'PDF page 2 of 2' })).toBeVisible();
  const second = await centerPixel(page);
  expect(second[0]).toBeGreaterThan(150);
  expect(second[2]).toBeLessThan(80);
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
  const fitWidth = await page
    .getByRole('dialog')
    .locator('canvas')
    .evaluate((canvas) => canvas.getBoundingClientRect().width);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('2');
  await expect(page.getByRole('img', { name: 'PDF page 2 of 2' })).toBeVisible();
  expect(
    await page
      .getByRole('dialog')
      .locator('canvas')
      .evaluate((canvas) => canvas.getBoundingClientRect().width),
  ).toBeCloseTo(fitWidth * 2, 0);
  const size = await page
    .getByRole('dialog')
    .locator('canvas')
    .evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      return { width: canvas.width, height: canvas.height };
    });
  expect(size.width * size.height).toBeLessThanOrEqual(4_000_000);
  expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(4096);
  expect(await centerPixel(page)).toEqual(second);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(page.getByRole('img', { name: 'PDF page 1 of 2' })).toBeVisible();
  const original = await page.getByRole('link', { name: 'Open original PDF' }).getAttribute('href');
  const saved = await page.request.get(original!);
  expect(await saved.body()).toEqual(syntheticPDF);
  expect(saved.headers()['content-security-policy']).toBe("sandbox; default-src 'none'");
  expect(requests.some((url) => url.endsWith('pdf.worker.min.mjs'))).toBe(true);
  expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: `../.cache/mobile-pdf-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(card.getByRole('button', { name: 'View PDF', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test('mobile PDF shows fetch and parsing failures and recovers with Retry', async ({
  page,
}, info) => {
  const card = await upload(page, 'Synthetic mobile retry ' + info.project.name);
  let failing = true;
  await page.route('**/api/v1/cvs/*/pdf', (route) =>
    failing ? route.fulfill({ status: 503, body: 'Synthetic PDF outage' }) : route.continue(),
  );
  await card.getByRole('button', { name: 'View PDF', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'PDF could not be displayed',
  );
  await expect(page.getByRole('link', { name: 'Open original PDF' })).toBeVisible();
  failing = false;
  await page.getByRole('button', { name: 'Retry PDF', exact: true }).click();
  await expect(page.getByRole('img', { name: 'PDF page 1 of 2' })).toBeVisible();
  expect((await centerPixel(page))[2]).toBeGreaterThan(150);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  // The upload boundary accepts PDF-looking bytes without parsing them. An
  // invalid saved document must get a visible viewer failure, never a blank page.
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Synthetic invalid PDF ' + info.project.name);
  await page.getByLabel('PDF · up to 10 MiB').setInputFiles({
    name: 'synthetic-invalid.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nSynthetic invalid contents\n%%EOF\n'),
  });
  await page.getByRole('button', { name: '↑ Upload PDF' }).click();
  const invalid = page.locator('.cv-card').filter({
    has: page.getByRole('heading', {
      name: 'Synthetic invalid PDF ' + info.project.name,
      exact: true,
    }),
  });
  await invalid.getByRole('button', { name: 'View PDF', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'PDF could not be displayed',
  );
  await expect(page.getByRole('dialog').getByRole('img')).toHaveCount(0);
});

test('mobile job details open read-only, link to Edit, and preserve an archived draft CV', async ({
  page,
}, info) => {
  const name = 'Synthetic mobile details CV ' + info.project.name,
    title = 'Synthetic mobile details role ' + info.project.name;
  await upload(page, name);
  const cv = ((await (await page.request.get('/api/v1/cvs')).json()) as CV[]).find(
    (item) => item.name === name,
  )!;
  await page.getByRole('link', { name: 'Applications', exact: true }).click();
  await page.getByRole('button', { name: '+ Add application', exact: true }).click();
  await page.getByRole('textbox', { name: 'Job title', exact: true }).fill(title);
  await page
    .getByRole('textbox', { name: 'Company', exact: true })
    .fill('Synthetic mobile company');
  await page
    .getByRole('textbox', { name: 'Why this role', exact: true })
    .fill('Synthetic saved job information.');
  await page
    .getByRole('textbox', { name: 'Feedback / notes', exact: true })
    .fill('Synthetic mobile notes.');
  await page.getByLabel('CV to prepare (optional)').selectOption(cv.id);
  await page.getByRole('button', { name: 'Save application', exact: true }).click();
  const job = page.getByRole('button', { name: title, exact: true });
  await job.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('form')).toHaveCount(0);
  await expect(dialog.getByText('Synthetic mobile company', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Synthetic saved job information.', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `../.cache/mobile-details-${info.project.name}.png`,
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Edit application', exact: false }).click();
  await expect(dialog.getByRole('textbox', { name: 'Job title', exact: true })).toHaveValue(title);
  await dialog
    .getByRole('textbox', { name: 'Feedback / notes', exact: true })
    .fill('Synthetic edited notes.');
  await dialog.getByRole('button', { name: 'Save application', exact: true }).click();
  await job.click();
  await expect(dialog.getByText('Synthetic edited notes.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: name, exact: false }).click();
  await expect(dialog.getByRole('img', { name: 'PDF page 1 of 2' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to details', exact: false }).click();
  await expect(dialog.locator('form')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'View history', exact: true }).click();
  await expect(
    dialog.getByText('Submit this application before adding a response.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to details', exact: false }).click();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(job).toBeFocused();
  await page.getByRole('link', { name: 'CV library', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search CVs', exact: true }).fill(name);
  const card = page
    .locator('.cv-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  await card.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('switch', { name: 'Active only', exact: true }).uncheck();
  await expect(card.getByText('Archived', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `../.cache/mobile-library-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Applications', exact: true }).click();
  await page.getByRole('button', { name: '+ Add application', exact: true }).click();
  await expect(
    dialog.getByLabel('CV to prepare (optional)').locator(`option[value="${cv.id}"]`),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await job.click();
  await expect(dialog.getByRole('button', { name: name, exact: false })).toContainText('Archived');
  await dialog.getByRole('button', { name: 'Edit application', exact: false }).click();
  await expect(dialog.getByLabel('CV to prepare (optional)')).toHaveValue(cv.id);
  await expect(
    dialog.getByLabel('CV to prepare (optional)').locator('option:checked'),
  ).toContainText('Archived');
  await dialog.getByRole('button', { name: 'Back to details', exact: false }).click();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(job).toBeFocused();
});

test('closing a mobile PDF cancels its pending authenticated fetch and can reopen cleanly', async ({
  page,
}, info) => {
  const card = await upload(page, 'Synthetic canceled PDF ' + info.project.name);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/cvs/*/pdf', async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await card.getByRole('button', { name: 'View PDF', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Loading PDF…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  release();
  await page.unroute('**/api/v1/cvs/*/pdf');
  await card.getByRole('button', { name: 'View PDF', exact: true }).click();
  await expect(page.getByRole('img', { name: 'PDF page 1 of 2' })).toBeVisible();
  expect((await centerPixel(page))[2]).toBeGreaterThan(150);
  expect(errors).toEqual([]);
});

import { reportDay, reportInputToISO } from '../lib/api';
import { expect, Page, test } from '@playwright/test';
const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 4 0 R>>endobj\n4 0 obj<</Length 0>>stream\n\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
test('production export signs in, saves exact PDF, tracks responses and analyzes real data', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('Content Security Policy'))
      errors.push(msg.text());
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '☀ Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No applications here yet.' })).toBeVisible();
  await page.getByRole('link', { name: 'CV library', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Synthetic browser CV');
  await page
    .getByLabel('PDF · up to 10 MiB')
    .setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: '↑ Upload PDF' }).click();
  await expect(
    page.getByRole('heading', { name: 'Synthetic browser CV', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'View PDF', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const src = await page.getByTitle('Original CV PDF').getAttribute('src');
  expect(src).toMatch(/^\/api\/v1\/cvs\/.+\/pdf#view=FitH$/);
  const saved = await page.request.get(src!.split('#')[0]);
  expect(saved.status()).toBe(200);
  expect(await saved.body()).toEqual(pdf);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: 'Applications', exact: true }).click();
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page
    .getByRole('textbox', { name: 'Job title', exact: true })
    .fill('Synthetic browser role');
  await page.getByRole('textbox', { name: 'Company', exact: true }).fill('Example organization');
  await page.getByRole('checkbox', { name: 'Already submitted' }).check();
  await page.getByLabel('Exact submitted CV').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save application', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Synthetic browser role', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '+ Add response', exact: true }).click();
  await page.getByRole('combobox', { name: 'Stage', exact: true }).selectOption('Interview');
  await page
    .getByRole('textbox', { name: 'Short summary', exact: true })
    .fill('Synthetic interview invitation');
  await page
    .getByRole('textbox', { name: 'Full response', exact: true })
    .fill('Synthetic response body, for test only.');
  await page.getByRole('button', { name: 'Save response', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('Synthetic interview invitation', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: /Filters/ }).click();
  await page.getByRole('dialog').getByLabel('Interview', { exact: true }).check();
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Synthetic browser role', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Analysis', exact: true }).click();
  await expect(page.getByText('1 of 1 received a reply', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Responses by CV', exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Synthetic browser CV: 100%, 1 replies / 1 applications' }),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Applied during' })).toHaveValue('all');
  await page.screenshot({ path: '../.cache/browser-analysis.png', fullPage: true });
  await page.getByRole('combobox', { name: 'Applied during' }).selectOption('1');
  await page.getByRole('combobox', { name: 'Analysis role type' }).selectOption('Job');
  await expect(
    page.getByRole('button', { name: 'Response rate: 100%. View matching applications' }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Response rate: 100%. View matching applications' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Synthetic browser role', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Analysis date filter' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove role type filter' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove replied filter' }).click();
  await expect(page.getByRole('button', { name: 'Remove replied filter' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove Analysis date filter' }).click();
  await expect(page.getByRole('button', { name: 'Remove Analysis date filter' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove role type filter' }).click();
  await page.getByRole('link', { name: 'Analysis', exact: true }).click();
  await page.getByRole('button', { name: 'View 1 Interview applications' }).click();
  await expect(page.getByRole('button', { name: 'Remove Interview status filter' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Synthetic browser role', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Analysis', exact: true }).click();
  await page.getByRole('button', { name: 'Offers: 0. View matching applications' }).click();
  await expect(page.getByRole('button', { name: 'Remove Offer status filter' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No applications here yet.' })).toBeVisible();
  await page.getByRole('link', { name: 'Analysis', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator('.cv-rate-label').getByRole('button', { name: /Synthetic browser CV/ }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('link', { name: 'CV library', exact: true }).click();
  await expect(page.getByRole('button', { name: '↑ Upload PDF' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => Object.keys(localStorage).every((k) => k === 'trackapplyeasy-theme')),
  ).toBe(true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
});

test('New York date inputs and report days preserve DST boundaries', () => {
  expect(reportDay(new Date('2026-11-08T04:30:00Z'))).toBe('2026-11-07');
  expect(reportInputToISO('2026-03-08T01:59')).toBe('2026-03-08T06:59:00.000Z');
  expect(reportInputToISO('2026-03-08T03:00')).toBe('2026-03-08T07:00:00.000Z');
  expect(() => reportInputToISO('2026-03-08T02:30')).toThrow('does not exist');
  expect(reportInputToISO('2026-11-01T01:30')).toBe('2026-11-01T05:30:00.000Z');
  expect(reportInputToISO('2026-11-01T02:00')).toBe('2026-11-01T07:00:00.000Z');
});

async function openCVLibrary(page: Page) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.getByRole('link', { name: 'CV library', exact: true }).click();
  await expect(page.locator('.collection-heading')).toBeVisible();
}

test('session verification outages recover with Retry without asking an existing user to sign in', async ({
  page,
}) => {
  await openCVLibrary(page);
  let unavailable = true,
    loginRequests = 0,
    sessionRequests = 0;
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === '/auth/login') loginRequests++;
  });
  await page.route('**/api/v1/session', (route) => {
    sessionRequests++;
    return unavailable
      ? route.fulfill({ status: 503, body: 'Sign-in is temporarily unavailable. Please retry.' })
      : route.continue();
  });
  // A fresh document has the cookie but no in-memory Session. A temporary
  // verification failure does not establish that the user has signed out.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'CV library' })).toHaveCount(0);
  unavailable = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'CV library' })).toBeVisible();
  expect(sessionRequests).toBe(2);

  // A later activity check also preserves an already verified in-memory
  // session; only a definitive 401 may return this user to the sign-in panel.
  await page.clock.install();
  await page.clock.fastForward(61000);
  unavailable = true;
  await page.getByRole('button', { name: '☀ Light', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'CV library' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
  unavailable = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  expect(loginRequests).toBe(0);
});

async function fillCVUpload(page: Page, name: string, bytes = pdf) {
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Category', exact: true }).fill('General');
  // Keep every metadata field identical, including lastModified. Only an
  // acknowledged upload ends an intent; a later upload may use different bytes.
  await page.getByLabel('PDF · up to 10 MiB').evaluate(
    (element, contents) => {
      const files = new DataTransfer();
      files.items.add(
        new File([new Uint8Array(contents)], 'synthetic-repeat.pdf', {
          type: 'application/pdf',
          lastModified: 1234567890000,
        }),
      );
      (element as HTMLInputElement).files = files.files;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [...bytes],
  );
}

function uploadKey(body: string | null) {
  const key = body?.match(/name="idempotency_key"\r\n\r\n([^\r\n]+)/)?.[1];
  expect(key).toBeTruthy();
  return key!;
}

async function savedCVs(page: Page, name: string) {
  const res = await page.request.get('/api/v1/cvs');
  expect(res.status()).toBe(200);
  return ((await res.json()) as { id: string; name: string }[])
    .filter((cv) => cv.name === name)
    .map(({ id, name }) => ({ id, name }));
}

test('confirmed same-metadata uploads create distinct immutable PDF versions', async ({ page }) => {
  await openCVLibrary(page);
  const name = 'Synthetic repeated versions',
    keys: string[] = [],
    changed = Buffer.from(pdf.toString().replace('300 300', '301 300'));
  expect(changed.length).toBe(pdf.length);
  await page.route('**/api/v1/cvs', (route) => {
    if (route.request().method() === 'POST') keys.push(uploadKey(route.request().postData()));
    return route.continue();
  });
  for (const [index, bytes] of [pdf, pdf, changed].entries()) {
    await fillCVUpload(page, name, bytes);
    await page.getByRole('button', { name: '↑ Upload PDF' }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(index + 1);
    await expect(page.getByRole('button', { name: '↑ Upload PDF' })).toBeEnabled();
    await expect(page.getByRole('region', { name: 'CV library' }).getByRole('alert')).toHaveCount(
      0,
    );
  }
  expect(new Set(keys).size).toBe(3);
  const versions = await savedCVs(page, name);
  expect(new Set(versions.map((cv) => cv.id)).size).toBe(3);
  const contents = await Promise.all(
    versions.map(async (cv) => {
      const res = await page.request.get(`/api/v1/cvs/${cv.id}/pdf`);
      expect(res.status()).toBe(200);
      return (await res.body()).toString('base64');
    }),
  );
  expect(contents.sort()).toEqual(
    [pdf, pdf, changed].map((bytes) => bytes.toString('base64')).sort(),
  );
});

test('an ambiguous committed upload retries the same intent without duplicating its PDF', async ({
  page,
}) => {
  await openCVLibrary(page);
  const name = 'Synthetic ambiguous upload',
    keys: string[] = [];
  let committedID = '';
  await page.route('**/api/v1/cvs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(uploadKey(route.request().postData()));
    if (!committedID) {
      const res = await route.fetch();
      expect(res.ok()).toBe(true);
      committedID = (await res.json()).id;
      // The real Go API has committed, but the browser never sees its response.
      return route.abort('connectionreset');
    }
    return route.continue();
  });
  await fillCVUpload(page, name);
  await page.getByRole('button', { name: '↑ Upload PDF' }).click();
  await expect(page.getByRole('region', { name: 'CV library' }).getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '↑ Upload PDF' })).toBeEnabled();
  expect(await savedCVs(page, name)).toEqual([{ id: committedID, name }]);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name);
  await page.getByRole('button', { name: '↑ Upload PDF' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '↑ Upload PDF' })).toBeEnabled();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(await savedCVs(page, name)).toEqual([{ id: committedID, name }]);
  const res = await page.request.get(`/api/v1/cvs/${committedID}/pdf`);
  expect(await res.body()).toEqual(pdf);
});

test('confirmed upload stays successful when refreshing the CV list fails', async ({ page }) => {
  await openCVLibrary(page);
  const name = 'Synthetic confirmed upload',
    keys: string[] = [];
  let committed = false;
  await page.route('**/api/v1/cvs', async (route) => {
    if (route.request().method() === 'POST') {
      keys.push(uploadKey(route.request().postData()));
      const res = await route.fetch();
      committed = res.ok();
      return route.fulfill({ response: res });
    }
    if (committed) return route.fulfill({ status: 503, body: 'Synthetic list outage.' });
    return route.continue();
  });
  await fillCVUpload(page, name);
  await page.getByRole('button', { name: '↑ Upload PDF' }).click();
  await expect(page.getByRole('region', { name: 'CV library' }).getByRole('alert')).toHaveText(
    'PDF uploaded successfully. Reload this page to refresh the full CV library.',
  );
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('');
  await expect(page.getByLabel('PDF · up to 10 MiB')).toHaveValue('');
  expect(await savedCVs(page, name)).toHaveLength(1);
  expect(keys).toHaveLength(1);
  await fillCVUpload(page, name);
  await page.getByRole('button', { name: '↑ Upload PDF' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: '↑ Upload PDF' })).toBeEnabled();
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe(keys[1]);
  expect(await savedCVs(page, name)).toHaveLength(2);
});

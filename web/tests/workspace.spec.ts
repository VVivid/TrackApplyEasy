import { reportDay, reportInputToISO } from '../lib/api';
import { expect, Page, test } from '@playwright/test';
import { syntheticPDF as pdf } from './synthetic-pdf';
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
  await page
    .locator('.cv-card')
    .filter({ has: page.getByRole('heading', { name: 'Synthetic browser CV', exact: true }) })
    .getByRole('button', { name: 'View PDF', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('img', { name: 'PDF page 1 of 2' })).toBeVisible();
  const src = await page.getByRole('link', { name: 'Open original PDF' }).getAttribute('href');
  expect(src).toMatch(/^\/api\/v1\/cvs\/.+\/pdf$/);
  const saved = await page.request.get(src!);
  expect(saved.status()).toBe(200);
  expect(await saved.body()).toEqual(pdf);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: 'Applications', exact: true }).click();
  await page.getByRole('button', { name: '+ Add application' }).click();
  await page
    .getByRole('textbox', { name: 'Job title', exact: true })
    .fill('Synthetic browser role');
  await page.getByRole('textbox', { name: 'Company', exact: true }).fill('Example organization');
  await page
    .getByRole('textbox', { name: 'Posting URL', exact: true })
    .fill('https://example.test/synthetic-role');
  await page
    .getByRole('textbox', { name: 'Why this role', exact: true })
    .fill('Synthetic job information and rationale.');
  await page
    .getByRole('textbox', { name: 'Feedback / notes', exact: true })
    .fill('Synthetic saved notes.');
  await page.getByRole('checkbox', { name: 'Already submitted' }).check();
  await page.getByLabel('Exact submitted CV').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save application', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Synthetic browser role', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Synthetic browser role', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('Synthetic job information and rationale.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByText('Synthetic saved notes.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'View original posting' }),
  ).toHaveAttribute('href', 'https://example.test/synthetic-role');
  await expect(page.getByRole('dialog').locator('form')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit application', exact: false }).click();
  await expect(page.getByRole('textbox', { name: 'Job title', exact: true })).toHaveValue(
    'Synthetic browser role',
  );
  await page.getByRole('button', { name: 'Back to details', exact: false }).click();
  await expect(page.getByRole('dialog').locator('form')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Synthetic browser role', exact: true }),
  ).toBeFocused();
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
    changed = Buffer.from(pdf.toString().replace('300 420', '301 420'));
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

test('CV library searches metadata, defaults to active only, and archives and restores exact versions', async ({
  page,
}) => {
  await openCVLibrary(page);
  const name = 'Synthetic archive library';
  await fillCVUpload(page, name);
  await page
    .getByRole('textbox', { name: 'Category', exact: true })
    .fill('Synthetic archive category');
  await page.getByRole('button', { name: '↑ Upload PDF' }).click();
  const card = page
    .locator('.cv-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(card).toBeVisible();
  const before = (await (await page.request.get('/api/v1/cvs')).json()).find(
    (cv: { name: string }) => cv.name === name,
  );
  await expect(page.getByRole('switch', { name: 'Active only', exact: true })).toBeChecked();
  for (const query of [name.toUpperCase(), 'archive category', 'synthetic-repeat.pdf']) {
    await page.getByRole('textbox', { name: 'Search CVs', exact: true }).fill(query);
    await expect(card).toBeVisible();
  }
  await page
    .getByRole('textbox', { name: 'Search CVs', exact: true })
    .fill('No synthetic CV with this metadata');
  await expect(page.getByRole('heading', { name: 'No matching CVs.', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search CVs', exact: true }).fill(name);
  await card.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('switch', { name: 'Active only', exact: true }).uncheck();
  await expect(card.getByText('Archived', { exact: true })).toBeVisible();
  const archived = (await (await page.request.get('/api/v1/cvs')).json()).find(
    (cv: { id: string }) => cv.id === before.id,
  );
  expect(archived).toEqual({ ...before, archived: true, revision: before.revision + 1 });
  expect(await (await page.request.get(`/api/v1/cvs/${before.id}/pdf`)).body()).toEqual(pdf);
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Active only', exact: true })).toBeChecked();
  await expect(card).toHaveCount(0);
  await page.getByRole('switch', { name: 'Active only', exact: true }).uncheck();
  await card.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(card.getByText('Active', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Active only', exact: true }).check();
  await expect(card).toBeVisible();
  const restored = (await (await page.request.get('/api/v1/cvs')).json()).find(
    (cv: { id: string }) => cv.id === before.id,
  );
  expect(restored).toEqual({ ...before, revision: before.revision + 2 });
});

test('an ambiguous archive retries the original intent and read-only users see no archive actions', async ({
  page,
}) => {
  await openCVLibrary(page);
  const name = 'Synthetic archive uncertain';
  await fillCVUpload(page, name);
  await page.getByRole('button', { name: '↑ Upload PDF' }).click();
  const card = page
    .locator('.cv-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  const keys: string[] = [];
  await page.route('**/api/v1/cvs/*/archive', async (route) => {
    keys.push(route.request().postDataJSON().idempotency_key);
    if (keys.length === 1) {
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      return route.abort('connectionreset');
    }
    return route.continue();
  });
  await card.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(card.getByRole('alert')).toBeVisible();
  await card.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.route('**/api/v1/session', async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    return route.fulfill({ response, json: { ...session, scopes: ['trackapplyeasy:read'] } });
  });
  await page.reload();
  await page.getByRole('switch', { name: 'Active only', exact: true }).uncheck();
  await expect(card).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '↑ Upload PDF' })).toHaveCount(0);
});

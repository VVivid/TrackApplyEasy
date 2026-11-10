import { reportDay, reportInputToISO } from '../lib/api';
import { expect, Page, test } from '@playwright/test';
import { syntheticPDF as pdf } from './synthetic-pdf';

// Match desktop browsers where a scrollbar can take up layout space.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

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

test.describe('desktop PDF with classic scrollbars', () => {
  test.use({
    viewport: { width: 1912, height: 966 },
    deviceScaleFactor: 2,
  });

  test('the reading pane stays stable through loading, zoom and resize', async ({ page }) => {
    await openCVLibrary(page);
    const name = 'Synthetic desktop reader';
    await fillCVUpload(page, name);
    await page.getByRole('button', { name: '↑ Upload PDF' }).click();
    const card = page
      .locator('.cv-card')
      .filter({ has: page.getByRole('heading', { name, exact: true }) });
    // Exercise classic scrollbars even when the host uses overlay scrollbars.
    await page.addStyleTag({
      content: '.pdf-viewport::-webkit-scrollbar { width: 15px; height: 15px; }',
    });
    let releasePDF!: () => void;
    const heldPDF = new Promise<void>((resolve) => {
      releasePDF = resolve;
    });
    await page.route('**/api/v1/cvs/*/pdf', async (route) => {
      await heldPDF;
      await route.continue();
    });

    const dialog = page.getByRole('dialog');
    const viewport = dialog.locator('.pdf-viewport');
    const layout = () =>
      viewport.evaluate((pane) => {
        const frame = pane.closest('dialog')!.getBoundingClientRect();
        const bounds = pane.getBoundingClientRect();
        return {
          paneWidth: pane.clientWidth,
          paneHeight: bounds.height,
          gutterAndBorders: bounds.width - pane.clientWidth,
          dialogTop: frame.top,
          dialogHeight: frame.height,
        };
      });
    const paintedPage = () =>
      viewport.evaluate((pane) => {
        const canvas = pane.querySelector('canvas');
        if (!canvas || canvas.hidden) return null;
        const { width, height } = canvas;
        const [red, , blue] = canvas
          .getContext('2d')!
          .getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data;
        return {
          blueCenter: red < 80 && blue > 150,
          withinPixelBudget: width * height <= 4_000_000,
          zoom: canvas.getBoundingClientRect().width / (pane.clientWidth - 2),
        };
      });

    await card.getByRole('button', { name: 'View PDF', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Loading PDF…');
    const loadingLayout = await layout();
    releasePDF();
    await expect(dialog.getByRole('img', { name: 'PDF page 1 of 2' })).toBeVisible();
    expect(await layout()).toEqual(loadingLayout);
    expect(loadingLayout.gutterAndBorders).toBe(17);
    await expect.poll(paintedPage).toMatchObject({ blueCenter: true, zoom: 1 });

    await dialog.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('2');
    const zoomedPage = { blueCenter: true, withinPixelBudget: true, zoom: 2 };
    await expect.poll(paintedPage).toEqual(zoomedPage);
    expect(await layout()).toEqual(loadingLayout);
    await page.setViewportSize({ width: 900, height: 966 });
    expect((await layout()).paneWidth).toBeLessThan(loadingLayout.paneWidth);
    await expect.poll(paintedPage).toEqual(zoomedPage);
  });
});

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

test('imported job details separate source requirements from description and agent notes', async ({
  page,
}) => {
  const title = 'Synthetic scheduling internship',
    duties =
      'Build a calendar service and scheduling tools using TypeScript; stack includes SQLite and RabbitMQ.',
    requirement =
      'Requires relevant master’s enrollment, graduation by October 2029, and prior internship experience developing and launching products.',
    sponsorship = 'Employer states it does not sponsor employment visas for this role.',
    note = 'The scheduling project is a good fit. Ask about the team’s work with calendars.',
    sourceID = 'synthetic-import-024';
  function importedRationale(description: string, agentNote: string) {
    return [
      'Imported from AgentNewsfeed',
      'Source ID: ' + sourceID,
      'Source revision: 2',
      'Saved in AgentNewsfeed: 2026-09-01',
      'Source collection: Synthetic opportunities',
      '',
      'Location: Example City',
      'Workplace: on_site',
      'Employment period: May to August',
      'Employment type: Internship',
      'Compensation: $24 per hour',
      'Tags: Scheduling, Research, Summer',
      '',
      'Source description:',
      description,
      '',
      'Imported agent note:',
      agentNote,
    ].join('\n');
  }
  const rationale = importedRationale(`${duties} ${requirement} ${sponsorship}`, note);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: '☀ Light', exact: true }).click();
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: '+ Add application', exact: true }).click();
  await page.getByRole('textbox', { name: 'Job title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Company', exact: true }).fill('Example Laboratory');
  await page.getByRole('combobox', { name: 'Role type' }).selectOption('Internship');
  await page
    .getByRole('textbox', { name: 'Posting URL', exact: true })
    .fill('https://example.test/synthetic-internship');
  await page.getByRole('textbox', { name: 'Why this role', exact: true }).fill(rationale);
  await page.getByRole('button', { name: 'Save application', exact: true }).click();

  const job = page.getByRole('button', { name: title, exact: true });
  await job.click();
  const dialog = page.getByRole('dialog');
  const description = dialog.getByRole('region', { name: 'Description', exact: true });
  const requirements = dialog.getByRole('region', { name: 'Requirements', exact: true });
  const agentNote = dialog.getByRole('region', { name: 'Agent Note', exact: true });
  await expect(description).toContainText(duties);
  await expect(description).toContainText(sponsorship);
  await expect(description).not.toContainText(requirement);
  await expect(requirements.getByRole('listitem')).toHaveText(requirement);
  await expect(agentNote).toContainText(note);
  await expect(dialog.getByText('On-site', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText([
    'Scheduling',
    'Research',
    'Summer',
  ]);
  await expect(dialog.getByText(sourceID, { exact: true })).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: '../.cache/job-details-light-desktop.png' });
  await dialog.getByText('Source details', { exact: true }).click();
  await expect(dialog.getByText(sourceID, { exact: true })).toBeVisible();
  await expect(dialog.getByText('Imported from AgentNewsfeed', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(job).toBeFocused();

  await page.getByRole('button', { name: '☾ Dark', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await job.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(requirements).toBeVisible();
  await expect(dialog.getByText(sourceID, { exact: true })).toBeHidden();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: '../.cache/job-details-dark-phone.png' });

  const editor = dialog.getByRole('textbox', { name: 'Why this role', exact: true });
  await dialog.getByRole('button', { name: 'Edit application', exact: false }).click();
  await expect(editor).toHaveValue(rationale);
  const ambiguous = 'Requires a portfolio.',
    caveat = 'A course project may substitute.';
  const benefitCondition =
    'Applicants must live in Example City to qualify for the commuter benefit.';
  const markup = '<img src="https://example.test/unsafe" alt="Synthetic markup">';
  const explicitDescription = [
    'Build synthetic dashboards.',
    '',
    'Minimum qualifications:',
    '',
    '- A degree or equivalent experience.',
    '- Availability for the full term.',
    '',
    'Preferred qualifications:',
    'Experience with maps is a plus.',
    '',
    ambiguous,
    '',
    caveat,
    '',
    'Benefits:',
    '',
    benefitCondition,
  ].join('\n');
  const explicitRationale = importedRationale(explicitDescription, markup);
  await editor.fill(explicitRationale);
  await dialog.getByRole('button', { name: 'Save application', exact: true }).click();
  await expect(dialog).toBeHidden();
  await job.click();
  await expect.poll(() => description.locator('p').textContent()).toBe(explicitDescription);
  await expect(requirements).toHaveCount(0);
  await expect(agentNote).toContainText(markup);
  await expect(agentNote.getByRole('img')).toHaveCount(0);

  const mixedSections = [
    'Build synthetic dashboards. Benefits: The office offers a transit subsidy. Requires a local address to qualify for the subsidy.',
    'Build scheduling software.\n\nRequirements: Applicants must complete a course. Benefits: Our office offers a subsidy.',
    'Build scheduling software. Requires a computer; Benefits: Our office offers a subsidy.',
    'Build scheduling software. Requires proof of address for optional commuter benefits.',
    `${duties} ${requirement.slice(0, -1)} to qualify for the relocation subsidy. ${sponsorship}`,
    `The relocation allowance is available only under the following condition. ${requirement} ${sponsorship}`,
    'Requirements:\n- At least one of the following\n  - Coursework\n  - A team project',
    'Benefits:\nWe offer an optional commuter subsidy. The following requirements apply only to the subsidy.\n\nRequirements:\n- Provide proof of address.',
    'Benefits:\n- Optional commuter subsidy.\n\n  Requirements:\n  - Provide proof of address.',
    '## Benefits\n- Optional commuter subsidy.\n\n### Requirements\n- Provide proof of address.',
    'Benefits\n========\n- Optional commuter subsidy.\n\nRequirements:\n- Provide proof of address.',
    'Requirements:\n\n    - Example text',
    '```text\nExample benefit documentation.\n\nRequirements:\n- Provide proof of address.\n\nBenefits:\n- Optional commuter subsidy.\n```',
    '  **Requirements:**\n \n\n  - Provide proof of address.',
    `Benefits:\n  ${markup}\n\nRequirements:\n- Provide proof of address.`,
  ];
  for (const mixedDescription of mixedSections) {
    await dialog.getByRole('button', { name: 'Edit application', exact: false }).click();
    await editor.fill(importedRationale(mixedDescription, note));
    await dialog.getByRole('button', { name: 'Save application', exact: true }).click();
    await expect(dialog).toBeHidden();
    await job.click();
    await expect.poll(() => description.locator('p').textContent()).toBe(mixedDescription);
    await expect(requirements).toHaveCount(0);
  }
  await expect(description.getByRole('img')).toHaveCount(0);
  await expect(description.locator('p')).toHaveCSS('white-space', 'pre-wrap');

  await dialog.getByRole('button', { name: 'Edit application', exact: false }).click();
  const malformed = explicitRationale.replace('Source revision:', 'Unrecognized revision:');
  await editor.fill(malformed);
  await dialog.getByRole('button', { name: 'Save application', exact: true }).click();
  await expect(dialog).toBeHidden();
  await job.click();
  const fallback = dialog.locator('section').filter({
    has: page.getByRole('heading', { name: 'Why this role / job information' }),
  });
  await expect(fallback.locator('p')).toHaveText(malformed);
  await expect(dialog.getByText('Source details', { exact: true })).toHaveCount(0);
});

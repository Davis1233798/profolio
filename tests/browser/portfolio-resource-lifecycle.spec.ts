import { test, expect } from '@playwright/test';

type BrowserResources = {
  pending: number;
  maxPending: number;
  callsByPath: Record<string, number>;
  maxPendingByPath: Record<string, number>;
  webglCreated: number;
  webglLive: number;
  webglMaxLive: number;
  webglLosses: number;
  webglDraws: number;
};

async function instrumentPage(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const state = {
      pending: 0, maxPending: 0, callsByPath: {} as Record<string, number>,
      pendingByPath: {} as Record<string, number>, maxPendingByPath: {} as Record<string, number>,
      webglCreated: 0, webglLive: 0, webglMaxLive: 0, webglLosses: 0, webglDraws: 0,
    };
    (window as any).__portfolioResourceState = state;

    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const pathname = new URL(rawUrl, window.location.href).pathname;
      state.pending++;
      state.maxPending = Math.max(state.maxPending, state.pending);
      state.callsByPath[pathname] = (state.callsByPath[pathname] || 0) + 1;
      state.pendingByPath[pathname] = (state.pendingByPath[pathname] || 0) + 1;
      state.maxPendingByPath[pathname] = Math.max(state.maxPendingByPath[pathname] || 0, state.pendingByPath[pathname]);
      return originalFetch(input, init).finally(() => {
        state.pending--;
        state.pendingByPath[pathname]--;
      });
    }) as typeof window.fetch;

    const contexts = new WeakSet<object>();
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof originalGetContext>) {
      const context = Reflect.apply(originalGetContext, this, args);
      if (String(args[0]).startsWith('webgl') && context && !contexts.has(context)) {
        contexts.add(context);
        state.webglCreated++;
        state.webglLive++;
        state.webglMaxLive = Math.max(state.webglMaxLive, state.webglLive);
        let lost = false;
        this.addEventListener('webglcontextlost', () => {
          if (lost) return;
          lost = true;
          state.webglLosses++;
          state.webglLive--;
        }, { once: true });
        this.addEventListener('webglcontextrestored', () => {
          if (!lost) return;
          lost = false;
          state.webglLive++;
          state.webglMaxLive = Math.max(state.webglMaxLive, state.webglLive);
        });
      }
      return context;
    } as typeof originalGetContext;

    const originalDraw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (this: WebGL2RenderingContext, ...args: Parameters<typeof originalDraw>) {
      state.webglDraws++;
      return Reflect.apply(originalDraw, this, args);
    };
  });
}

async function resourceSnapshot(page: import('@playwright/test').Page): Promise<BrowserResources> {
  return page.evaluate(() => ({ ...(window as any).__portfolioResourceState }));
}

async function cdpSample(session: import('@playwright/test').CDPSession) {
  await session.send('HeapProfiler.collectGarbage');
  const result = await session.send('Performance.getMetrics');
  const metrics = Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
  return {
    jsHeapUsedBytes: Number(metrics.JSHeapUsedSize),
    domNodes: Number(metrics.Nodes),
    eventListeners: Number(metrics.JSEventListeners),
    documents: Number(metrics.Documents),
    frames: Number(metrics.Frames),
  };
}

async function waitForDraw(page: import('@playwright/test').Page, after = 0) {
  await expect.poll(async () => (await resourceSnapshot(page)).webglDraws, { timeout: 15_000 }).toBeGreaterThan(after);
}

test('repeated portfolio interactions keep post-GC browser resources bounded', async ({ page, context }) => {
  test.setTimeout(180_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');
  await instrumentPage(page);
  await page.goto('/');
  // Playwright's scroll-into-view action otherwise inherits the site's smooth
  // scrolling and can wait forever for stability during the repeated workload.
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });

  // Warm route chunks, application state, and the renderer before collecting the baseline.
  await page.getByRole('button', { name: '繁中', exact: true }).click();
  await waitForDraw(page);
  await page.locator('.portfolio-facts a[href="/platform"]').click();
  await expect(page).toHaveURL(/\/platform$/);
  await page.locator('footer a[href="/"]').click();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(1_300);
  const baseline = await cdpSample(cdp);
  expect(baseline.jsHeapUsedBytes).toBeGreaterThan(0);

  const samples = [baseline];
  for (let batch = 0; batch < 6; batch++) {
    for (let cycle = 0; cycle < 6; cycle++) {
      const language = page.locator('.portfolio-language button[lang="zh-TW"]');
      const english = page.locator('.portfolio-language button[lang="en"]');
      await language.click();
      await english.click();

      const previews = page.locator('.project-actions button');
      await expect(previews).toHaveCount(6);
      for (let index = 0; index < 6; index++) {
        const preview = previews.nth(index);
        await preview.scrollIntoViewIfNeeded();
        await preview.click();
        await expect(preview).toHaveAttribute('aria-expanded', 'true');
        await preview.click();
      }

      await page.getByRole('button', { name: 'Sales and service', exact: true }).click();
      await page.getByRole('button', { name: 'All systems', exact: true }).click();
      await page.locator('.portfolio-facts a[href="/platform"]').click();
      await expect(page).toHaveURL(/\/platform$/);
      await page.locator('footer a[href="/"]').click();
      await expect(page).toHaveURL(/\/$/);
    }

    await page.waitForTimeout(1_300); // Let route/language pulses and their short-lived DOM settle.
    const browser = await cdpSample(cdp);
    const app = await resourceSnapshot(page);
    const liveDom = await page.evaluate(() => ({
      iframes: document.querySelectorAll('iframe').length,
      canvases: document.querySelectorAll('canvas').length,
      particleCanvases: document.querySelectorAll('.portfolio-particle-canvas').length,
    }));
    samples.push({ ...browser, ...app, ...liveDom } as typeof samples[number] & BrowserResources & typeof liveDom);
    await test.info().attach(`portfolio-resource-batch-${batch + 1}`, {
      body: JSON.stringify({ batch: batch + 1, sample: samples.at(-1) }, null, 2),
      contentType: 'application/json',
    });

    expect(app.pending).toBe(0);
    expect(liveDom.iframes, 'portfolio routes must not accumulate preview frames').toBe(0);
    expect(liveDom.canvases).toBeLessThanOrEqual(1);
    expect(liveDom.particleCanvases).toBeLessThanOrEqual(1);
    expect(app.webglLive).toBeLessThanOrEqual(1);
    expect(app.webglMaxLive).toBeLessThanOrEqual(1);
    expect(app.pending).toBe(0);
    expect(browser.domNodes).toBeLessThanOrEqual(baseline.domNodes + 150);
    expect(browser.eventListeners).toBeLessThanOrEqual(baseline.eventListeners + 80);
    expect(browser.documents).toBeLessThanOrEqual(3);
    expect(browser.frames).toBeLessThanOrEqual(2);
  }

  // 40 MiB above the warmed baseline leaves room for V8/JIT and route-cache variation.
  const heapAllowance = 40 * 1024 * 1024;
  const heaps = samples.map(sample => sample.jsHeapUsedBytes);
  await test.info().attach('portfolio-resource-lifecycle-cdp-samples', {
    body: JSON.stringify({ baseline, samples, heapAllowanceBytes: heapAllowance }, null, 2),
    contentType: 'application/json',
  });
  expect(Math.max(...heaps) - heaps[0]).toBeLessThan(heapAllowance);

  // Require a meaningful 8 MiB increase across all four final batches, with each
  // step adding at least 1.5 MiB, before classifying the curve as monotonic retention.
  const tail = heaps.slice(-5);
  const tailGrowth = tail[tail.length - 1] - tail[0];
  const monotonicMaterialGrowth = tailGrowth > 8 * 1024 * 1024
    && tail.slice(1).every((value, index) => value - tail[index] > 1.5 * 1024 * 1024);
  expect(monotonicMaterialGrowth, `post-GC heap samples show material monotonic growth: ${JSON.stringify(heaps)}`).toBe(false);
  await cdp.detach();
});

test('a minimized Chromium window and idle pages release WebGL; later pulses still render', async ({ page, context }) => {
  test.setTimeout(60_000);
  const cdp = await context.newCDPSession(page);
  await instrumentPage(page);
  await page.goto('/');
  await page.getByRole('button', { name: '繁中', exact: true }).click();
  await waitForDraw(page);
  expect((await resourceSnapshot(page)).webglLive).toBe(1);

  // Keep another real Chromium window available so minimizing the measured
  // window causes an actual focus/visibility transition under Xvfb/Openbox.
  const foreground = await context.newPage();
  await foreground.goto('about:blank');
  await page.bringToFront();
  const {windowId} = await cdp.send('Browser.getWindowForTarget');
  let hiddenDraws = 0;
  try {
    await cdp.send('Browser.setWindowBounds', {windowId,bounds:{windowState:'minimized'}});
    await expect.poll(async () => (await cdp.send('Browser.getWindowBounds',{windowId})).bounds.windowState).toBe('minimized');
    await foreground.bringToFront();
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
    await expect.poll(() => page.evaluate(() => document.hidden)).toBe(true);
    await expect.poll(async () => (await resourceSnapshot(page)).webglLive).toBe(0);
    hiddenDraws = (await resourceSnapshot(page)).webglDraws;
    await page.waitForTimeout(400);
    expect((await resourceSnapshot(page)).webglDraws).toBe(hiddenDraws);
  } finally {
    await cdp.send('Browser.setWindowBounds', {windowId,bounds:{windowState:'normal'}});
  }
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
  await expect.poll(() => page.evaluate(() => document.hidden)).toBe(false);
  await page.locator('.portfolio-language button[lang="en"]').click();
  await waitForDraw(page, hiddenDraws);
  expect((await resourceSnapshot(page)).webglLive).toBe(1);

  await page.waitForTimeout(10_400);
  await expect.poll(async () => (await resourceSnapshot(page)).webglLive).toBe(0);
  const idle = await resourceSnapshot(page);
  expect(idle.webglMaxLive).toBe(1);
  expect(idle.webglLosses).toBeGreaterThanOrEqual(2);
  await test.info().attach('portfolio-hidden-idle-renderer', { body: JSON.stringify(idle), contentType: 'application/json' });
  await foreground.close();
  await cdp.detach();
});

test('delayed platform status fetch stays singular, settles after navigation, and does not poll', async ({ page }) => {
  await instrumentPage(page);
  let releaseStatus!: () => void;
  const statusGate = new Promise<void>(resolve => { releaseStatus = resolve; });
  await page.route('**/api/platform/control/status', async route => {
    await statusGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ services: [] }) });
  });
  await page.goto('/platform');
  await page.getByLabel('Operations credential').fill('ci-isolated-operator-only-123456789');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  const processingButton = page.getByRole('button', { name: /Processing/ });
  await expect(processingButton).toBeDisabled();
  await expect.poll(async () => (await resourceSnapshot(page)).callsByPath['/api/platform/control/status'] || 0).toBe(1);
  await processingButton.evaluate(button => (button as HTMLButtonElement).click());
  expect((await resourceSnapshot(page)).callsByPath['/api/platform/control/status']).toBe(1);
  expect((await resourceSnapshot(page)).maxPendingByPath['/api/platform/control/status']).toBe(1);

  await page.getByRole('link', { name: /Back to portfolio/ }).click();
  await expect(page).toHaveURL(/\/$/);
  releaseStatus();
  await expect.poll(async () => (await resourceSnapshot(page)).pending).toBe(0);
  await page.waitForTimeout(1_500);
  const settled = await resourceSnapshot(page);
  expect(settled.callsByPath['/api/platform/control/status']).toBe(1);
  expect(settled.maxPendingByPath['/api/platform/control/status']).toBe(1);
  expect(settled.pending).toBe(0);
  await test.info().attach('portfolio-delayed-status-fetch', { body: JSON.stringify(settled), contentType: 'application/json' });
});

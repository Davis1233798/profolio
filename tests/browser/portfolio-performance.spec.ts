import { test, expect } from '@playwright/test';

async function pulseUntilWebGLDraws(page: import('@playwright/test').Page, target: { contexts?: number; draws?: number }) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    // The 4K SwiftShader context can initialize after the 1.15s pulse ends. Keep
    // a pulse live while it warms without coupling the harness to click waits.
    await page.locator('.portfolio-language button[aria-pressed="false"]').evaluate((button: HTMLButtonElement) => button.click());
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => ({
      contexts: Number(document.documentElement.dataset.webglContexts || 0),
      draws: Number(document.documentElement.dataset.webglDraws || 0),
    }));
    if ((target.contexts === undefined || state.contexts >= target.contexts)
      && (target.draws === undefined || state.draws > target.draws)) return state;
  }
  throw new Error(`WebGL did not reach ${JSON.stringify(target)} within 15 seconds`);
}

test('repeated effects reuse their WebGL context and stop drawing at rest', async ({ page }) => {
  await page.addInitScript(() => {
    const contexts = new WeakSet<object>();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      const context = Reflect.apply(getContext, this, args);
      if (String(args[0]).startsWith('webgl') && context && !contexts.has(context)) {
        contexts.add(context); document.documentElement.dataset.webglContexts = String(Number(document.documentElement.dataset.webglContexts || 0) + 1);
        this.addEventListener('webglcontextlost', () => {
          document.documentElement.dataset.webglContextLosses = String(Number(document.documentElement.dataset.webglContextLosses || 0) + 1);
        }, { once: true });
      }
      return context;
    } as typeof getContext;
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (this: WebGL2RenderingContext, ...args: Parameters<typeof draw>) {
      document.documentElement.dataset.webglDraws = String(Number(document.documentElement.dataset.webglDraws || 0) + 1);
      return Reflect.apply(draw, this, args);
    };
  });
  await page.goto('/');
  for (const name of ['繁中', 'EN', '繁中']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect.poll(() => page.evaluate(() => Number(document.documentElement.dataset.webglDraws || 0))).toBeGreaterThan(0);
  }
  await expect(page.locator('.portfolio-particle-canvas')).toHaveAttribute('data-active', 'false');
  const first = await page.evaluate(() => ({ contexts: Number(document.documentElement.dataset.webglContexts || 0), draws: Number(document.documentElement.dataset.webglDraws || 0) }));
  expect(first.contexts).toBe(1);
  await page.waitForTimeout(300); // Observe the settled renderer across an idle interval.
  expect(await page.evaluate(() => Number(document.documentElement.dataset.webglDraws || 0))).toBe(first.draws);
  await test.info().attach('bounded-rendering', { body: JSON.stringify(first), contentType: 'application/json' });
});

test('idle periods release the renderer and a later pulse reinitializes it', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.addInitScript(() => {
    const contexts = new WeakSet<object>();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      const context = Reflect.apply(getContext, this, args);
      if (String(args[0]).startsWith('webgl') && context && !contexts.has(context)) {
        contexts.add(context); document.documentElement.dataset.webglContexts = String(Number(document.documentElement.dataset.webglContexts || 0) + 1);
        this.addEventListener('webglcontextlost', () => {
          document.documentElement.dataset.webglContextLosses = String(Number(document.documentElement.dataset.webglContextLosses || 0) + 1);
        }, { once: true });
      }
      return context;
    } as typeof getContext;
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (this: WebGL2RenderingContext, ...args: Parameters<typeof draw>) {
      document.documentElement.dataset.webglDraws = String(Number(document.documentElement.dataset.webglDraws || 0) + 1);
      return Reflect.apply(draw, this, args);
    };
  });
  await page.goto('/');
  await expect(page.locator('.portfolio-experience')).toHaveAttribute('data-motion', 'full');
  await pulseUntilWebGLDraws(page, { draws: 0 });
  const pixels = await page.locator('.portfolio-particle-canvas').evaluate((element: HTMLCanvasElement) => element.width * element.height);
  expect(pixels).toBeLessThanOrEqual(2_500_000);
  await expect(page.locator('.portfolio-particle-canvas')).toHaveAttribute('data-active', 'false');
  const warmed = await page.evaluate(() => ({
    contexts: Number(document.documentElement.dataset.webglContexts || 0),
    draws: Number(document.documentElement.dataset.webglDraws || 0),
  }));
  expect(warmed.contexts).toBe(1);
  expect(warmed.draws).toBeGreaterThan(0);
  await page.waitForTimeout(10_300); // Idle disposal starts 10 seconds after the short pulse ends.
  await expect.poll(() => page.evaluate(() => Number(document.documentElement.dataset.webglContextLosses || 0))).toBe(1);
  const idle = await page.evaluate(() => ({
    contexts: Number(document.documentElement.dataset.webglContexts || 0),
    draws: Number(document.documentElement.dataset.webglDraws || 0),
  }));
  expect(idle.contexts).toBe(warmed.contexts);
  expect(idle.draws).toBe(warmed.draws);
  const settledDraws = idle.draws;
  await pulseUntilWebGLDraws(page, { contexts: 2, draws: settledDraws });
});

test('a visible pulse draws after a pulse originates below the viewport', async ({ page }) => {
  await page.addInitScript(() => {
    const contexts = new WeakSet<object>();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      const context = Reflect.apply(getContext, this, args);
      if (String(args[0]).startsWith('webgl') && context && !contexts.has(context)) {
        contexts.add(context);
        document.documentElement.dataset.webglContexts = String(Number(document.documentElement.dataset.webglContexts || 0) + 1);
      }
      return context;
    } as typeof getContext;
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (this: WebGL2RenderingContext, ...args: Parameters<typeof draw>) {
      document.documentElement.dataset.webglDraws = String(Number(document.documentElement.dataset.webglDraws || 0) + 1);
      return Reflect.apply(draw, this, args);
    };
  });
  await page.goto('/');
  await expect(page.locator('.portfolio-experience')).toHaveAttribute('data-motion', 'full');
  const offscreenButton = page.locator('.project-spotlight button').first();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const pulseY = await offscreenButton.evaluate(button => button.getBoundingClientRect().top + button.getBoundingClientRect().height / 2);
  expect(pulseY).toBeGreaterThan(viewportHeight);

  const contextDeadline = Date.now() + 15_000;
  while (Date.now() < contextDeadline) {
    await offscreenButton.evaluate((button: HTMLButtonElement) => button.click());
    await page.waitForTimeout(250);
    if (await page.evaluate(() => Number(document.documentElement.dataset.webglContexts || 0)) > 0) break;
  }
  expect(await page.evaluate(() => Number(document.documentElement.dataset.webglContexts || 0))).toBe(1);
  await expect(page.locator('.portfolio-particle-canvas')).toHaveAttribute('data-active', 'false');
  const offscreenDraws = await page.evaluate(() => Number(document.documentElement.dataset.webglDraws || 0));

  await page.locator('.portfolio-language button[aria-pressed="false"]').evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => page.evaluate(() => Number(document.documentElement.dataset.webglDraws || 0)), { timeout: 15_000 }).toBeGreaterThan(offscreenDraws);
  expect(await page.evaluate(() => Number(document.documentElement.dataset.webglContexts || 0))).toBe(1);
});

test('offscreen spotlight cards do not update when the pointer moves', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('heading', { level: 1 }).waitFor();
  const cards = page.locator('.project-spotlight');
  await expect(cards).toHaveCount(6);
  await page.waitForTimeout(200); // Let initial observer notifications settle before measuring pointer work.
  const before = await cards.locator('.spotlight-card__light').evaluateAll(elements => elements.map(element => element.getAttribute('style')));
  await page.mouse.move(20, 30); await page.mouse.move(900, 100); await page.mouse.move(400, 200);
  await page.waitForTimeout(400);
  expect(await cards.locator('.spotlight-card__light').evaluateAll(elements => elements.map(element => element.getAttribute('style')))).toEqual(before);
});

test('page motion never animates a full-page blur', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '繁中', exact: true }).click();
  const frames = await page.locator('.portfolio-experience-content').evaluate(element => element.getAnimations().flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes()));
  expect(frames.every(frame => !frame.filter || frame.filter === 'none')).toBe(true);
});

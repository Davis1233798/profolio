import { test, expect } from '@playwright/test';

test('repeated effects reuse their WebGL context and stop drawing at rest', async ({ page }) => {
  await page.addInitScript(() => {
    const contexts = new WeakSet<object>();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      const context = Reflect.apply(getContext, this, args);
      if (String(args[0]).startsWith('webgl') && context && !contexts.has(context)) {
        contexts.add(context); document.documentElement.dataset.webglContexts = String(Number(document.documentElement.dataset.webglContexts || 0) + 1);
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

test('offscreen spotlight cards do not update when the pointer moves', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('heading', { level: 1 }).waitFor();
  const cards = page.locator('.project-spotlight');
  await expect(cards).toHaveCount(6);
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

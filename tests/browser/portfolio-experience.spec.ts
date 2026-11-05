import { test, expect } from '@playwright/test';

async function warmPortfolioWebGL(page: import('@playwright/test').Page) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await page.locator('.project-spotlight button').first().evaluate((button: HTMLButtonElement) => button.click());
    await page.waitForTimeout(250);
    if (await page.evaluate(() => Number(document.documentElement.dataset.portfolioDraws || 0)) > 0) return;
  }
  throw new Error('WebGL did not draw within 15 seconds of bounded UI pulses');
}

test('workspace tools require a real account and public exports reject demo cookies', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Download JSON backup', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Workspace administration', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/workspace$/);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate key', exact: true })).toHaveCount(0);
  const denied = await page.request.get('/api/workspace/backup', { headers: { cookie: 'demo_user_role=admin; demo_session_id=12345678-1234-4123-8123-123456789abc' } });
  expect([401, 503]).toContain(denied.status());
  expect(denied.headers()['cache-control']).toBe('no-store');
});

test('language changes real copy, persists and survives page navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error' && /THREE|shader|WebGLProgram/i.test(entry.text())) errors.push(entry.text()); });
  await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (this: WebGL2RenderingContext, ...args: Parameters<typeof original>) {
      document.documentElement.dataset.portfolioDraws = String(Number(document.documentElement.dataset.portfolioDraws || 0) + 1);
      return Reflect.apply(original, this, args);
    };
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Make complexity');
  await expect(page.locator('.portfolio-experience')).toHaveAttribute('data-motion', 'full');
  await warmPortfolioWebGL(page);
  await page.getByRole('button', { name: '繁中', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('讓複雜業務');
  await expect(page.getByRole('link', { name: '資料管理後台' })).toBeVisible();
  await expect(page.getByRole('link', { name: '下載 JSON 備份' })).toHaveCount(0);
  expect(await page.evaluate(() => Number(document.documentElement.dataset.portfolioDraws || 0))).toBeGreaterThan(0);
  await page.screenshot({ path: 'outputs/browser/portfolio-language-zh.png', fullPage: false });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
  await page.getByRole('link', { name: '基礎設施中心', exact: true }).click();
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('集中管理');
  await page.getByRole('button', { name: 'EN', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('One place to manage');
  expect(errors).toEqual([]);
});

test('reduced motion keeps language and links usable without WebGL', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.portfolio-experience')).toHaveAttribute('data-motion', 'reduced');
  await page.getByRole('button', { name: '繁中', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('讓複雜業務');
  await expect(page.locator('.portfolio-particle-canvas')).toHaveAttribute('data-active', 'false');
  await page.getByRole('link', { name: '基礎設施中心', exact: true }).click();
  await expect(page).toHaveURL(/\/platform$/);
});

test('WebGL unavailable still gives working language and CSS click feedback', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.startsWith('webgl')) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const wave = node.matches('.portfolio-click-wave') ? node : node.querySelector('.portfolio-click-wave');
        if (wave) document.documentElement.dataset.portfolioFallbackAnimation = getComputedStyle(wave).animationName;
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '繁中', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
  await expect(page.locator('html')).toHaveAttribute('data-portfolio-fallback-animation', 'portfolio-wave');
});

test('mobile language controls remain reachable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '繁中', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await page.locator('.portfolio-hero h1').evaluate(element => element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight))).toBeLessThan(2.5);
  await page.screenshot({ path: 'outputs/browser/portfolio-mobile-zh.png' });
});

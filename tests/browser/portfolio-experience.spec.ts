import { test, expect } from '@playwright/test';

test('language changes real copy, persists and survives page navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error' && /THREE|shader|WebGLProgram/i.test(entry.text())) errors.push(entry.text()); });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Make complexity');
  await page.getByRole('button', { name: '繁中', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('讓複雜業務');
  await expect(page.getByRole('heading', { name: '示範空間資料管理' })).toBeVisible();
  await expect(page.locator('.portfolio-particle-canvas')).toHaveAttribute('data-active', 'true');
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
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type.startsWith('webgl')) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto('/');
  await page.getByRole('button', { name: '繁中', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
  await expect(page.locator('.portfolio-click-wave')).toBeVisible();
});

test('mobile language controls remain reachable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '繁中', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'outputs/browser/portfolio-mobile-zh.png' });
});

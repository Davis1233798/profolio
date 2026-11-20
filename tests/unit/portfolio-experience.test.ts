import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePortfolioLocale,
  readPortfolioLocale,
  savePortfolioLocale,
  normalizePortfolioTheme,
  readPortfolioTheme,
  savePortfolioTheme,
  shouldAnimateInteraction
} from '../../lib/portfolio-experience.ts';

test('locale defaults to English and only accepts supported persisted choices', () => {
  assert.equal(normalizePortfolioLocale(null), 'en');
  assert.equal(normalizePortfolioLocale('zh-TW'), 'zh-TW');
  assert.equal(normalizePortfolioLocale('fr'), 'en');
  assert.equal(readPortfolioLocale({ getItem: () => { throw new Error('blocked'); } }), 'en');
  assert.equal(savePortfolioLocale({ setItem: () => { throw new Error('quota'); } }, 'zh-TW'), false);
});

test('theme supports light and dark modes with persistence', () => {
  assert.equal(normalizePortfolioTheme(null), 'light');
  assert.equal(normalizePortfolioTheme('dark'), 'dark');
  assert.equal(normalizePortfolioTheme('unknown'), 'light');
  assert.equal(readPortfolioTheme({ getItem: () => 'dark' }), 'dark');
  assert.equal(readPortfolioTheme({ getItem: () => null }), 'light');
  assert.equal(readPortfolioTheme({ getItem: () => { throw new Error('blocked'); } }), 'light');
  assert.equal(savePortfolioTheme({ setItem: () => { throw new Error('quota'); } }, 'dark'), false);
});

test('animation respects ordinary activation without changing modified links or data entry', () => {
  assert.equal(shouldAnimateInteraction({ tag: 'A', button: 0 }), true);
  assert.equal(shouldAnimateInteraction({ tag: 'BUTTON', button: 0 }), true);
  for (const input of [
    { tag: 'A', button: 1 }, { tag: 'A', button: 0, metaKey: true },
    { tag: 'A', button: 0, ctrlKey: true }, { tag: 'A', button: 0, download: true },
    { tag: 'BUTTON', button: 0, disabled: true }, { tag: 'INPUT', button: 0 },
    { tag: 'SELECT', button: 0 },
  ]) assert.equal(shouldAnimateInteraction(input), false);
});

test('portfolio translations contain required subsystem keys', async () => {
  const { portfolioChinese } = await import('../../lib/portfolio-translations.ts');
  const required = [
    // MES
    'ForgeFlow', 'Manufacturing', 'New product', 'Receive material lot', 'Create work order',
    // ERP
    'LedgerWorks', 'Operations', 'New inventory item', 'Create purchase order', 'Approve purchase order',
    // POS
    'CounterPoint', 'Retail', 'Products and checkout', 'Shifts and transactions',
    // CRM
    'RelationDesk', 'Customers', 'Performance summary', 'Opportunity board', 'Initial contact',
    // Dining
    'TableCraft', 'Dining', 'Tables and ordering', 'Kitchen KDS', 'Bills and splits',
    // Shop & Commerce
    'MarketLane', 'Commerce', 'Add'
  ];
  for (const key of required) {
    assert.ok(portfolioChinese[key], `Missing translation for key: ${key}`);
    assert.ok(portfolioChinese[key].length > 0, `Empty translation for key: ${key}`);
  }
});

test("station theme and locale logic operates seamlessly", async () => {
  const { currentTheme, setTheme, toggleTheme } = await import("../../web/src/theme.ts");
  const { currentLanguage, setLanguage, tr } = await import("../../web/src/locale.ts");

  assert.equal(typeof currentTheme(), "string");
  assert.equal(typeof currentLanguage(), "string");
  assert.equal(tr("Light mode"), "淺色模式");
  assert.equal(tr("Dark mode"), "深色模式");
  assert.equal(tr("Initial contact"), "初步接觸");
});

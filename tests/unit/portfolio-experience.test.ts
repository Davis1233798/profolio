import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePortfolioLocale, readPortfolioLocale, savePortfolioLocale, shouldAnimateInteraction } from '../../lib/portfolio-experience.ts';

test('locale defaults to English and only accepts supported persisted choices', () => {
  assert.equal(normalizePortfolioLocale(null), 'en');
  assert.equal(normalizePortfolioLocale('zh-TW'), 'zh-TW');
  assert.equal(normalizePortfolioLocale('fr'), 'en');
  assert.equal(readPortfolioLocale({ getItem: () => { throw new Error('blocked'); } }), 'en');
  assert.equal(savePortfolioLocale({ setItem: () => { throw new Error('quota'); } }, 'zh-TW'), false);
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

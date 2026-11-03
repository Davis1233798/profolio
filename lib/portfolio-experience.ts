export type PortfolioLocale = 'en' | 'zh-TW';
export const PORTFOLIO_LOCALE_KEY = 'portfolio.locale';
export function normalizePortfolioLocale(value: unknown): PortfolioLocale { return value === 'zh-TW' ? 'zh-TW' : 'en'; }
export function readPortfolioLocale(storage: Pick<Storage, 'getItem'>): PortfolioLocale {
  try { return normalizePortfolioLocale(storage.getItem(PORTFOLIO_LOCALE_KEY)); } catch { return 'en'; }
}
export function savePortfolioLocale(storage: Pick<Storage, 'setItem'>, locale: PortfolioLocale): boolean {
  try { storage.setItem(PORTFOLIO_LOCALE_KEY, locale); return true; } catch { return false; }
}
export function shouldAnimateInteraction(input: { tag: string; button: number; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; download?: boolean; disabled?: boolean }): boolean {
  return ['A', 'BUTTON', 'SUMMARY'].includes(input.tag) && input.button === 0 && !input.metaKey && !input.ctrlKey && !input.altKey && !input.shiftKey && !input.download && !input.disabled;
}

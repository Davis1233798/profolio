export type PortfolioLocale = 'en' | 'zh-TW';
export const PORTFOLIO_LOCALE_KEY = 'portfolio.locale';
export function normalizePortfolioLocale(value: unknown): PortfolioLocale { return value === 'zh-TW' ? 'zh-TW' : 'en'; }
export function readPortfolioLocale(storage: Pick<Storage, 'getItem'>): PortfolioLocale {
  try {
    const value = storage.getItem(PORTFOLIO_LOCALE_KEY);
    if (value === 'zh-TW' || value === 'en') return value;
    if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
      const lang = navigator.language.toLowerCase();
      if (lang.startsWith('zh')) return 'zh-TW';
    }
    return normalizePortfolioLocale(value);
  } catch {
    return 'en';
  }
}
export function savePortfolioLocale(storage: Pick<Storage, 'setItem'>, locale: PortfolioLocale): boolean {
  try { storage.setItem(PORTFOLIO_LOCALE_KEY, locale); return true; } catch { return false; }
}

export type PortfolioTheme = 'light' | 'dark';
export const PORTFOLIO_THEME_KEY = 'portfolio.theme';
export function normalizePortfolioTheme(value: unknown): PortfolioTheme { return value === 'dark' ? 'dark' : 'light'; }
export function readPortfolioTheme(storage: Pick<Storage, 'getItem'>): PortfolioTheme {
  try {
    const value = storage.getItem(PORTFOLIO_THEME_KEY);
    if (value === 'dark' || value === 'light') return value;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  } catch {
    return 'light';
  }
}
export function savePortfolioTheme(storage: Pick<Storage, 'setItem'>, theme: PortfolioTheme): boolean {
  try { storage.setItem(PORTFOLIO_THEME_KEY, theme); return true; } catch { return false; }
}

export function shouldAnimateInteraction(input: { tag: string; button: number; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; download?: boolean; disabled?: boolean }): boolean {
  return ['A', 'BUTTON', 'SUMMARY'].includes(input.tag) && input.button === 0 && !input.metaKey && !input.ctrlKey && !input.altKey && !input.shiftKey && !input.download && !input.disabled;
}

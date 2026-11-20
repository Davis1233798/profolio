export type Theme = 'light' | 'dark';

export function currentTheme(): Theme {
  try {
    const suiteTheme = localStorage.getItem('suite-theme');
    if (suiteTheme === 'dark' || suiteTheme === 'light') return suiteTheme;
    const portTheme = localStorage.getItem('portfolio.theme');
    if (portTheme === 'dark' || portTheme === 'light') return portTheme;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  } catch {
    return 'light';
  }
}

export function setTheme(theme: Theme) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('suite-theme', theme);
      localStorage.setItem('portfolio.theme', theme);
    }
  } catch {
    /* Storage unavailable */
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.theme = theme;
  }
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function initializeTheme() {
  const theme = currentTheme();
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.theme = theme;
  }
}

"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import { usePathname } from 'next/navigation';
import { Globe2, Sun, Moon } from 'lucide-react';
import {
  readPortfolioLocale,
  savePortfolioLocale,
  readPortfolioTheme,
  savePortfolioTheme,
  shouldAnimateInteraction,
  type PortfolioLocale,
  type PortfolioTheme,
} from '@/lib/portfolio-experience';
import './portfolio-experience.css';
import { portfolioChinese } from '@/lib/portfolio-translations';

interface PortfolioLocaleContext {
  locale: PortfolioLocale;
  theme: PortfolioTheme;
  t: (english: string, chinese?: string) => string;
  setLocale: (locale: PortfolioLocale) => void;
  setTheme: (theme: PortfolioTheme) => void;
  toggleTheme: () => void;
}

const LocaleContext = createContext<PortfolioLocaleContext>({
  locale: 'en',
  theme: 'light',
  t: (english: string, _chinese?: string) => english,
  setLocale: () => {},
  setTheme: () => {},
  toggleTheme: () => {},
});

export const usePortfolioLocale = () => useContext(LocaleContext);
export type ParticlePulse = { id: number; x: number; y: number; kind: 'click' | 'route' | 'language' | 'theme' };

export function PortfolioExperience({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<PortfolioLocale>('en');
  const [theme, setTheme] = useState<PortfolioTheme>('light');
  const [pulse, setPulse] = useState<ParticlePulse | null>(null);
  const [reduced, setReduced] = useState(false);
  const [canvasGeneration, setCanvasGeneration] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const pathname = usePathname();
  const initialized = useRef(false);
  const controller = useRef<{ play(pulse: ParticlePulse): void; stop(): void; dispose(): void } | null>(null);
  const controllerLoading = useRef(false);
  const latestPulse = useRef<ParticlePulse | null>(null);
  const mounted = useRef(true);
  const idleRelease = useRef<number | null>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  latestPulse.current = pulse;

  // Cancel mouse click explosion effect per user request
  const activate = (x: number, y: number, kind: ParticlePulse['kind']) => {
    if (reducedRef.current) return;
    sequence.current += 1;
    setPulse({ id: sequence.current, x, y, kind });
  };

  const isPulseInViewport = (p: ParticlePulse | null) => {
    if (!p) return false;
    if (p.kind === 'click') return false;
    if (typeof window === 'undefined') return true;
    return p.y >= 0 && p.y <= window.innerHeight && p.x >= 0 && p.x <= window.innerWidth;
  };

  useEffect(() => {
    try {
      setLocale(readPortfolioLocale(window.localStorage));
      setTheme(readPortfolioTheme(window.localStorage));
    } catch {
      /* Storage may be disabled. */
    }
    const motionPref = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setReduced(motionPref.matches);
    syncMotion();
    motionPref.addEventListener('change', syncMotion);

    return () => motionPref.removeEventListener('change', syncMotion);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    activate(window.innerWidth / 2, window.innerHeight * 0.35, 'route');
  }, [pathname]);

  useEffect(() => {
    if (reduced) return;
    const animation = content.current?.animate(
      [{ opacity: 0.82, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' }
    );
    return () => animation?.cancel();
  }, [pathname, locale, reduced]);

  useEffect(() => {
    if (idleRelease.current !== null) {
      window.clearTimeout(idleRelease.current);
      idleRelease.current = null;
    }
    if (reduced) {
      if (controller.current) {
        controller.current.dispose();
        controller.current = null;
        setCanvasGeneration(value => value + 1);
      }
      return;
    }
    if (!pulse || !canvas.current) return;
    if (controller.current) {
      controller.current.play(pulse);
      return;
    }
    if (controllerLoading.current) return;
    controllerLoading.current = true;
    const surface = canvas.current;
    import('./portfolio-particles')
      .then(({ createParticleController }) => {
        controllerLoading.current = false;
        if (!mounted.current || reducedRef.current || document.hidden || !surface.isConnected || !latestPulse.current) return;
        controller.current = createParticleController(surface);
        if (latestPulse.current) controller.current.play(latestPulse.current);
      })
      .catch(() => {
        controllerLoading.current = false;
        /* CSS pulse remains available without WebGL. */
      });
  }, [pulse, reduced]);

  useEffect(() => {
    if (pulse || reduced || !controller.current) return;
    idleRelease.current = window.setTimeout(() => {
      idleRelease.current = null;
      controller.current?.dispose();
      controller.current = null;
      setCanvasGeneration(value => value + 1);
    }, 10_000);
    return () => {
      if (idleRelease.current !== null) {
        window.clearTimeout(idleRelease.current);
        idleRelease.current = null;
      }
    };
  }, [pulse, reduced]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (idleRelease.current !== null) window.clearTimeout(idleRelease.current);
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);

  useEffect(() => {
    const releaseWhenHidden = () => {
      if (!document.hidden || !controller.current) return;
      if (idleRelease.current !== null) {
        window.clearTimeout(idleRelease.current);
        idleRelease.current = null;
      }
      controller.current.dispose();
      controller.current = null;
      setPulse(null);
      setCanvasGeneration(value => value + 1);
    };
    document.addEventListener('visibilitychange', releaseWhenHidden);
    return () => document.removeEventListener('visibilitychange', releaseWhenHidden);
  }, []);

  useEffect(() => {
    if (!pulse) return;
    const timeout = window.setTimeout(() => {
      if (latestPulse.current?.id !== pulse.id) return;
      controller.current?.stop();
      setPulse(current => (current?.id === pulse.id ? null : current));
    }, 1150);
    return () => window.clearTimeout(timeout);
  }, [pulse]);

  const toggleTheme = () => {
    const nextTheme: PortfolioTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      savePortfolioTheme(window.localStorage, nextTheme);
    } catch {
      /* Keep in-memory choice. */
    }
  };

  const changeTheme = (nextTheme: PortfolioTheme, target?: HTMLElement | null) => {
    if (nextTheme === theme) return;
    if (target) {
      const rect = target.getBoundingClientRect();
      activate(rect.left + rect.width / 2, rect.top + rect.height / 2, 'theme');
    }
    setTheme(nextTheme);
    try {
      savePortfolioTheme(window.localStorage, nextTheme);
    } catch {
      /* Keep in-memory choice. */
    }
  };

  const changeLocale = (nextLocale: PortfolioLocale, target?: HTMLElement | null) => {
    if (nextLocale === locale) return;
    if (target) {
      const rect = target.getBoundingClientRect();
      activate(rect.left + rect.width / 2, rect.top + rect.height / 2, 'language');
    }
    setLocale(nextLocale);
    try {
      savePortfolioLocale(window.localStorage, nextLocale);
    } catch {
      /* Keep in-memory choice. */
    }
  };

  const context: PortfolioLocaleContext = useMemo(
    () => ({
      locale,
      theme,
      t: (english: string, chinese?: string) =>
        locale === 'zh-TW' ? chinese ?? portfolioChinese[english] ?? english : english,
      setLocale: (next: PortfolioLocale) => changeLocale(next),
      setTheme: (next: PortfolioTheme) => changeTheme(next),
      toggleTheme,
    }),
    [locale, theme]
  );

  const click = (event: MouseEvent<HTMLDivElement>) => {
    const element = event.target instanceof Element ? event.target.closest('a,button,summary,input,select,textarea') : null;
    if (
      !element ||
      element.closest('[data-no-particles]') ||
      !shouldAnimateInteraction({
        tag: element.tagName,
        button: event.button,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        download: element.hasAttribute('download'),
        disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true',
      })
    )
      return;
    const rect = element.getBoundingClientRect();
    activate(event.detail ? event.clientX : rect.left + rect.width / 2, event.detail ? event.clientY : rect.top + rect.height / 2, 'click');
  };

  return (
    <LocaleContext.Provider value={context}>
      <div
        className="portfolio-experience"
        onClickCapture={click}
        data-locale={locale}
        data-theme={theme}
        data-motion={reduced ? 'reduced' : 'full'}
      >
        <div className="portfolio-controls" data-no-particles>
          {/* Theme switcher */}
          <button
            type="button"
            className="portfolio-theme-toggle"
            aria-label={context.t('Toggle color theme', '切換深淺色系')}
            title={theme === 'dark' ? context.t('Theme: Dark', '目前色系：深色模式') : context.t('Theme: Light', '目前色系：淺色模式')}
            onClick={event => {
              const next: PortfolioTheme = theme === 'dark' ? 'light' : 'dark';
              changeTheme(next, event.currentTarget);
            }}
          >
            {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
          </button>

          {/* Language switcher */}
          <nav className="portfolio-language" aria-label={context.t('Language', '語言')}>
            <Globe2 size={15} aria-hidden="true" />
            <button
              type="button"
              lang="en"
              aria-pressed={locale === 'en'}
              onClick={event => changeLocale('en', event.currentTarget)}
            >
              EN
            </button>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              lang="zh-TW"
              aria-pressed={locale === 'zh-TW'}
              onClick={event => changeLocale('zh-TW', event.currentTarget)}
            >
              繁中
            </button>
          </nav>
        </div>

        <div ref={content} className="portfolio-experience-content">
          {children}
        </div>
        <canvas
          key={canvasGeneration}
          ref={canvas}
          className="portfolio-particle-canvas"
          aria-hidden="true"
          data-active={Boolean(pulse && !reduced && isPulseInViewport(pulse))}
        />
        {pulse && !reduced && pulse.kind !== 'click' && (
          <div
            key={pulse.id}
            className={`portfolio-click-wave ${pulse.kind === 'language' ? 'is-language' : pulse.kind === 'theme' ? 'is-theme' : ''}`}
            style={{ left: pulse.x, top: pulse.y }}
            aria-hidden="true"
          />
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {context.t('Language: English', '語言：繁體中文')} · {theme === 'dark' ? '深色模式' : '淺色模式'}
        </span>
      </div>
    </LocaleContext.Provider>
  );
}

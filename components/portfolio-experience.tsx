"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import { usePathname } from 'next/navigation';
import { Globe2 } from 'lucide-react';
import { readPortfolioLocale, savePortfolioLocale, shouldAnimateInteraction, type PortfolioLocale } from '@/lib/portfolio-experience';
import './portfolio-experience.css';
import { portfolioChinese } from '@/lib/portfolio-translations';

const LocaleContext = createContext({ locale: 'en' as PortfolioLocale, t: (english: string, _chinese?: string) => english });
export const usePortfolioLocale = () => useContext(LocaleContext);
export type ParticlePulse = { id: number; x: number; y: number; kind: 'click' | 'route' | 'language' };

export function PortfolioExperience({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<PortfolioLocale>('en');
  const [pulse, setPulse] = useState<ParticlePulse | null>(null);
  const [reduced, setReduced] = useState(true);
  const [canvasGeneration, setCanvasGeneration] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const pathname = usePathname();
  const initialized = useRef(false);
  const controller = useRef<{ play(pulse: ParticlePulse): void; dispose(): void } | null>(null);
  const controllerLoading = useRef(false);
  const latestPulse = useRef<ParticlePulse | null>(null);
  const mounted = useRef(true);
  const idleRelease = useRef<number | null>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  latestPulse.current = pulse;
  const activate = (x: number, y: number, kind: ParticlePulse['kind']) => setPulse({ id: ++sequence.current, x, y, kind });
  useEffect(() => {
    try { setLocale(readPortfolioLocale(window.localStorage)); } catch { /* Storage may be disabled. */ }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(preference.matches);
    sync(); preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    if (!initialized.current) { initialized.current = true; return; }
    activate(window.innerWidth / 2, window.innerHeight * .35, 'route');
  }, [pathname]);
  useEffect(() => {
    if (reduced) return;
    const animation = content.current?.animate([{ opacity: .82, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
    return () => animation?.cancel();
  }, [pathname, locale, reduced]);
  useEffect(() => {
    if (idleRelease.current !== null) { window.clearTimeout(idleRelease.current); idleRelease.current = null; }
    if (reduced) {
      if (controller.current) { controller.current.dispose(); controller.current = null; setCanvasGeneration(value => value + 1); }
      return;
    }
    if (!pulse || !canvas.current) return;
    if (controller.current) { controller.current.play(pulse); return; }
    if (controllerLoading.current) return;
    controllerLoading.current = true;
    const surface = canvas.current;
    import('./portfolio-particles').then(({ createParticleController }) => {
      controllerLoading.current = false;
      if (!mounted.current || reducedRef.current || document.hidden || !surface.isConnected || !latestPulse.current) return;
      controller.current = createParticleController(surface);
      if (latestPulse.current) controller.current.play(latestPulse.current);
    }).catch(() => { controllerLoading.current = false; /* CSS pulse remains available without WebGL. */ });
  }, [pulse, reduced]);
  useEffect(() => {
    if (pulse || reduced || !controller.current) return;
    idleRelease.current = window.setTimeout(() => {
      idleRelease.current = null;
      controller.current?.dispose();
      controller.current = null;
      setCanvasGeneration(value => value + 1);
    }, 10_000);
    return () => { if (idleRelease.current !== null) { window.clearTimeout(idleRelease.current); idleRelease.current = null; } };
  }, [pulse, reduced]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (idleRelease.current !== null) window.clearTimeout(idleRelease.current); controller.current?.dispose(); controller.current = null; }; }, []);
  useEffect(() => {
    const releaseWhenHidden = () => {
      if (!document.hidden || !controller.current) return;
      if (idleRelease.current !== null) { window.clearTimeout(idleRelease.current); idleRelease.current = null; }
      controller.current.dispose(); controller.current = null;
      setPulse(null);
      setCanvasGeneration(value => value + 1);
    };
    document.addEventListener('visibilitychange', releaseWhenHidden);
    return () => document.removeEventListener('visibilitychange', releaseWhenHidden);
  }, []);
  useEffect(() => {
    if (!pulse) return;
    const timeout = window.setTimeout(() => setPulse(current => current?.id === pulse.id ? null : current), 1150);
    return () => window.clearTimeout(timeout);
  }, [pulse]);
  const context = useMemo(() => ({ locale, t: (english: string, chinese?: string) => locale === 'zh-TW' ? chinese ?? portfolioChinese[english] ?? english : english }), [locale]);
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const element = event.target instanceof Element ? event.target.closest('a,button,summary,input,select,textarea') : null;
    if (!element || element.closest('[data-no-particles]') || !shouldAnimateInteraction({ tag: element.tagName, button: event.button, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, download: element.hasAttribute('download'), disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true' })) return;
    const rect = element.getBoundingClientRect();
    activate(event.detail ? event.clientX : rect.left + rect.width / 2, event.detail ? event.clientY : rect.top + rect.height / 2, 'click');
  };
  const changeLanguage = (next: PortfolioLocale, target: HTMLButtonElement) => {
    if (next === locale) return;
    const rect = target.getBoundingClientRect();
    activate(rect.left + rect.width / 2, rect.top + rect.height / 2, 'language');
    setLocale(next);
    try { savePortfolioLocale(window.localStorage, next); } catch { /* Keep in-memory choice. */ }
  };
  return <LocaleContext.Provider value={context}><div className="portfolio-experience" onClickCapture={click} data-locale={locale} data-motion={reduced ? 'reduced' : 'full'}>
    <nav className="portfolio-language" aria-label={context.t('Language', '語言')} data-no-particles>
      <Globe2 size={15} aria-hidden="true"/>
      <button type="button" lang="en" aria-pressed={locale === 'en'} onClick={event => changeLanguage('en', event.currentTarget)}>EN</button>
      <span aria-hidden="true">/</span>
      <button type="button" lang="zh-TW" aria-pressed={locale === 'zh-TW'} onClick={event => changeLanguage('zh-TW', event.currentTarget)}>繁中</button>
    </nav>
    <div ref={content} className="portfolio-experience-content">{children}</div>
    <canvas key={canvasGeneration} ref={canvas} className="portfolio-particle-canvas" aria-hidden="true" data-active={Boolean(pulse && !reduced)}/>
    {pulse && !reduced && <div key={pulse.id} className={`portfolio-click-wave ${pulse.kind === 'language' ? 'is-language' : ''}`} style={{ left: pulse.x, top: pulse.y }} aria-hidden="true"/>}
    <span className="sr-only" role="status" aria-live="polite">{context.t('Language: English', '語言：繁體中文')}</span>
  </div></LocaleContext.Provider>;
}

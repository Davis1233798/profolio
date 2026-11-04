"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PortfolioExperience, usePortfolioLocale } from './portfolio-experience';

export function SuiteFrame({ children }: { children: ReactNode }) {
  return <PortfolioExperience><SuiteFrameContent>{children}</SuiteFrameContent></PortfolioExperience>;
}

function SuiteFrameContent({ children }: { children: ReactNode }) {
  const { t } = usePortfolioLocale();
  const pathname = usePathname();
  const site = pathname.split("/")[1] || "portfolio";
  return <div data-suite-theme={site} className="suite-frame">
    <a href="#suite-content" className="suite-skip">{t('Skip to main content', '跳至主要內容')}</a>
    <div id="suite-content" className="suite-content" tabIndex={-1}>{children}</div>
    <footer className="suite-footer"><span>Business Suite <span aria-hidden="true">/</span> {t('Interactive portfolio', '互動作品集')}</span><span>{t('Demo data', '示範資料')} · TWD · Asia/Taipei</span></footer>
  </div>;
}

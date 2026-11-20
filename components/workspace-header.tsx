"use client";

import { ArrowUpRight, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { usePortfolioLocale } from "./portfolio-experience";

export function WorkspaceHeader({ brand, eyebrow, title, description, onRefresh, busy, children }: {
  brand: string; eyebrow: string; title: string; description: string;
  onRefresh?: () => void; busy?: boolean; children?: ReactNode;
}) {
  const { t } = usePortfolioLocale();
  return <header className="workspace-header">
    <div className="workspace-heading">
      <p className="workspace-eyebrow">{t(brand)} <span>/</span> {t(eyebrow)}</p>
      <h1>{t(title)}</h1>
      <p className="workspace-description">{t(description)}</p>
    </div>
    <div className="workspace-actions">
      {children}
      {onRefresh && (
        <button type="button" onClick={onRefresh} disabled={busy} className="workspace-secondary">
          <RotateCcw size={15} className={busy ? "animate-spin" : undefined}/>
          {busy ? t("Refreshing…", "更新中…") : t("Refresh data", "重新整理資料")}
        </button>
      )}
    </div>
  </header>;
}

export function WorkspaceLinks({ links }: { links: { href: string; label: string }[] }) {
  const { t } = usePortfolioLocale();
  return (
    <nav className="workspace-links" aria-label={t("Page workspace", "工作區分頁")}>
      {links.map(link => (
        <a key={link.href} href={link.href}>
          {t(link.label)}
          <ArrowUpRight size={13}/>
        </a>
      ))}
    </nav>
  );
}

export function WorkspaceLoading({ name, error, onRetry }: { name: string; error?: string | null; onRetry: () => void }) {
  const { t } = usePortfolioLocale();
  return (
    <main className="suite-page">
      <WorkspaceHeader
        brand={name}
        eyebrow="WORKSPACE"
        title={error ? "Workspace temporarily unavailable" : "Preparing your workspace"}
        description={error || "Loading this demo workspace. Please wait."}
      />
      <section className="workspace-loading" aria-busy={!error}>
        {error ? (
          <div role="alert">
            <p>{t(error)}</p>
            <button type="button" onClick={onRetry} className="workspace-secondary">
              {t("Reload", "重新載入")}
            </button>
          </div>
        ) : (
          <>
            <p role="status">{t(`Loading ${name}…`, `正在載入 ${t(name)}…`)}</p>
            <div className="loading-grid" aria-hidden="true">
              {[1, 2, 3].map(n => (
                <div key={n} className="loading-block" />
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

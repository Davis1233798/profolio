"use client";
import { useState } from "react";
import { usePortfolioLocale } from "@/components/portfolio-experience";
export function WorkspaceTools() {
  const { t } = usePortfolioLocale();
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [table, setTable] = useState("pos_sales");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const restore = async () => {
    if (!file || !confirmed) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (file.size > 5_000_000) throw new Error(t("Backup files must be 5 MB or less"));
      const response = await fetch("/api/workspace/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.text() });
      const json: any = await response.json();
      if (!json.success) throw new Error(json.error?.message || t("Restore failed"));
      setMessage(t(`Restored: ${json.data.restoredTables} tables, ${json.data.restoredRows} records. Refresh any open workspace.`, `已還原 ${json.data.restoredTables} 張資料表、${json.data.restoredRows} 筆紀錄。請重新整理已開啟的系統。`));
      setConfirmed(false);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
    <h2 className="text-lg font-bold text-stone-900">{t("Demo workspace data")}</h2>
    <p className="text-sm text-stone-600">{t("Initial records are fictional demo data. Exports include the current workspace and subsequent changes. Existing workspaces are not automatically reseeded.")}</p>
    <p className="text-sm text-stone-500">{t("Download a workspace snapshot. Backups can only be restored to the current workspace; roles and audit records are preserved. Restoring clears transaction retry caches.")}</p>
    <div className="flex flex-wrap items-center gap-3"><a className="rounded-lg bg-primary px-4 py-2 text-sm text-white" href="/api/workspace/backup" download>{t("Download JSON backup")}</a><label className="text-sm">{t("CSV dataset")} <select className="rounded-lg border p-2" value={table} onChange={event => setTable(event.target.value)}>{[["pos_sales", "POS sales"], ["pos_refunds", "POS refunds"], ["erp_stock_ledger", "ERP stock ledger"], ["erp_invoices", "ERP invoices"], ["erp_journal_lines", "ERP journal lines"], ["mes_production_reports", "MES production reports"], ["crm_opportunities", "CRM opportunities"], ["dining_orders", "Dining orders"], ["shop_orders", "Commerce orders"]].map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><a className="rounded-lg border px-4 py-2 text-sm" href={`/api/workspace/export?table=${table}`} download>{t("Export CSV")}</a></div>
    <details className="rounded-lg border border-stone-200 p-4"><summary className="cursor-pointer text-sm font-semibold">{t("Restore backup (demo administrator)")}</summary><div className="mt-4 space-y-3"><label className="block text-sm">{t("Choose a JSON backup for this workspace (up to 5 MB)")}<input type="file" accept="application/json,.json" className="mt-2 block w-full text-xs" onChange={event => { setFile(event.target.files?.[0] || null); setConfirmed(false); }} /></label><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>{t("I understand that this replaces all business data in the current workspace.")}</span></label><button disabled={busy || !file || !confirmed} onClick={restore} className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? t("Validating and restoring…") : t("Restore backup")}</button></div></details>
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}

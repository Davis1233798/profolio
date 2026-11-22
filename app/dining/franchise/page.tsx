"use client";

import { useEffect, useState } from "react";
import { DiningRoleNav } from "../role-nav";
import { DiningFranchise } from "../dining-franchise";
import { WorkspaceHeader } from "@/components/workspace-header";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import { Building2 } from "lucide-react";

type Data = {
  tables: any[];
  sessions: any[];
  menuItems: any[];
  orders: any[];
  orderItems: any[];
  kdsTickets: any[];
  locations: { name: string; serviceFeeRate: number }[];
  bills: any[];
};

type Envelope<T> = { success: boolean; data: T; error?: { message: string }; request_id?: string };

export default function FranchisePage() {
  const { t } = usePortfolioLocale();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/dining/data", { cache: "no-store" });
      const json = (await response.json()) as Envelope<Data>;
      if (!response.ok || !json.success) throw new Error(json.error?.message || t("Unable to load data", "無法載入資料"));
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Connection failed. Please retry.", "連線失敗，請重試。"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.title = "TableCraft · 連鎖門市加盟主 (門市損益與央廚叫貨)";
    void load();
  }, []);

  const totalRevenue = data?.bills
    ? data.bills.filter(b => b.status === "settled" || b.status === "closed").reduce((sum, b) => sum + (b.paidAmount || b.finalAmount || 0), 0)
    : 1680000;

  return (
    <main data-site="dining" data-role="franchise" className="suite-page suite-dining space-y-6">
      <WorkspaceHeader
        brand="TableCraft"
        eyebrow="Dining operations / FRANCHISE HUB"
        title="TableCraft 智慧餐飲 · 加盟連鎖門市投資主入口"
        description="連鎖加盟多門市營收分潤對帳、總部央廚原物料低溫叫貨、食品安全與 QSC 評鑑稽核。"
        onRefresh={() => void load()}
        busy={busy || loading}
      >
        <span className="dining-service-tag inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold">
          <Building2 size={14} />
          <span>獨立分頁 · 加盟連鎖門市主系統</span>
        </span>
      </WorkspaceHeader>

      <DiningRoleNav currentRole="franchise" />

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-800 dark:text-red-300">
          <span className="break-all">{error}</span>
          <button className="underline font-bold" onClick={() => void load()}>
            {t("Retry loading", "重試載入")}
          </button>
        </div>
      )}

      <DiningFranchise
        currentStoreRevenue={totalRevenue}
        onRefresh={() => void load()}
      />
    </main>
  );
}

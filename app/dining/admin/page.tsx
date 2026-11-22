"use client";

import { useEffect, useState } from "react";
import { DiningRoleNav } from "../role-nav";
import { DiningManager } from "../dining-manager";
import { WorkspaceHeader } from "@/components/workspace-header";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import { LayoutDashboard } from "lucide-react";

type Data = {
  tables: any[];
  sessions: any[];
  menuItems: any[];
  modifierGroups: any[];
  modifierOptions: any[];
  orders: any[];
  orderItems: any[];
  kdsTickets: any[];
  locations: { name: string; serviceFeeRate: number }[];
  bills: any[];
};

type Envelope<T> = { success: boolean; data: T; error?: { message: string }; request_id?: string };

export default function AdminPage() {
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
    document.title = "TableCraft · 店長管理 (營收KPI與菜單定價)";
    void load();
  }, []);

  return (
    <main data-site="dining" data-role="admin" className="suite-page suite-dining space-y-6">
      <WorkspaceHeader
        brand="TableCraft"
        eyebrow="Dining operations / MANAGER CONSOLE"
        title="TableCraft 智慧餐飲 · 餐廳店長營運中心"
        description="全店即時營收 KPI、菜單目錄定價管理、出餐 SLA 監控與外場翻桌率分析。"
        onRefresh={() => void load()}
        busy={busy || loading}
      >
        <span className="dining-service-tag inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 text-xs font-bold">
          <LayoutDashboard size={14} />
          <span>獨立分頁 · 店長管理者營運中心</span>
        </span>
      </WorkspaceHeader>

      <DiningRoleNav currentRole="admin" />

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-800 dark:text-red-300">
          <span className="break-all">{error}</span>
          <button className="underline font-bold" onClick={() => void load()}>
            {t("Retry loading", "重試載入")}
          </button>
        </div>
      )}

      {data && (
        <DiningManager
          menuItems={data.menuItems || []}
          modifierGroups={data.modifierGroups || []}
          modifierOptions={data.modifierOptions || []}
          orders={data.orders || []}
          orderItems={data.orderItems || []}
          kdsTickets={data.kdsTickets || []}
          bills={data.bills || []}
          tablesCount={data.tables?.length || 0}
          activeSessionsCount={data.sessions?.filter(s => s.status === "active").length || 0}
          sessions={data.sessions || []}
          tables={data.tables || []}
          onRefresh={() => void load()}
        />
      )}
    </main>
  );
}

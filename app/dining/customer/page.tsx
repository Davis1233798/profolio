"use client";

import { useEffect, useState } from "react";
import { DiningRoleNav } from "../role-nav";
import { CustomerOrdering } from "../customer-ordering";
import { WorkspaceHeader } from "@/components/workspace-header";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import { Smartphone, UtensilsCrossed } from "lucide-react";

type Table = { id: string; tableNumber: string; capacity: number; status: string };
type Session = { id: string; tableId: string; sessionToken: string; guestCount: number; status: string };
type Menu = { id: string; name: string; category: string; price: number; isSoldOut: boolean };
type ModifierGroup = { id: string; name: string; isRequired: boolean; maxSelection: number };
type Modifier = { id: string; groupId: string; name: string; additionalPrice: number };
type Order = { id: string; sessionId: string | null; orderType: string; takeoutNumber: string | null; totalAmount: number; status: string };
type OrderItem = { id: string; orderId: string; itemName: string; quantity: number; lineTotal: number; status: string };
type Ticket = { id: string; orderId: string; orderItemId: string; station: string; itemName: string; quantity: number; modifiersText: string; status: string; urgentFlag: boolean };
type Data = {
  tables: Table[];
  sessions: Session[];
  menuItems: Menu[];
  modifierGroups: ModifierGroup[];
  modifierOptions: Modifier[];
  orders: Order[];
  orderItems: OrderItem[];
  kdsTickets: Ticket[];
  locations: { name: string; serviceFeeRate: number }[];
  bills: { id: string; orderId: string | null; finalAmount: number; paidAmount: number; status: string }[];
};

type Envelope<T> = { success: boolean; data: T; error?: { message: string }; request_id?: string };

export default function CustomerPage() {
  const { t } = usePortfolioLocale();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tableId, setTableId] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/dining/data", { cache: "no-store" });
      const json = (await response.json()) as Envelope<Data>;
      if (!response.ok || !json.success) throw new Error(json.error?.message || t("Unable to load data", "無法載入資料"));
      setData(json.data);
      setTableId(current => current || json.data.sessions.find(s => s.status === "active")?.tableId || json.data.tables[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Connection failed. Please retry.", "連線失敗，請重試。"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.title = "TableCraft · 顧客點餐 (用戶端 RWA/PWA)";
    void load();
  }, []);

  async function mutate(path: string, body: unknown, message: string, onSuccess?: () => void) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/dining/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as Envelope<unknown>;
      if (!response.ok || !json.success) {
        throw new Error(`${json.error?.message || t("Operation failed", "操作失敗")}${json.request_id ? ` (trace ID ${json.request_id})` : ""}`);
      }
      setNotice(message);
      onSuccess?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Connection failed. Please retry.", "連線失敗，請重試。"));
    } finally {
      setBusy(false);
    }
  }

  const table = data?.tables.find(t => t.id === tableId);
  const session = data?.sessions.find(s => s.tableId === tableId && s.status === "active");
  const rate = data?.locations[0]?.serviceFeeRate ?? 10;

  return (
    <main data-site="dining" data-role="customer" className="suite-page suite-dining space-y-6">
      <WorkspaceHeader
        brand="TableCraft"
        eyebrow="Dining operations / CUSTOMER APP"
        title="TableCraft 智慧餐飲 · 顧客自選點餐 (RWA/PWA)"
        description="手機掃碼點餐、尊榮會員卡面、專屬優惠券匣、即時出餐追蹤與促銷優惠推播。"
        onRefresh={() => void load()}
        busy={busy || loading}
      >
        <span className="dining-service-tag inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs font-bold">
          <Smartphone size={14} />
          <span>獨立分頁 · 顧客端 RWA/PWA</span>
        </span>
      </WorkspaceHeader>

      <DiningRoleNav currentRole="customer" />

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-800 dark:text-red-300">
          <span className="break-all">{error}</span>
          <button className="underline font-bold" onClick={() => void load()}>
            {t("Retry loading", "重試載入")}
          </button>
        </div>
      )}

      {notice && (
        <div role="status" className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm text-emerald-800 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {data && (
        <CustomerOrdering
          table={table}
          session={session}
          menuItems={data.menuItems}
          modifierGroups={data.modifierGroups}
          modifierOptions={data.modifierOptions}
          orders={data.orders}
          orderItems={data.orderItems}
          kdsTickets={data.kdsTickets}
          serviceFeeRate={rate}
          tables={data.tables}
          onSelectTable={(id: string) => setTableId(id)}
          onOrderPlaced={() => void load()}
          onUrge={(ticketId: string) => mutate("ticket/urge", { ticketId }, t("Kitchen reminded", "已催單通知廚房"))}
          onOpenSession={(id: string, guests: number) =>
            mutate("session", { tableId: id, guestCount: guests }, t("Table opened", "已開桌"))
          }
          busy={busy}
        />
      )}
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CustomerOrdering } from "../customer-ordering";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import { ArrowLeft } from "lucide-react";

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
    <main data-site="dining" data-role="customer" className="min-h-screen pb-16">
      {/* Discreet floating return link for reviewers */}
      <div className="fixed bottom-4 right-4 z-50">
        <Link
          href="/#work"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-stone-900/90 dark:bg-stone-100/90 hover:bg-stone-900 dark:hover:bg-white text-white dark:text-stone-900 px-3.5 py-2 text-xs font-bold shadow-xl backdrop-blur-md transition cursor-pointer"
        >
          <ArrowLeft size={13} />
          <span>返回作品集 ↗</span>
        </Link>
      </div>

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

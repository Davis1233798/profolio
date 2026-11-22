"use client";

import { useEffect, useState } from "react";
import { DiningRoleNav } from "../role-nav";
import { WorkspaceHeader } from "@/components/workspace-header";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import { ChefHat, Receipt, Trash2, RefreshCw } from "lucide-react";

type Table = { id: string; tableNumber: string; capacity: number; status: string };
type Session = { id: string; tableId: string; sessionToken: string; guestCount: number; status: string };
type Menu = { id: string; name: string; category: string; price: number; isSoldOut: boolean };
type Order = { id: string; sessionId: string | null; orderType: string; takeoutNumber: string | null; totalAmount: number; status: string };
type OrderItem = { id: string; orderId: string; itemName: string; quantity: number; lineTotal: number; status: string };
type Ticket = { id: string; orderId: string; orderItemId: string; station: string; itemName: string; quantity: number; modifiersText: string; status: string; urgentFlag: boolean };
type Data = {
  tables: Table[];
  sessions: Session[];
  menuItems: Menu[];
  orders: Order[];
  orderItems: OrderItem[];
  kdsTickets: Ticket[];
  locations: { name: string; serviceFeeRate: number }[];
  bills: { id: string; orderId: string | null; finalAmount: number; paidAmount: number; status: string }[];
};
type Envelope<T> = { success: boolean; data: T; error?: { message: string }; request_id?: string };

const money = (n: number) =>
  new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(n);
const button =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
const field =
  "w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary";
const next: Record<string, "cooking" | "done" | "served"> = { received: "cooking", cooking: "done", done: "served" };

export default function BackOfficePage() {
  const { t } = usePortfolioLocale();
  const statuses: Record<string, string> = {
    received: "待製作",
    cooking: "製作中",
    done: "已出餐",
    served: "已送餐",
    pending: "待製作",
    preparing: "製作中",
    ready: "已出餐",
    cancelled: "已退菜",
  };

  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [backSubtab, setBackSubtab] = useState<"kitchen" | "billing">("kitchen");
  const [station, setStation] = useState("All");
  const [tableId, setTableId] = useState("");
  const [splitCount, setSplitCount] = useState(1);
  const [method, setMethod] = useState("cash");
  const [reason, setReason] = useState("");

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
    document.title = "TableCraft · 後台廚房 (KDS備餐與結帳)";
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
  const orderIds = new Set(data?.orders.filter(o => o.sessionId === session?.id).map(o => o.id));
  const items = data?.orderItems.filter(i => orderIds.has(i.orderId)) || [];
  const subtotal = items.filter(i => i.status !== "cancelled").reduce((sum, i) => sum + i.lineTotal, 0);
  const rate = data?.locations[0]?.serviceFeeRate ?? 10;
  const fee = Math.round((subtotal * rate) / 100);
  const total = subtotal + fee;
  const splits = Array.from({ length: splitCount }, (_, index) => ({
    number: index + 1,
    amount: Math.floor(total / splitCount) + (index === 0 ? total % splitCount : 0),
  }));

  return (
    <main data-site="dining" data-role="back" className="suite-page suite-dining space-y-6">
      <WorkspaceHeader
        brand="TableCraft"
        eyebrow="Dining operations / BACK OF HOUSE"
        title="TableCraft 智慧餐飲 · 後台廚房出餐與結帳"
        description="KDS 站點即時出餐、急單優先處理、帳單分拆與結帳核銷。"
        onRefresh={() => void load()}
        busy={busy || loading}
      >
        <span className="dining-service-tag inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-xs font-bold">
          <ChefHat size={14} />
          <span>獨立分頁 · 內場廚房與結帳</span>
        </span>
      </WorkspaceHeader>

      <DiningRoleNav currentRole="back" />

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
        <>
          {/* Sub Navigation within Back office */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 dark:border-stone-800 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBackSubtab("kitchen")}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  backSubtab === "kitchen"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
              >
                <ChefHat size={14} />
                <span>KDS 廚房出餐看板</span>
              </button>
              <button
                type="button"
                onClick={() => setBackSubtab("billing")}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  backSubtab === "billing"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
              >
                <Receipt size={14} />
                <span>帳單結算與拆單核銷</span>
              </button>
            </div>
            <span className="text-xs text-amber-800 dark:text-amber-300 font-semibold bg-amber-50 dark:bg-amber-950/50 px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-800">
              👨‍🍳 內場後台工作區 · 站點即時出餐、急單提醒與結帳清桌
            </span>
          </div>

          {backSubtab === "kitchen" && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="station" className="text-sm font-bold text-stone-900 dark:text-stone-100">
                  廚房工作站篩選：
                </label>
                <select
                  id="station"
                  value={station}
                  onChange={e => setStation(e.target.value)}
                  className={`${field} max-w-56`}
                >
                  {["All", ...new Set(data.kdsTickets.map(t => t.station))].map(s => (
                    <option key={s} value={s} className="dark:bg-stone-900 dark:text-stone-100">
                      {s === "All" ? "全部工作站" : s}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  待製作 ➔ 製作中 ➔ 已出餐 ➔ 已送餐。狀態即時同步帳單明細。
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {data.kdsTickets
                  .filter(t => t.status !== "served" && (station === "All" || t.station === station))
                  .map(ticket => {
                    const order = data.orders.find(o => o.id === ticket.orderId);
                    const sess = data.sessions.find(s => s.id === order?.sessionId);
                    const tableName =
                      order?.orderType === "takeout"
                        ? `外帶 ${order.takeoutNumber}`
                        : data.tables.find(t => t.id === sess?.tableId)?.tableNumber;
                    return (
                      <article
                        key={ticket.id}
                        className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-base text-stone-900 dark:text-stone-100">
                            {order?.orderType === "takeout" ? tableName : `${tableName || "—"} 桌`}
                          </span>
                          <span className="rounded-full bg-orange-50 dark:bg-orange-950/60 px-2.5 py-1 text-xs font-bold text-orange-800 dark:text-orange-300">
                            {statuses[ticket.status]}
                          </span>
                        </div>

                        {ticket.urgentFlag && (
                          <p role="status" className="mt-3 rounded-lg bg-red-50 dark:bg-red-950/50 p-2 text-xs font-bold text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                            ⚡ 外場或顧客已送出催單請求 (Priority)
                          </p>
                        )}

                        <h4 className="mt-4 text-base font-bold text-stone-900 dark:text-stone-100">
                          {ticket.itemName} × {ticket.quantity}
                        </h4>

                        <p className="mt-1 min-h-5 text-xs text-stone-500 dark:text-stone-400">
                          {ticket.modifiersText || "無特殊規格備註"}
                        </p>

                        <p className="my-3 text-xs font-medium text-stone-400 dark:text-stone-500">
                          工作站: {ticket.station}
                        </p>

                        <div className="space-y-2 mt-4">
                          <button
                            disabled={busy || ticket.urgentFlag}
                            onClick={() =>
                              void mutate("kds/urge", { ticketId: ticket.id }, "催單通知已送達廚房看板！")
                            }
                            className={`${button} w-full border border-orange-300 dark:border-orange-800 text-orange-800 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/40`}
                          >
                            {ticket.urgentFlag ? "已設為急單" : "標記為急單 (Urgent)"}
                          </button>

                          <button
                            disabled={busy || !next[ticket.status]}
                            onClick={() =>
                              void mutate(
                                "kds/status",
                                { ticketId: ticket.id, newStatus: next[ticket.status] },
                                "出餐狀態已更新！"
                              )
                            }
                            className={`${button} w-full bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-xs`}
                          >
                            {ticket.status === "received"
                              ? "開始備料製作"
                              : ticket.status === "cooking"
                              ? "主廚完成出餐"
                              : "送達餐桌"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
              </div>

              {!data.kdsTickets.some(
                t => t.status !== "served" && (station === "All" || t.station === station)
              ) && (
                <p className="rounded-xl border border-dashed border-stone-200 dark:border-stone-800 p-10 text-center text-sm text-stone-400">
                  目前無待出餐項目，廚房工作看板已清空！
                </p>
              )}
            </section>
          )}

          {backSubtab === "billing" && (
            <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
              {/* Order items detail */}
              <div className="space-y-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs">
                <div className="flex items-center justify-between border-b border-stone-100 dark:border-stone-800 pb-3">
                  <h3 className="text-lg font-bold text-stone-900 dark:text-stone-100">
                    {table?.tableNumber} 桌 · 帳單明細與退菜核銷
                  </h3>
                  <select
                    value={tableId}
                    onChange={e => setTableId(e.target.value)}
                    className={`${field} max-w-44`}
                  >
                    {data.tables.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.tableNumber} 桌
                      </option>
                    ))}
                  </select>
                </div>

                {!session ? (
                  <p className="py-8 text-center text-sm text-stone-400">此桌尚無用餐中的活躍帳單。</p>
                ) : !items.length ? (
                  <p className="py-8 text-center text-sm text-stone-400">尚未點購任何餐點。</p>
                ) : (
                  items.map(i => (
                    <div
                      key={i.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 dark:border-stone-800 py-3"
                    >
                      <div>
                        <p className={`text-sm font-bold ${i.status === "cancelled" ? "line-through text-stone-400" : "text-stone-900 dark:text-stone-100"}`}>
                          {i.itemName} × {i.quantity}
                        </p>
                        <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                          狀態: {statuses[i.status] || i.status}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono font-bold text-stone-900 dark:text-stone-100">
                          {money(i.status === "cancelled" ? 0 : i.lineTotal)}
                        </span>
                        {i.status !== "cancelled" && (
                          <button
                            disabled={busy || !reason.trim()}
                            onClick={() =>
                              void mutate("cancel", { orderItemId: i.id, reason }, "餐點已退菜，帳單已重新計算。")
                            }
                            title="填寫下方退菜原因後點擊"
                            className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-30"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}

                <label className="block text-xs font-semibold text-stone-600 dark:text-stone-400 mt-4">
                  退菜原因 (若需退菜請先輸入):
                  <input
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="例如：客人改單、出餐超時、過敏食材等"
                    className={`${field} mt-1`}
                  />
                </label>
              </div>

              {/* Settlement sidebar */}
              <aside className="h-fit space-y-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs">
                <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">結帳與帳單分拆</h3>

                <div className="space-y-1.5 border-b border-stone-100 dark:border-stone-800 pb-3 text-xs">
                  <div className="flex justify-between text-stone-600 dark:text-stone-400">
                    <span>餐點小計</span>
                    <span className="font-bold text-stone-900 dark:text-stone-100">{money(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-stone-600 dark:text-stone-400">
                    <span>內用服務費 ({rate}%)</span>
                    <span className="font-bold text-stone-900 dark:text-stone-100">{money(fee)}</span>
                  </div>
                  <div className="flex justify-between border-t border-stone-100 dark:border-stone-800 pt-2 text-base font-black text-amber-600 dark:text-amber-400">
                    <span>應收總額</span>
                    <span>{money(total)}</span>
                  </div>
                </div>

                <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300">
                  AA制拆單人數：
                  <select
                    value={splitCount}
                    onChange={e => setSplitCount(Number(e.target.value))}
                    className={`${field} mt-1`}
                  >
                    {[1, 2, 3, 4, 5, 6].map(n => (
                      <option key={n} value={n}>
                        {n === 1 ? "全單單一結帳" : `平均拆為 ${n} 份帳單`}
                      </option>
                    ))}
                  </select>
                </label>

                {splitCount > 1 && (
                  <div className="rounded-lg bg-stone-50 dark:bg-stone-950 p-3 space-y-1 text-xs">
                    {splits.map(s => (
                      <div key={s.number} className="flex justify-between font-mono">
                        <span>第 {s.number} 份：</span>
                        <span className="font-bold">{money(s.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300">
                  付款方式：
                  <select
                    value={method}
                    onChange={e => setMethod(e.target.value)}
                    className={`${field} mt-1`}
                  >
                    <option value="cash">現金支付 (Cash)</option>
                    <option value="credit_card">信用卡 (Simulated Card)</option>
                    <option value="line_pay">行動支付 (LinePay / ApplePay)</option>
                    <option value="member_wallet">會員儲值金扣款</option>
                  </select>
                </label>

                <button
                  disabled={!session || !items.length || busy}
                  onClick={() =>
                    void mutate(
                      "bill/pay",
                      { sessionId: session?.id, paymentMethod: method, splitCount },
                      "結帳完成！桌位已自動清桌歸位為可用狀態。",
                      () => setSplitCount(1)
                    )
                  }
                  className={`${button} w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md`}
                >
                  確認結帳並清桌
                </button>
              </aside>
            </section>
          )}
        </>
      )}
    </main>
  );
}

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { DiningRoleNav } from "../role-nav";
import { TakeoutHistory } from "../takeout-history";
import { WorkspaceHeader } from "@/components/workspace-header";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import {
  Armchair,
  UtensilsCrossed,
  Plus,
  Minus,
  RefreshCw,
  CalendarDays,
  Trash2,
} from "lucide-react";

type Table = { id: string; tableNumber: string; capacity: number; status: string };
type Session = { id: string; tableId: string; sessionToken: string; guestCount: number; status: string };
type Menu = { id: string; name: string; category: string; price: number; isSoldOut: boolean };
type ModifierGroup = { id: string; name: string; isRequired: boolean; maxSelection: number };
type Modifier = { id: string; groupId: string; name: string; additionalPrice: number };
type Order = { id: string; sessionId: string | null; orderType: string; takeoutNumber: string | null; totalAmount: number; status: string };
type OrderItem = { id: string; orderId: string; itemName: string; quantity: number; lineTotal: number; status: string };
type Ticket = { id: string; orderId: string; orderItemId: string; station: string; itemName: string; quantity: number; modifiersText: string; status: string; urgentFlag: boolean };
type Reservation = { id: string; tableId: string; customerName: string; guestCount: number; reservationTime: string; status: string };
type Data = {
  tables: Table[];
  sessions: Session[];
  menuItems: Menu[];
  modifierGroups: ModifierGroup[];
  modifierOptions: Modifier[];
  orders: Order[];
  orderItems: OrderItem[];
  kdsTickets: Ticket[];
  reservations: Reservation[];
  locations: { name: string; serviceFeeRate: number }[];
  bills: { id: string; orderId: string | null; finalAmount: number; paidAmount: number; status: string }[];
};
type CartLine = {
  key: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: { groupId: string; optionId: string }[];
  description: string;
};
type Envelope<T> = { success: boolean; data: T; error?: { message: string }; request_id?: string };

const money = (n: number) =>
  new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(n);
const button =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
const field =
  "w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary";

export default function FrontOfficePage() {
  const { t } = usePortfolioLocale();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [frontSubtab, setFrontSubtab] = useState<"floor" | "reservations">("floor");
  const [orderMode, setOrderMode] = useState<"dine_in" | "takeout">("dine_in");
  const [tableId, setTableId] = useState("");
  const [guests, setGuests] = useState(2);
  const [cart, setCart] = useState<CartLine[]>([]);
  const orderKey = useRef("");
  useEffect(() => {
    orderKey.current = crypto.randomUUID();
  }, [cart]);
  const [selectedMods, setSelectedMods] = useState<Record<string, string[]>>({});
  const [category, setCategory] = useState("All");
  const [reservationTable, setReservationTable] = useState("");
  const [reservationName, setReservationName] = useState("");
  const [reservationPhone, setReservationPhone] = useState("");
  const [reservationGuests, setReservationGuests] = useState(2);
  const [reservationTime, setReservationTime] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/dining/data", { cache: "no-store" });
      const json = (await response.json()) as Envelope<Data>;
      if (!response.ok || !json.success) throw new Error(json.error?.message || t("Unable to load data", "無法載入資料"));
      setData(json.data);
      setTableId(current => current || json.data.sessions.find(s => s.status === "active")?.tableId || json.data.tables[0]?.id || "");
      setReservationTable(current => current || json.data.tables[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Connection failed. Please retry.", "連線失敗，請重試。"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
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
  const cartTotal = cart.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  function add(item: Menu) {
    if (!data) return;
    const isDrink = item.category === "Drink" || item.category === "飲品";
    const mods = isDrink
      ? data.modifierGroups.flatMap(g => (selectedMods[g.id] || []).map(optionId => ({ groupId: g.id, optionId })))
      : [];
    if (isDrink && data.modifierGroups.some(g => g.isRequired && !selectedMods[g.id]?.length)) {
      setError(t("Select the required drink options first", "請先選擇飲品必選規格"));
      return;
    }
    const options = mods.map(m => data.modifierOptions.find(o => o.id === m.optionId)!).filter(Boolean);
    const key = `${item.id}:${mods.map(m => m.optionId).sort().join(",")}`;
    setCart(current =>
      current.some(i => i.key === key)
        ? current.map(i => (i.key === key ? { ...i, quantity: i.quantity + 1 } : i))
        : [
            ...current,
            {
              key,
              menuItemId: item.id,
              name: item.name,
              unitPrice: item.price + options.reduce((s, o) => s + o.additionalPrice, 0),
              quantity: 1,
              modifiers: mods,
              description: options.map(o => o.name).join(", "),
            },
          ]
    );
    setError("");
  }

  async function reserve(event: FormEvent) {
    event.preventDefault();
    const instant = new Date(`${reservationTime}:00+08:00`).toISOString();
    await mutate(
      "reservation",
      {
        tableId: reservationTable,
        customerName: reservationName,
        customerPhone: reservationPhone,
        guestCount: reservationGuests,
        reservationTime: instant,
      },
      t("Reservation created", "預約訂位已建立"),
      () => {
        setReservationName("");
        setReservationPhone("");
      }
    );
  }

  return (
    <main data-site="dining" data-role="front" className="suite-page suite-dining space-y-6">
      <WorkspaceHeader
        brand="TableCraft"
        eyebrow="Dining operations / FRONT OF HOUSE"
        title="TableCraft 智慧餐飲 · 前台現場服務"
        description="桌位排定、外場點餐、候位訂位管理與外帶自取記錄。"
        onRefresh={() => void load()}
        busy={busy || loading}
      >
        <span className="dining-service-tag inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-xs font-bold">
          <Armchair size={14} />
          <span>獨立分頁 · 前台現場外場</span>
        </span>
      </WorkspaceHeader>

      <DiningRoleNav currentRole="front" />

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
          {/* Sub navigation within Front office */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 dark:border-stone-800 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFrontSubtab("floor")}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  frontSubtab === "floor"
                    ? "bg-blue-600 text-white shadow-xs"
                    : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
              >
                <Armchair size={14} />
                <span>即時桌況與點餐</span>
              </button>
              <button
                type="button"
                onClick={() => setFrontSubtab("reservations")}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  frontSubtab === "reservations"
                    ? "bg-blue-600 text-white shadow-xs"
                    : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
              >
                <CalendarDays size={14} />
                <span>候位排桌與預約訂位</span>
              </button>
            </div>
            <span className="text-xs text-stone-500 dark:text-stone-400 font-medium">
              外場專屬工作區 · 桌況控管與訂位防衝撞阻擋機制
            </span>
          </div>

          {frontSubtab === "floor" && (
            <>
              {/* Order mode toggle */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-bold text-stone-900 dark:text-stone-100">點餐模式：</span>
                <div className="inline-flex rounded-xl bg-stone-100 dark:bg-stone-800 p-1 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setOrderMode("dine_in")}
                    className={`px-3 py-1.5 rounded-lg transition ${
                      orderMode === "dine_in"
                        ? "bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 font-bold shadow-xs"
                        : "text-stone-600 dark:text-stone-400"
                    }`}
                  >
                    內用點餐 (Dine-in)
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderMode("takeout")}
                    className={`px-3 py-1.5 rounded-lg transition ${
                      orderMode === "takeout"
                        ? "bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 font-bold shadow-xs"
                        : "text-stone-600 dark:text-stone-400"
                    }`}
                  >
                    外帶自取 (Takeout)
                  </button>
                </div>
              </div>

              {orderMode === "dine_in" ? (
                <>
                  {/* Table Selection Cards */}
                  <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {data.tables.map(tInfo => {
                      const active = data.sessions.find(s => s.tableId === tInfo.id && s.status === "active");
                      const isSelected = tInfo.id === tableId;
                      return (
                        <button
                          key={tInfo.id}
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (tInfo.id !== tableId) setCart([]);
                            setTableId(tInfo.id);
                          }}
                          className={`rounded-xl border p-5 text-left transition cursor-pointer ${
                            isSelected
                              ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-500"
                              : "border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 hover:border-stone-400 dark:hover:border-stone-600"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <strong className="text-xl font-bold">{tInfo.tableNumber}</strong>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                active
                                  ? "bg-orange-100 dark:bg-orange-950/50 text-orange-800 dark:text-orange-300"
                                  : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300"
                              }`}
                            >
                              {active ? "用餐中" : "空桌"}
                            </span>
                          </div>
                          <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
                            容納 {tInfo.capacity} 人座 {active && ` · 現有 ${active.guestCount} 位用餐`}
                          </p>
                        </button>
                      );
                    })}
                  </section>

                  {/* Open Session if vacant */}
                  {table && !session && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-stone-900 dark:text-stone-100">
                          {table.tableNumber} 尚未開桌，請設定用餐人數：
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setGuests(Math.max(1, guests - 1))}
                            className="h-8 w-8 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 font-bold"
                          >
                            -
                          </button>
                          <span className="w-8 text-center font-bold">{guests} 人</span>
                          <button
                            type="button"
                            onClick={() => setGuests(Math.min(table.capacity + 2, guests + 1))}
                            className="h-8 w-8 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 font-bold"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void mutate("session", { tableId: table.id, guestCount: guests }, "桌位已成功開桌！")
                        }
                        className={`${button} bg-blue-600 hover:bg-blue-700 text-white font-bold`}
                      >
                        確認開桌
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* Prepaid Takeout */
                <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4">
                  <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">外帶自取服務</h3>
                  <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                    自取點餐無須指定桌號，享免 10% 服務費，下單後將自動產生外帶號碼並送達廚房。
                  </p>
                </div>
              )}

              {/* Menu and Cart Grid */}
              <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                {/* Menu items */}
                <section className="space-y-4">
                  <div className="flex flex-wrap gap-1.5 border-b border-stone-200 dark:border-stone-800 pb-2">
                    {["All", ...new Set(data.menuItems.map(m => m.category))].map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategory(cat)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                          category === cat
                            ? "bg-blue-600 text-white"
                            : "bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
                        }`}
                      >
                        {cat === "All" ? "全部品項" : cat}
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {data.menuItems
                      .filter(m => category === "All" || m.category === category)
                      .map(item => (
                        <article
                          key={item.id}
                          className="flex flex-col justify-between rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="font-bold text-stone-900 dark:text-stone-100">{item.name}</h4>
                              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                {money(item.price)}
                              </span>
                            </div>
                            <span className="text-[11px] text-stone-500 dark:text-stone-400">{item.category}</span>
                          </div>

                          <button
                            type="button"
                            disabled={(orderMode === "dine_in" && !session) || item.isSoldOut || busy}
                            onClick={() => add(item)}
                            className={`${button} mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold`}
                          >
                            <Plus size={15} />
                            <span>{item.isSoldOut ? "今日售罄" : "加入點餐"}</span>
                          </button>
                        </article>
                      ))}
                  </div>
                </section>

                {/* Cart sidebar */}
                <aside className="h-fit space-y-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs">
                  <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">
                    {orderMode === "takeout" ? "外帶點餐清單" : `${table?.tableNumber || "外場"} · 點餐清單`}
                  </h3>

                  {!cart.length ? (
                    <p className="py-8 text-center text-xs text-stone-400">尚未加入任何餐點</p>
                  ) : (
                    cart.map(line => (
                      <div key={line.key} className="border-b border-stone-100 dark:border-stone-800 pb-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-xs font-bold text-stone-900 dark:text-stone-100">{line.name}</p>
                            {line.description && (
                              <p className="text-[10px] text-stone-400">{line.description}</p>
                            )}
                          </div>
                          <span className="text-xs font-mono font-bold text-stone-900 dark:text-stone-100">
                            {money(line.unitPrice * line.quantity)}
                          </span>
                        </div>

                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setCart(cur =>
                                cur.flatMap(i =>
                                  i.key !== line.key ? [i] : i.quantity > 1 ? [{ ...i, quantity: i.quantity - 1 }] : []
                                )
                              )
                            }
                            className="rounded border border-stone-300 dark:border-stone-700 p-1"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="text-xs font-bold w-6 text-center">{line.quantity}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setCart(cur =>
                                cur.map(i => (i.key === line.key ? { ...i, quantity: i.quantity + 1 } : i))
                              )
                            }
                            className="rounded border border-stone-300 dark:border-stone-700 p-1"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}

                  <div className="space-y-1.5 border-t border-stone-100 dark:border-stone-800 pt-3 text-xs">
                    <div className="flex justify-between text-stone-600 dark:text-stone-400">
                      <span>餐點金額小計</span>
                      <span className="font-bold text-stone-900 dark:text-stone-100">{money(cartTotal)}</span>
                    </div>
                    <div className="flex justify-between text-stone-600 dark:text-stone-400">
                      <span>預估服務費 ({orderMode === "takeout" ? "0" : rate}%)</span>
                      <span className="font-bold text-stone-900 dark:text-stone-100">
                        {orderMode === "takeout" ? "免服務費" : money(Math.round((cartTotal * rate) / 100))}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-stone-100 dark:border-stone-800 pt-2 text-sm font-black text-blue-600 dark:text-blue-400">
                      <span>應付總額</span>
                      <span>{money(cartTotal + (orderMode === "takeout" ? 0 : Math.round((cartTotal * rate) / 100)))}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={!cart.length || busy || (orderMode === "dine_in" && !session)}
                    onClick={() => {
                      if (orderMode === "takeout") {
                        void mutate(
                          "takeout",
                          {
                            items: cart.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity, modifiers: i.modifiers })),
                            idempotencyKey: orderKey.current,
                          },
                          "外帶訂單已成功送至廚房！",
                          () => setCart([])
                        );
                      } else {
                        void mutate(
                          "order",
                          {
                            tableId: table?.id,
                            items: cart.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity, modifiers: i.modifiers })),
                            idempotencyKey: orderKey.current,
                          },
                          "內用點餐已成功送達廚房出餐系統！",
                          () => setCart([])
                        );
                      }
                    }}
                    className={`${button} w-full bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md`}
                  >
                    送出點餐至廚房
                  </button>
                </aside>
              </div>

              {/* Takeout History */}
              <div className="mt-8 border-t border-stone-200 dark:border-stone-800 pt-6">
                <TakeoutHistory
                  orders={data.orders.filter(o => o.orderType === "takeout")}
                  bills={data.bills}
                  busy={busy}
                  onRefund={(orderId, r) =>
                    void mutate("takeout/refund", { orderId, reason: r }, "外帶訂單已全額退款於台帳，廚房單據已取消。")
                  }
                />
              </div>
            </>
          )}

          {/* Reservations view (Fully dark-mode perfected) */}
          {frontSubtab === "reservations" && (
            <section className="grid gap-6 lg:grid-cols-[380px_1fr]">
              <form
                onSubmit={e => void reserve(e)}
                className="h-fit space-y-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs"
              >
                <h3 className="text-lg font-bold text-stone-900 dark:text-stone-100">預約訂位登記</h3>
                <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                  訂位保留時間為 90 分鐘。同一桌位若有重疊時段將自動阻擋防止衝突。
                </p>

                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                  桌號
                  <select
                    className={`${field} mt-1`}
                    value={reservationTable}
                    onChange={e => setReservationTable(e.target.value)}
                  >
                    {data.tables.map(tInfo => (
                      <option key={tInfo.id} value={tInfo.id} className="dark:bg-stone-900 dark:text-stone-100">
                        {tInfo.tableNumber} · {tInfo.capacity} 人座
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                  顧客姓名
                  <input
                    className={`${field} mt-1`}
                    required
                    maxLength={100}
                    value={reservationName}
                    onChange={e => setReservationName(e.target.value)}
                    placeholder="請輸入顧客姓名或尊稱"
                  />
                </label>

                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                  聯絡電話
                  <input
                    className={`${field} mt-1`}
                    type="tel"
                    required
                    minLength={3}
                    maxLength={30}
                    value={reservationPhone}
                    onChange={e => setReservationPhone(e.target.value)}
                    placeholder="例如：0912-345-678"
                  />
                </label>

                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                  用餐人數
                  <input
                    className={`${field} mt-1`}
                    type="number"
                    min={1}
                    max={data.tables.find(tInfo => tInfo.id === reservationTable)?.capacity || 100}
                    required
                    value={reservationGuests}
                    onChange={e => setReservationGuests(Number(e.target.value))}
                  />
                </label>

                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                  用餐時間 (台北時間)
                  <input
                    className={`${field} mt-1`}
                    type="datetime-local"
                    required
                    value={reservationTime}
                    onChange={e => setReservationTime(e.target.value)}
                  />
                </label>

                <button
                  disabled={busy}
                  className={`${button} w-full bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md`}
                >
                  建立預約訂位
                </button>
              </form>

              {/* Reservations list */}
              <div className="space-y-3">
                <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">已登記預約名單</h3>
                {!data.reservations.length ? (
                  <p className="rounded-xl border border-dashed border-stone-200 dark:border-stone-800 p-8 text-center text-sm text-stone-400">
                    目前無預約訂位
                  </p>
                ) : (
                  data.reservations.map(r => (
                    <article
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <strong className="text-base text-stone-900 dark:text-stone-100">{r.customerName}</strong>
                          <span className="rounded-full bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 text-xs font-bold text-blue-700 dark:text-blue-300">
                            {r.guestCount} 位
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                          桌號: {data.tables.find(t => t.id === r.tableId)?.tableNumber || "未定"} · 時間:{" "}
                          {new Date(r.reservationTime).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
                        </p>
                      </div>

                      <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        {r.status === "confirmed" ? "已確認訂位" : r.status}
                      </span>
                    </article>
                  ))
                )}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

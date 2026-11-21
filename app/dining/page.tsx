"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { WorkspaceHeader } from "@/components/workspace-header";
import { DiningRoleNav } from "./role-nav";
import { TakeoutHistory } from "./takeout-history";
import { CustomerOrdering } from "./customer-ordering";
import { DiningManager } from "./dining-manager";
import { DiningFranchise } from "./dining-franchise";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import {
  UtensilsCrossed,
  ChefHat,
  Plus,
  Minus,
  RefreshCw,
  ArrowLeft,
  Receipt,
  Armchair,
  CalendarDays,
  Trash2,
  Smartphone,
  LayoutDashboard,
  Building2,
  Sparkles,
} from "lucide-react";

type Table = { id: string; tableNumber: string; capacity: number; status: string };
type Session = { id: string; tableId: string; sessionToken: string; guestCount: number; status: string };
type Menu = { id: string; name: string; category: string; price: number; isSoldOut: boolean };
type ModifierGroup = { id: string; name: string; isRequired: boolean; maxSelection: number };
type Modifier = { id: string; groupId: string; name: string; additionalPrice: number };
type Order = {
  id: string;
  sessionId: string | null;
  orderType: string;
  takeoutNumber: string | null;
  totalAmount: number;
  status: string;
};
type OrderItem = { id: string; orderId: string; itemName: string; quantity: number; lineTotal: number; status: string };
type Ticket = {
  id: string;
  orderId: string;
  orderItemId: string;
  station: string;
  itemName: string;
  quantity: number;
  modifiersText: string;
  status: string;
  urgentFlag: boolean;
};
type Reservation = {
  id: string;
  tableId: string;
  customerName: string;
  guestCount: number;
  reservationTime: string;
  status: string;
};
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
const field = "w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary";
const next: Record<string, "cooking" | "done" | "served"> = { received: "cooking", cooking: "done", done: "served" };

export default function DiningPage() {
  const { t } = usePortfolioLocale();
  const statuses: Record<string, string> = {
    received: t("Queued", "待製作"),
    cooking: t("Preparing", "製作中"),
    done: t("Ready", "已出餐"),
    served: t("Served", "已送餐"),
    pending: t("Queued", "待製作"),
    preparing: t("Preparing", "製作中"),
    ready: t("Ready", "已出餐"),
    cancelled: t("Voided", "已退菜"),
  };

  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [systemInterface, setSystemInterface] = useState<"customer" | "front" | "back" | "admin" | "franchise">("customer");
  const [frontSubtab, setFrontSubtab] = useState<"floor" | "reservations">("floor");
  const [backSubtab, setBackSubtab] = useState<"kitchen" | "billing">("kitchen");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const v = params.get("view") || params.get("interface") || params.get("tab") || params.get("role");
      if (v === "customer" || v === "guest") {
        window.location.replace("/dining/customer");
      } else if (v === "front" || v === "floor" || v === "reservations") {
        window.location.replace("/dining/front");
      } else if (v === "back" || v === "kitchen" || v === "billing") {
        window.location.replace("/dining/back");
      } else if (v === "admin" || v === "manager") {
        window.location.replace("/dining/admin");
      } else if (v === "franchise" || v === "owner") {
        window.location.replace("/dining/franchise");
      }
    }
  }, []);

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
  const [station, setStation] = useState("All");
  const [splitCount, setSplitCount] = useState(1);
  const [method, setMethod] = useState("cash");
  const [reason, setReason] = useState("");
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
      setTableId(
        current =>
          current ||
          json.data.sessions.find((s: Session) => s.status === "active")?.tableId ||
          json.data.tables[0]?.id ||
          ""
      );
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
      if (!response.ok || !json.success)
        throw new Error(
          `${json.error?.message || t("Operation failed", "操作失敗")}${
            json.request_id ? ` (trace ID ${json.request_id})` : ""
          }`
        );
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
  const cartTotal = cart.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const splits = Array.from({ length: splitCount }, (_, index) => ({
    splitIndex: index + 1,
    amount: Math.floor(total / splitCount) + (index < total % splitCount ? 1 : 0),
    paymentMethod: method,
  }));

  function add(item: Menu) {
    if (!data) return;
    const isDrink = item.category === "Drinks" || item.category === "飲品";
    const mods =
      isDrink
        ? data.modifierGroups.flatMap(g =>
            (selectedMods[g.id] || []).map(optionId => ({ groupId: g.id, optionId }))
          )
        : [];
    if (
      isDrink &&
      data.modifierGroups.some(g => g.isRequired && !selectedMods[g.id]?.length)
    ) {
      setError(t("Select the required drink options first", "請先選擇飲品必選規格"));
      return;
    }
    const options = mods.map(m => data.modifierOptions.find(o => o.id === m.optionId)!).filter(Boolean);
    const key = `${item.id}:${mods
      .map(m => m.optionId)
      .sort()
      .join(",")}`;
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

  const renderTableCards = (currentData: Data) => (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {currentData.tables.map(tInfo => {
        const active = currentData.sessions.find(s => s.tableId === tInfo.id && s.status === "active");
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
              tInfo.id === tableId
                ? "border-primary bg-[#d4e9e2] ring-1 ring-primary"
                : "border-stone-200 bg-white hover:border-stone-400"
            }`}
          >
            <div className="flex items-center justify-between">
              <strong className="text-xl">{tInfo.tableNumber}</strong>
              <span
                className={`rounded-full px-2 py-1 text-xs font-semibold ${
                  active ? "bg-orange-100 text-orange-800" : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {active
                  ? t("Occupied", "用餐中")
                  : tInfo.status === "vacant"
                  ? t("Available", "空桌")
                  : t("Unavailable", "不可用")}
              </span>
            </div>
            <p className="mt-3 text-xs text-stone-500">
              {tInfo.capacity} {t("seats", "人座")}
              {active && ` · ${active.guestCount} ${t("guests", "位用餐")}`}
            </p>
          </button>
        );
      })}
    </section>
  );

  return (
    <main data-site="dining" data-dining-view={systemInterface} className="suite-page suite-dining space-y-6">
      <WorkspaceHeader
        brand="TableCraft"
        eyebrow="Dining operations / SERVICE"
        title="Care for every table."
        description="Connect front-of-house orders, kitchen service and billing."
        onRefresh={() => void load()}
        busy={busy || loading}
      >
        <span className="dining-service-tag">
          <UtensilsCrossed size={15} />
          {t("Dining workspace", "餐飲營運工作區")}
        </span>
      </WorkspaceHeader>
      <p className="workspace-note">
        {t("Demo workspace · Card payments are simulated. No actual charges.", "示範工作空間 · 信用卡付款為模擬，不實際扣款。")}
      </p>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <span className="break-all">{error}</span>
          <button className="underline" onClick={() => void load()}>
            {t("Retry loading", "重試載入")}
          </button>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
        >
          {notice}
        </div>
      )}
      <DiningRoleNav currentRole={systemInterface} />
      {data && (
        <>
          <section aria-label={t("Operations overview", "營運總覽")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              [
                t("Occupied tables", "在客桌數"),
                `${data.sessions.filter(s => s.status === "active").length} / ${data.tables.length}`,
              ],
              [
                t("Pending kitchen items", "廚房待出餐項"),
                data.kdsTickets.filter(t => t.status !== "served").length,
              ],
              [
                t("Reservations", "今日訂位"),
                data.reservations.filter(r => r.status === "confirmed").length,
              ],
              [
                t("Total collected", "累計已收金額"),
                money(
                  data.bills.filter(b => b.status === "paid").reduce((s, b) => s + b.finalAmount, 0)
                ),
              ],
            ].map(([name, value]) => (
              <div key={name as string} className="rounded-xl border border-stone-200 bg-white p-4">
                <p className="text-xs text-stone-500">{name}</p>
                <p className="mt-2 text-2xl font-bold">{value}</p>
              </div>
            ))}
          </section>
          {/* 5-Interface System Switcher */}
          <section aria-label="智慧餐飲五大專屬角色系統介面" className="rounded-2xl border border-stone-200 bg-white p-3 shadow-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between px-2 pt-1 pb-2 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-xs font-bold text-stone-900">
                  {t("SMART DINING 5-ROLE INTERFACES", "智慧餐飲五大專屬角色系統介面")}
                </span>
              </div>
              <span className="text-[11px] text-stone-500 font-medium">
                {t("Click to switch interface perspective and role permissions", "點擊即時切換視角與功能權限")}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {[
                {
                  id: "customer",
                  nameZh: "用戶端",
                  nameEn: "Customer",
                  roleZh: "顧客自選手機點餐",
                  descZh: "桌席掃碼 · 候位訂位 · 出餐追蹤",
                  icon: Smartphone,
                  colorClass: "from-rose-50 to-pink-50 text-rose-700 border-rose-200",
                  activeClass: "bg-rose-600 text-white shadow-md ring-2 ring-rose-600/30",
                },
                {
                  id: "front",
                  nameZh: "前台",
                  nameEn: "Front of House",
                  roleZh: "外場服務員 / 領檯收銀",
                  descZh: "即時桌況 · 代客點餐 · 候位帶位",
                  icon: Armchair,
                  colorClass: "from-blue-50 to-indigo-50 text-blue-700 border-blue-200",
                  activeClass: "bg-blue-600 text-white shadow-md ring-2 ring-blue-600/30",
                },
                {
                  id: "back",
                  nameZh: "後台",
                  nameEn: "Back of House",
                  roleZh: "廚房主廚 / 出餐結帳員",
                  descZh: "出餐 KDS · 站點分流 · 帳單結算",
                  icon: ChefHat,
                  colorClass: "from-amber-50 to-yellow-50 text-amber-700 border-amber-200",
                  activeClass: "bg-amber-600 text-white shadow-md ring-2 ring-amber-600/30",
                },
                {
                  id: "admin",
                  nameZh: "管理者",
                  nameEn: "HQ General Manager",
                  roleZh: "餐廳店經理 / 營運總監",
                  descZh: "營收看板 · 菜單定價 · SLA 監控",
                  icon: LayoutDashboard,
                  colorClass: "from-purple-50 to-indigo-50 text-purple-700 border-purple-200",
                  activeClass: "bg-purple-600 text-white shadow-md ring-2 ring-purple-600/30",
                },
                {
                  id: "franchise",
                  nameZh: "加盟主",
                  nameEn: "Franchisee Portal",
                  roleZh: "連鎖加盟門市投資主",
                  descZh: "多店分潤 · 央廚叫貨 · QSC 評鑑",
                  icon: Building2,
                  colorClass: "from-emerald-50 to-teal-50 text-emerald-700 border-emerald-200",
                  activeClass: "bg-emerald-600 text-white shadow-md ring-2 ring-emerald-600/30",
                },
              ].map(role => {
                const Icon = role.icon;
                const isActive = systemInterface === role.id;
                return (
                  <Link
                    key={role.id}
                    href={`/dining/${role.id}`}
                    onClick={() => {
                      setSystemInterface(role.id as typeof systemInterface);
                    }}
                    className={`flex flex-col text-left p-3 rounded-xl border transition cursor-pointer no-underline ${
                      isActive
                        ? role.activeClass
                        : `border-stone-200 dark:border-stone-800 bg-gradient-to-br ${role.colorClass} dark:from-stone-900 dark:to-stone-900/60 hover:border-stone-400 dark:hover:border-stone-700 hover:shadow-xs`
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <div className="flex items-center gap-1.5">
                        <Icon size={18} />
                        <span className="font-black text-sm">{role.nameZh}</span>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isActive ? "bg-white/20 text-white" : "bg-white/80 dark:bg-stone-800 text-stone-700 dark:text-stone-300"
                      }`}>
                        {role.nameEn}
                      </span>
                    </div>
                    <span className={`text-xs font-semibold ${isActive ? "text-white/90" : "text-stone-800 dark:text-stone-200"}`}>
                      {role.roleZh}
                    </span>
                    <span className={`mt-1 text-[11px] leading-tight ${isActive ? "text-white/80" : "text-stone-500 dark:text-stone-400"}`}>
                      {role.descZh}
                    </span>
                    <span className="mt-2 text-[10px] font-bold text-blue-600 dark:text-blue-400">
                      進入獨立頁面 →
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* 1. 用戶端 (Customer) */}
          {systemInterface === "customer" && (
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

          {/* 2. 前台 (Front of House) */}
          {systemInterface === "front" && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFrontSubtab("floor")}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
                      frontSubtab === "floor"
                        ? "bg-blue-600 text-white shadow-xs"
                        : "bg-white text-stone-600 border border-stone-200 hover:bg-stone-50"
                    }`}
                  >
                    <Armchair size={15} />
                    {t("Tables and ordering", "桌況翻桌與外場代客點餐")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFrontSubtab("reservations")}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
                      frontSubtab === "reservations"
                        ? "bg-blue-600 text-white shadow-xs"
                        : "bg-white text-stone-600 border border-stone-200 hover:bg-stone-50"
                    }`}
                  >
                    <CalendarDays size={15} />
                    {t("Reservations", "候位排桌與預約訂位")}
                  </button>
                </div>
                <span className="text-xs text-blue-800 font-semibold bg-blue-50 px-2.5 py-1 rounded-lg">
                  🛎️ 外場前台工作區 · 領檯、開桌與收銀代點即時連動
                </span>
              </div>

              {frontSubtab === "floor" && (
                <>
                  {orderMode === "dine_in" && renderTableCards(data)}
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white p-4">
                <span className="text-sm font-medium">{t("Order type", "用餐方式")}</span>
                {(["dine_in", "takeout"] as const).map(mode => (
                  <button
                    key={mode}
                    disabled={busy}
                    onClick={() => {
                      setOrderMode(mode);
                      setCart([]);
                    }}
                    className={`${button} ${
                      orderMode === mode ? "bg-primary text-white" : "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {mode === "dine_in" ? t("Dine in", "內用點餐") : t("Prepaid takeout", "外帶自取 (先結帳)")}
                  </button>
                ))}
                <span className="text-xs text-stone-500">
                  {t(
                    "Takeout has no service fee. Payment creates a pickup number and sends the order to the kitchen.",
                    "外帶免收服務費；付款後自動產生取餐號碼並即時送單至廚房。"
                  )}
                </span>
              </div>
              {orderMode === "dine_in" && !session && table && (
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    void mutate("session", { tableId, guestCount: guests }, `${table.tableNumber} ${t("Table opened", "已開桌")}`);
                  }}
                  className="flex flex-wrap items-end gap-4 rounded-xl border border-stone-200 bg-white p-5"
                >
                  <label className="text-sm">
                    {table.tableNumber} {t("Party size", "用餐人數")}
                    <input
                      className={`${field} mt-2 max-w-32`}
                      type="number"
                      min={1}
                      max={table.capacity}
                      value={guests}
                      onChange={e => setGuests(Number(e.target.value))}
                    />
                  </label>
                  <button disabled={busy || table.status !== "vacant"} className={`${button} bg-primary text-white`}>
                    {t("Open table", "確認開桌帶位")}
                  </button>
                </form>
              )}
              <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
                <section className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {["All", ...new Set(data.menuItems.map(i => i.category))].map(c => (
                      <button
                        key={c}
                        className={`${button} ${
                          category === c ? "bg-[#d4e9e2] text-[#1e3932]" : "bg-white text-stone-500"
                        }`}
                        onClick={() => setCategory(c)}
                      >
                        {t(c)}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {data.menuItems
                      .filter(i => category === "All" || category === i.category)
                      .map(item => (
                        <article
                          key={item.id}
                          className="flex flex-col rounded-xl border border-stone-200 bg-white p-5"
                        >
                          <span className="text-xs text-orange-700">{t(item.category)}</span>
                          <h2 className="mt-2 text-lg font-semibold">{item.name}</h2>
                          <p className="my-4 text-xl font-bold">{money(item.price)}</p>
                          {(item.category === "Drinks" || item.category === "飲品") &&
                            data.modifierGroups.map(g => (
                              <fieldset key={g.id} className="mb-4">
                                <legend className="mb-2 text-xs font-semibold text-stone-600">{g.name}</legend>
                                <div className="flex flex-wrap gap-2">
                                  {data.modifierOptions
                                    .filter(o => o.groupId === g.id)
                                    .map(o => (
                                      <label
                                        key={o.id}
                                        className="flex items-center gap-1 rounded-lg bg-stone-50 px-2 py-1.5 text-xs"
                                      >
                                        <input
                                          type={g.maxSelection === 1 ? "radio" : "checkbox"}
                                          name={g.id}
                                          checked={(selectedMods[g.id] || []).includes(o.id)}
                                          onChange={e =>
                                            setSelectedMods(current => ({
                                              ...current,
                                              [g.id]:
                                                g.maxSelection === 1
                                                  ? [o.id]
                                                  : e.target.checked
                                                  ? [...(current[g.id] || []), o.id]
                                                  : (current[g.id] || []).filter(id => id !== o.id),
                                            }))
                                          }
                                        />
                                        {o.name}
                                        {o.additionalPrice > 0 && ` +${o.additionalPrice}`}
                                      </label>
                                    ))}
                                </div>
                              </fieldset>
                            ))}
                          <button
                            disabled={(orderMode === "dine_in" && !session) || item.isSoldOut || busy}
                            onClick={() => add(item)}
                            className={`${button} mt-auto bg-primary text-white`}
                          >
                            <Plus size={16} />
                            {item.isSoldOut ? t("Sold out today", "今日已售罄") : t("Add to order", "加入點餐")}
                          </button>
                        </article>
                      ))}
                  </div>
                </section>
                <aside className="dining-order h-fit space-y-4 rounded-xl border border-stone-200 bg-white p-5">
                  <h2 className="text-lg font-bold">
                    {orderMode === "takeout"
                      ? t("Prepaid takeout", "外帶自取")
                      : table?.tableNumber || t("Select a table", "請選擇桌位")}{" "}
                    · {t("Current order", "目前點餐")}
                  </h2>
                  {orderMode === "dine_in" && !session && (
                    <p className="text-sm text-orange-700">
                      {t(
                        "Select an occupied table or open a table to begin ordering.",
                        "請選擇用餐中的桌位或開桌以開始點餐。"
                      )}
                    </p>
                  )}
                  {!cart.length && (
                    <p className="py-6 text-center text-sm text-stone-400">
                      {t("No items added", "尚未加入任何餐點")}
                    </p>
                  )}
                  {cart.map(line => (
                    <div key={line.key} className="border-b border-stone-100 pb-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{line.name}</p>
                          <p className="mt-1 text-xs text-stone-400">{line.description}</p>
                        </div>
                        <span className="text-sm">{money(line.unitPrice * line.quantity)}</span>
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <button
                          aria-label={`Decrease ${line.name}`}
                          disabled={busy}
                          onClick={() =>
                            setCart(current =>
                              current.flatMap(i =>
                                i.key !== line.key ? [i] : i.quantity > 1 ? [{ ...i, quantity: i.quantity - 1 }] : []
                              )
                            )
                          }
                          className="rounded-lg border p-1.5"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="text-sm">{line.quantity}</span>
                        <button
                          aria-label={`Increase ${line.name}`}
                          disabled={busy || line.quantity >= 100}
                          onClick={() =>
                            setCart(current =>
                              current.map(i => (i.key === line.key ? { ...i, quantity: i.quantity + 1 } : i))
                            )
                          }
                          className="rounded-lg border p-1.5"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm">
                    <span>{t("Food subtotal", "餐點小計")}</span>
                    <span>{money(cartTotal)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-stone-500">
                    <span>
                      {t("Service charge", "服務費")}{" "}
                      {orderMode === "takeout" ? 0 : rate}% (
                      {t("calculated at checkout", "結帳時計入")})
                    </span>
                    <span>
                      {money(orderMode === "takeout" ? 0 : Math.round((cartTotal * rate) / 100))}
                    </span>
                  </div>
                  {orderMode === "takeout" && (
                    <label className="block text-sm">
                      {t("Takeout payment", "外帶付款方式")}
                      <select className={`${field} mt-2`} value={method} onChange={e => setMethod(e.target.value)}>
                        <option value="cash">{t("Cash (demo ledger)", "現金 (示範台帳)")}</option>
                        <option value="mock_card">{t("Simulated card (no charges)", "模擬刷卡 (不扣款)")}</option>
                      </select>
                    </label>
                  )}
                  <button
                    disabled={busy || (orderMode === "dine_in" && !session) || !cart.length}
                    onClick={() =>
                      void mutate(
                        orderMode === "takeout" ? "takeout" : "order",
                        {
                          sessionToken: session?.sessionToken,
                          paymentMethod: method,
                          items: cart.map(({ menuItemId, quantity, modifiers }) => ({
                            menuItemId,
                            quantity,
                            modifiers,
                          })),
                          idempotencyKey: orderKey.current,
                        },
                        orderMode === "takeout"
                          ? t(
                              "Takeout paid. See pickup number in the takeout records below.",
                              "外帶已付款，取餐號碼請見下方外帶紀錄。"
                            )
                          : t("Order sent to kitchen", "訂單已送至廚房出餐"),
                        () => setCart([])
                      )
                    }
                    className={`${button} w-full bg-primary text-white`}
                  >
                    {busy
                      ? t("Processing…", "處理中…")
                      : orderMode === "takeout"
                      ? `${t("Confirm payment", "確認付款")} ${money(cartTotal)} ${t("and send order", "並送單")}`
                      : t("Confirm order", "確認送出點餐")}
                  </button>
                </aside>
              </div>
              {orderMode === "takeout" && (
                <TakeoutHistory
                  orders={data.orders.filter(o => o.orderType === "takeout")}
                  bills={data.bills}
                  busy={busy}
                  onRefund={(orderId, r) =>
                    void mutate(
                      "takeout/refund",
                      { orderId, reason: r },
                      t(
                        "Takeout fully refunded in demo ledger. Kitchen order canceled.",
                        "外帶已全額退款於台帳，廚房單據已取消。"
                      )
                    )
                  }
                />
              )}
            </>
          )}

          {frontSubtab === "reservations" && (
            <section className="grid gap-6 lg:grid-cols-[340px_1fr]">
              <form onSubmit={e => void reserve(e)} className="h-fit space-y-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs">
                <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100">{t("New reservation", "預約訂位")}</h2>
                <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                  {t(
                    "Reservations last 90 minutes. Overlapping reservations for the same table are blocked.",
                    "訂位保留時間為 90 分鐘。同一桌位若有重疊時段將自動阻擋防止衝突。"
                  )}
                </p>
                <label className="block text-sm text-stone-700 dark:text-stone-300">
                  {t("Table", "桌號")}
                  <select
                    className={`${field} mt-2`}
                    value={reservationTable}
                    onChange={e => setReservationTable(e.target.value)}
                  >
                    {data.tables.map(tInfo => (
                      <option key={tInfo.id} value={tInfo.id} className="dark:bg-stone-900 dark:text-stone-100">
                        {tInfo.tableNumber} · {tInfo.capacity} {t("seats", "人座")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-stone-700 dark:text-stone-300">
                  {t("Customer name", "顧客姓名")}
                  <input
                    className={`${field} mt-2`}
                    required
                    maxLength={100}
                    value={reservationName}
                    onChange={e => setReservationName(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-stone-700 dark:text-stone-300">
                  {t("Phone", "聯絡電話")}
                  <input
                    className={`${field} mt-2`}
                    type="tel"
                    required
                    minLength={3}
                    maxLength={30}
                    value={reservationPhone}
                    onChange={e => setReservationPhone(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-stone-700 dark:text-stone-300">
                  {t("Party size", "用餐人數")}
                  <input
                    className={`${field} mt-2`}
                    type="number"
                    min={1}
                    max={data.tables.find(tInfo => tInfo.id === reservationTable)?.capacity || 100}
                    required
                    value={reservationGuests}
                    onChange={e => setReservationGuests(Number(e.target.value))}
                  />
                </label>
                <label className="block text-sm text-stone-700 dark:text-stone-300">
                  {t("Dining time (Taipei)", "用餐時間 (台北時間)")}
                  <input
                    className={`${field} mt-2`}
                    type="datetime-local"
                    required
                    value={reservationTime}
                    onChange={e => setReservationTime(e.target.value)}
                  />
                </label>
                <button disabled={busy} className={`${button} w-full bg-primary text-white`}>
                  {t("Create reservation", "建立預約訂位")}
                </button>
              </form>
              <div className="space-y-3">
                {!data.reservations.length && (
                  <p className="rounded-xl border border-dashed p-8 text-center text-stone-500">
                    {t("No reservations", "目前無預約訂位")}
                  </p>
                )}
                {data.reservations.map(r => (
                  <article
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs"
                  >
                    <div>
                      <h2 className="font-semibold text-stone-900 dark:text-stone-100">
                        {r.customerName} · {r.guestCount} {t("guests", "位")}
                      </h2>
                      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
                        {new Date(
                          r.reservationTime.includes("T")
                            ? r.reservationTime
                            : `${r.reservationTime.replace(" ", "T")}:00+08:00`
                        ).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
                      </p>
                    </div>
                    <span className="rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 px-3 py-2 text-sm">
                      {data.tables.find(tInfo => tInfo.id === r.tableId)?.tableNumber} {t("table", "桌")} ·{" "}
                      {r.status === "confirmed" ? t("Confirmed", "已確認") : r.status}
                    </span>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* 3. 後台 (Back of House / KDS & Billing) */}
      {systemInterface === "back" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBackSubtab("kitchen")}
                className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
                  backSubtab === "kitchen"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "bg-white text-stone-600 border border-stone-200 hover:bg-stone-50"
                }`}
              >
                <ChefHat size={15} />
                {t("Kitchen KDS", "廚房出餐看板 (KDS 工作站)")}
              </button>
              <button
                type="button"
                onClick={() => setBackSubtab("billing")}
                className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
                  backSubtab === "billing"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "bg-white text-stone-600 border border-stone-200 hover:bg-stone-50"
                }`}
              >
                <Receipt size={15} />
                {t("Bills and splits", "帳單結算與清桌核銷")}
              </button>
            </div>
            <span className="text-xs text-amber-800 font-semibold bg-amber-50 px-2.5 py-1 rounded-lg">
              👨‍🍳 內場後台工作區 · 站點即時出餐、急單提醒與結帳清桌
            </span>
          </div>

          {backSubtab === "kitchen" && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="station" className="text-sm font-medium">
                  {t("Kitchen station", "廚房工作站")}
                </label>
                <select
                  id="station"
                  value={station}
                  onChange={e => setStation(e.target.value)}
                  className={`${field} max-w-56`}
                >
                  {["All", ...new Set(data.kdsTickets.map(t => t.station))].map(s => (
                    <option key={s}>{t(s)}</option>
                  ))}
                </select>
                <p className="text-xs text-stone-500">
                  {t(
                    "Queued → Preparing → Ready → Served. Updates synchronize bill details.",
                    "待製作 → 製作中 → 已出餐 → 已送餐。狀態即時同步帳單明細。"
                  )}
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
                        ? `${t("Takeout", "外帶")} ${order.takeoutNumber}`
                        : data.tables.find(t => t.id === sess?.tableId)?.tableNumber;
                    return (
                      <article key={ticket.id} className="rounded-xl border border-stone-200 bg-white p-5">
                        <div className="flex items-center justify-between">
                          <span className="break-all font-bold">
                            {order?.orderType === "takeout" ? tableName : `${tableName || "—"} ${t("table", "桌")}`}
                          </span>
                          <span className="rounded-full bg-orange-50 px-2 py-1 text-xs text-orange-800">
                            {statuses[ticket.status]}
                          </span>
                        </div>
                        {ticket.urgentFlag && (
                          <p role="status" className="mt-3 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">
                            {t("Service team requested priority", "外場已送出催單請求")}
                          </p>
                        )}
                        <h2 className="mt-4 font-semibold">
                          {ticket.itemName} × {ticket.quantity}
                        </h2>
                        <p className="mt-2 min-h-5 text-xs text-stone-500">
                          {ticket.modifiersText || t("No extras", "無特殊備註")}
                        </p>
                        <p className="my-4 text-xs text-stone-400">{ticket.station}</p>
                        <button
                          disabled={busy || ticket.urgentFlag}
                          onClick={() =>
                            void mutate("kds/urge", { ticketId: ticket.id }, t("Priority request sent to kitchen", "催單通知已送達廚房"))
                          }
                          className={`${button} mb-3 w-full border border-orange-200 text-orange-800`}
                        >
                          {ticket.urgentFlag ? t("Priority requested", "已催單") : t("Request priority", "催單")}
                        </button>
                        <button
                          disabled={busy || !next[ticket.status]}
                          onClick={() =>
                            void mutate(
                              "kds/status",
                              { ticketId: ticket.id, newStatus: next[ticket.status] },
                              t("Kitchen status updated", "廚房狀態已更新")
                            )
                          }
                          className={`${button} w-full bg-primary text-white`}
                        >
                          {ticket.status === "received"
                            ? t("Start preparation", "開始製作")
                            : ticket.status === "cooking"
                            ? t("Mark ready", "完成出餐")
                            : t("Mark served", "標記已送餐")}
                        </button>
                      </article>
                    );
                  })}
              </div>
              {!data.kdsTickets.some(
                t => t.status !== "served" && (station === "All" || t.station === station)
              ) && (
                <p className="rounded-xl border border-dashed p-10 text-center text-stone-500">
                  {t("No pending kitchen items", "目前無待處理出餐項目")}
                </p>
              )}
            </section>
          )}
          {backSubtab === "billing" && (
            <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
              <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
                <h2 className="text-lg font-bold">
                  {table?.tableNumber} {t("table", "桌")} · {t("Bill details", "帳單明細")}
                </h2>
                {!session ? (
                  <p className="py-8 text-sm text-stone-500">{t("No open bill for this table.", "此桌尚無未結帳單。")}</p>
                ) : !items.length ? (
                  <p className="py-8 text-sm text-stone-500">{t("No items ordered", "尚未點購任何餐點")}</p>
                ) : (
                  items.map(i => (
                    <div
                      key={i.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 py-3"
                    >
                      <div>
                        <p
                          className={`text-sm font-medium ${
                            i.status === "cancelled" ? "line-through text-stone-400" : ""
                          }`}
                        >
                          {i.itemName} × {i.quantity}
                        </p>
                        <p className="mt-1 text-xs text-stone-500">{statuses[i.status] || i.status}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm">{money(i.status === "cancelled" ? 0 : i.lineTotal)}</span>
                        {i.status !== "cancelled" && (
                          <button
                            disabled={busy || !reason.trim()}
                            onClick={() =>
                              void mutate(
                                "cancel",
                                { orderItemId: i.id, reason },
                                t("Item voided. Bill recalculated.", "餐點已退菜，帳單已重新計算。")
                              )
                            }
                            aria-label={`Void item ${i.itemName}`}
                            className="rounded-lg p-2 text-red-700 disabled:opacity-30"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
                <label className="block text-xs text-stone-600">
                  {t(
                    "Void reason (preparing items require a manager)",
                    "退菜原因 (製作中品項須主管核准)"
                  )}
                  <input
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    maxLength={500}
                    className={`${field} mt-2`}
                    placeholder={t("e.g. Customer changed their order", "例如：客人更改點餐")}
                  />
                </label>
              </div>
              <aside className="h-fit space-y-4 rounded-xl border border-stone-200 bg-white p-5">
                <h2 className="text-lg font-bold">{t("Split bill checkout", "分帳結帳")}</h2>
                <div className="flex justify-between text-sm">
                  <span>{t("Active items", "有效餐點金額")}</span>
                  <span>{money(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>
                    {t("Service charge", "服務費")} {rate}%
                  </span>
                  <span>{money(fee)}</span>
                </div>
                <div className="flex justify-between border-t pt-4 text-xl font-bold">
                  <span>{t("Due", "應付總額")}</span>
                  <span>{money(total)}</span>
                </div>
                <label className="block text-sm">
                  {t("Split count", "分帳人數")}
                  <select
                    className={`${field} mt-2`}
                    value={splitCount}
                    onChange={e => setSplitCount(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6].map(n => (
                      <option key={n} value={n}>
                        {n} {t("people", "人")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  {t("Payment method", "付款方式")}
                  <select className={`${field} mt-2`} value={method} onChange={e => setMethod(e.target.value)}>
                    <option value="cash">{t("Cash (demo ledger)", "現金 (示範台帳)")}</option>
                    <option value="mock_card">{t("Simulated card (no charges)", "模擬刷卡 (不扣款)")}</option>
                  </select>
                </label>
                {splits.map(s => (
                  <div key={s.splitIndex} className="flex justify-between text-xs text-stone-500">
                    <span>
                      {t("Split", "第")} {s.splitIndex} {t("person", "人")}
                    </span>
                    <span>{money(s.amount)}</span>
                  </div>
                ))}
                <button
                  disabled={busy || !session || total <= 0 || splits.some(s => s.amount <= 0)}
                  onClick={() =>
                    void mutate(
                      "bill/pay",
                      { sessionId: session?.id, splits },
                      t("Checkout complete. Table released.", "結帳完成，桌位已釋放。")
                    )
                  }
                  className={`${button} w-full bg-primary text-white`}
                >
                  {busy ? t("Processing…", "處理中…") : t("Collect payment and close bill", "確認收款並結桌")}
                </button>
                <p className="text-xs leading-relaxed text-stone-400">
                  {t(
                    "Checkout settles all splits and closes the table session. The ordering token then expires.",
                    "結帳將結算所有分帳份數並關閉用餐場次，點餐權杖隨之失效。"
                  )}
                </p>
              </aside>
            </section>
          )}
        </div>
      )}

      {/* 4. 店長 (Manager / Admin) */}
      {systemInterface === "admin" && (
        <DiningManager
          menuItems={data.menuItems}
          modifierGroups={data.modifierGroups}
          modifierOptions={data.modifierOptions}
          orders={data.orders}
          orderItems={data.orderItems}
          kdsTickets={data.kdsTickets}
          bills={data.bills}
          tablesCount={data.tables.length}
          activeSessionsCount={data.sessions.filter(s => s.status === "active").length}
          onRefresh={() => void load()}
        />
      )}

      {/* 5. 加盟主 (Franchisee) */}
      {systemInterface === "franchise" && (
        <DiningFranchise
          currentStoreRevenue={data.bills.filter(b => b.status === "paid").reduce((s, b) => s + b.finalAmount, 0)}
          onRefresh={() => void load()}
        />
      )}
    </>
  )}
      {!data && (
        <div className="rounded-xl border border-dashed p-12 text-center text-stone-500">
          {loading ? t("Loading dining operations…", "正在載入餐飲作業…") : t("Unable to load data. Please refresh.", "無法載入資料，請重新整理。")}
        </div>
      )}
    </main>
  );
}

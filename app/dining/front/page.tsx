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
  Clock,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Layers,
  Timer,
  Check,
  X,
  Compass,
  ArrowRight,
  UserCheck,
} from "lucide-react";

type Table = {
  id: string;
  tableNumber: string;
  capacity: number;
  status: string; // vacant, occupied, reserved, cleaning
  zone?: string; // window, main, vip, bar
  shape?: string; // square, round, rectangle, bar
  coordX?: number;
  coordY?: number;
  cleanedUntil?: string | null;
};

type Session = {
  id: string;
  tableId: string;
  sessionToken: string;
  guestCount: number;
  status: string;
  openedAt?: string;
  closedAt?: string | null;
  durationMinutes?: number | null;
};

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
  customerPhone?: string;
  guestCount: number;
  reservationTime: string;
  status: string; // confirmed, seated, cancelled
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
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer";
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
  const [floorViewMode, setFloorViewMode] = useState<"layout" | "grid">("layout");
  const [selectedZone, setSelectedZone] = useState<string>("all");
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

  // Live timer tick to drive 5-minute cleaning countdown & dining duration in real time
  const [tick, setTick] = useState(0);
  useEffect(() => {
    document.title = "TableCraft · 前台現場 (桌況開桌與預約)";
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

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

  // 1. Calculate Average Dining Time: based on closed sessions (from QR scan / openedAt to checkout / closedAt)
  const closedSessions = data?.sessions.filter(s => s.status === "closed" && s.openedAt && s.closedAt) || [];
  const sessionDurations = closedSessions.map(s => {
    if (s.durationMinutes && s.durationMinutes > 0) return s.durationMinutes;
    return Math.max(1, Math.round((new Date(s.closedAt!).getTime() - new Date(s.openedAt!).getTime()) / 60000));
  });
  const avgDiningMinutes = sessionDurations.length > 0
    ? Math.round(sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length)
    : 60; // 預設平均 60 分鐘

  // Elapsed dining minutes for an active session (自掃碼點餐 / 開桌起算)
  const getElapsedMinutes = (sess?: Session) => {
    if (!sess?.openedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(sess.openedAt).getTime()) / 60000));
  };

  // Remaining cleaning seconds for a cleaning table (結帳後預留5分鐘清潔倒數)
  const getRemainingCleaningSec = (tInfo: Table) => {
    if (tInfo.status !== "cleaning" || !tInfo.cleanedUntil) return 0;
    return Math.max(0, Math.floor((new Date(tInfo.cleanedUntil).getTime() - Date.now()) / 1000));
  };

  // Dynamic wait time estimation for next available table (考慮已用餐時間 + 5分鐘清潔)
  const vacantTables = data?.tables.filter(t => t.status === "vacant") || [];
  const cleaningTables = data?.tables.filter(t => t.status === "cleaning") || [];
  const occupiedTables = data?.tables.filter(t => t.status === "occupied") || [];

  let estimatedWaitMinutes = 0;
  if (vacantTables.length > 0) {
    estimatedWaitMinutes = 0;
  } else if (cleaningTables.length > 0) {
    const minCleaningSec = Math.min(...cleaningTables.map(t => getRemainingCleaningSec(t)));
    estimatedWaitMinutes = Math.max(1, Math.ceil(minCleaningSec / 60));
  } else if (occupiedTables.length > 0) {
    const remainingTimes = occupiedTables.map(t => {
      const sess = data?.sessions.find(s => s.tableId === t.id && s.status === "active");
      const elapsed = getElapsedMinutes(sess);
      return Math.max(0, avgDiningMinutes - elapsed) + 5; // 剩餘用餐時間 + 5分鐘清潔
    });
    estimatedWaitMinutes = Math.min(...remainingTimes);
  }

  const table = data?.tables.find(t => t.id === tableId);
  const session = data?.sessions.find(s => s.tableId === tableId && s.status === "active");
  const reservationOnTable = data?.reservations.find(r => r.tableId === tableId && r.status === "confirmed");
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
      t("Reservation created", "預約訂位已成功建立！系統已預留90分鐘用餐與5分鐘翻桌清潔時段。"),
      () => {
        setReservationName("");
        setReservationPhone("");
      }
    );
  }

  const zoneNames: Record<string, string> = {
    all: "全部區域 (All)",
    window: "🪟 靠窗景觀區",
    main: "🏛️ 中央大廳區",
    vip: "👑 隱密包廂區",
    bar: "🍸 酒吧吧台區",
  };

  const filteredTables = (data?.tables || []).filter(t => {
    if (selectedZone === "all") return true;
    return (t.zone || "main") === selectedZone;
  });

  return (
    <main className="space-y-6">
      <WorkspaceHeader
        brand="TableCraft"
        eyebrow="Dining operations / FRONT OF HOUSE"
        title="TableCraft 前台外場工作站"
        description="場地配置平面圖 · 掃碼開桌計時 · 結帳後空桌5分鐘清潔緩衝 · 智慧預約排桌"
        onRefresh={() => void load()}
        busy={busy}
      />

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
          {/* Top Operation Metric Bar: Average Dining Time, Cleaning Buffer, Wait Time, Table Counts */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 p-4 shadow-xs">
              <div className="flex items-center justify-between text-xs font-semibold text-blue-800 dark:text-blue-300">
                <span>平均用餐時間</span>
                <Clock size={16} />
              </div>
              <p className="mt-2 text-2xl font-black text-blue-950 dark:text-blue-100">{avgDiningMinutes} 分鐘</p>
              <p className="mt-1 text-[11px] text-blue-700/80 dark:text-blue-400">
                依『掃碼點餐至結帳』精準計算 ({closedSessions.length} 筆歷史紀錄)
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-4 shadow-xs">
              <div className="flex items-center justify-between text-xs font-semibold text-amber-800 dark:text-amber-300">
                <span>結帳後清潔緩衝</span>
                <Sparkles size={16} />
              </div>
              <p className="mt-2 text-2xl font-black text-amber-950 dark:text-amber-100">5 分鐘</p>
              <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-400">
                翻桌總週期約 {avgDiningMinutes + 5} 分鐘 (含收拾消毒)
              </p>
            </div>

            <div className="rounded-2xl border border-purple-200 dark:border-purple-900/60 bg-purple-50/70 dark:bg-purple-950/30 p-4 shadow-xs">
              <div className="flex items-center justify-between text-xs font-semibold text-purple-800 dark:text-purple-300">
                <span>候位預估等待</span>
                <Timer size={16} />
              </div>
              <p className="mt-2 text-2xl font-black text-purple-950 dark:text-purple-100">
                {estimatedWaitMinutes === 0 ? "即時空桌" : `約 ${estimatedWaitMinutes} 分鐘`}
              </p>
              <p className="mt-1 text-[11px] text-purple-700/80 dark:text-purple-400">
                {vacantTables.length > 0 ? "現有空桌可直接帶位" : cleaningTables.length > 0 ? "已有桌位進入5分鐘清潔中" : "依最近桌次用餐進度預估"}
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 shadow-xs">
              <div className="flex items-center justify-between text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                <span>全場桌況即時分佈</span>
                <Armchair size={16} />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black text-emerald-950 dark:text-emerald-100">{vacantTables.length}</span>
                <span className="text-xs text-stone-500 dark:text-stone-400">可入座 / 共 {data.tables.length} 桌</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                <span className="inline-flex items-center gap-0.5 text-blue-700 dark:text-blue-400 font-bold">● {occupiedTables.length} 用餐中</span>
                <span className="text-stone-300 dark:text-stone-700">·</span>
                <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-400 font-bold">● {cleaningTables.length} 待清潔</span>
                <span className="text-stone-300 dark:text-stone-700">·</span>
                <span className="inline-flex items-center gap-0.5 text-purple-700 dark:text-purple-400 font-bold">● {data.reservations.filter(r => r.status === "confirmed").length} 預約</span>
              </div>
            </div>
          </section>

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
                <Compass size={14} />
                <span>場地配置圖與即時桌況</span>
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
                <span>預約訂位與排程管理 ({data.reservations.filter(r => r.status === "confirmed").length})</span>
              </button>
            </div>

            {frontSubtab === "floor" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-500 dark:text-stone-400 font-medium hidden sm:inline">視圖模式：</span>
                <div className="inline-flex rounded-lg bg-stone-100 dark:bg-stone-800 p-0.5 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setFloorViewMode("layout")}
                    className={`px-2.5 py-1 rounded-md transition ${
                      floorViewMode === "layout"
                        ? "bg-white dark:bg-stone-900 text-blue-600 dark:text-blue-400 font-bold shadow-2xs"
                        : "text-stone-600 dark:text-stone-400"
                    }`}
                  >
                    🗺️ 分區平面圖
                  </button>
                  <button
                    type="button"
                    onClick={() => setFloorViewMode("grid")}
                    className={`px-2.5 py-1 rounded-md transition ${
                      floorViewMode === "grid"
                        ? "bg-white dark:bg-stone-900 text-blue-600 dark:text-blue-400 font-bold shadow-2xs"
                        : "text-stone-600 dark:text-stone-400"
                    }`}
                  >
                    📋 卡片網格
                  </button>
                </div>
              </div>
            )}
          </div>

          {frontSubtab === "floor" && (
            <>
              {/* Zone Filter & Legend Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-stone-50 dark:bg-stone-900/50 p-3 rounded-2xl border border-stone-200 dark:border-stone-800">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-stone-600 dark:text-stone-400 mr-1 flex items-center gap-1">
                    <MapPin size={13} /> 區域篩選：
                  </span>
                  {["all", "window", "main", "vip", "bar"].map(zKey => (
                    <button
                      key={zKey}
                      type="button"
                      onClick={() => setSelectedZone(zKey)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                        selectedZone === zKey
                          ? "bg-blue-600 text-white shadow-2xs"
                          : "bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700"
                      }`}
                    >
                      {zoneNames[zKey]}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-stone-600 dark:text-stone-400">
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> 空桌可入座
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> 用餐中 (計時)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" /> 空桌待清 (5m倒數)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-purple-500" /> 預約保留
                  </span>
                </div>
              </div>

              {/* Floor Layout Map Section */}
              <section className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredTables.map(tInfo => {
                    const activeSess = data.sessions.find(s => s.tableId === tInfo.id && s.status === "active");
                    const resv = data.reservations.find(r => r.tableId === tInfo.id && r.status === "confirmed");
                    const isSelected = tInfo.id === tableId;

                    // Metrics for this table
                    const elapsed = getElapsedMinutes(activeSess);
                    const progressPercent = Math.min(100, Math.round((elapsed / avgDiningMinutes) * 100));
                    const isOvertime = activeSess && elapsed >= avgDiningMinutes;
                    const isNearEnd = activeSess && elapsed >= avgDiningMinutes * 0.75 && !isOvertime;

                    // Cleaning countdown
                    const remainingCleaningSec = getRemainingCleaningSec(tInfo);
                    const cleanMins = Math.floor(remainingCleaningSec / 60);
                    const cleanSecs = (remainingCleaningSec % 60).toString().padStart(2, "0");

                    // Status style
                    let borderClass = "border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900";
                    let badgeBg = "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300";
                    let statusLabel = "空桌可入座";

                    if (tInfo.status === "cleaning") {
                      borderClass = "border-amber-400 bg-amber-50/70 dark:bg-amber-950/30";
                      badgeBg = "bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200";
                      statusLabel = "空桌待清潔";
                    } else if (activeSess) {
                      if (isOvertime) {
                        borderClass = "border-red-500 bg-red-50/60 dark:bg-red-950/30 ring-1 ring-red-400";
                        badgeBg = "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 animate-pulse";
                        statusLabel = "用餐超時";
                      } else {
                        borderClass = "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20";
                        badgeBg = "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300";
                        statusLabel = "用餐中";
                      }
                    } else if (resv) {
                      borderClass = "border-purple-300 bg-purple-50/50 dark:bg-purple-950/20";
                      badgeBg = "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300";
                      statusLabel = "已預約";
                    }

                    if (isSelected) {
                      borderClass += " ring-2 ring-blue-600 shadow-md";
                    }

                    return (
                      <div
                        key={tInfo.id}
                        onClick={() => {
                          if (tInfo.id !== tableId) setCart([]);
                          setTableId(tInfo.id);
                        }}
                        className={`rounded-2xl border p-5 text-left transition cursor-pointer flex flex-col justify-between min-h-[185px] ${borderClass}`}
                      >
                        <div>
                          {/* Header: Table Number, Shape, Capacity, Status */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl font-black text-stone-900 dark:text-stone-100">{tInfo.tableNumber}</span>
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400">
                                {tInfo.capacity} 人座
                              </span>
                              <span className="text-[10px] text-stone-400">
                                {zoneNames[tInfo.zone || "main"]}
                              </span>
                            </div>
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${badgeBg}`}>
                              {statusLabel}
                            </span>
                          </div>

                          {/* Middle Body: Dynamic state details */}
                          {activeSess ? (
                            <div className="mt-3 space-y-2">
                              <div className="flex items-center justify-between text-xs font-semibold">
                                <span className="flex items-center gap-1 text-stone-700 dark:text-stone-300">
                                  <Clock size={13} className="text-blue-600 dark:text-blue-400" />
                                  已用餐 {elapsed} 分鐘
                                </span>
                                <span className={isOvertime ? "text-red-600 font-bold" : "text-stone-500"}>
                                  {isOvertime ? `已超時 ${elapsed - avgDiningMinutes}m` : `約剩 ${avgDiningMinutes - elapsed}m`}
                                </span>
                              </div>

                              {/* Progress bar */}
                              <div className="w-full bg-stone-200 dark:bg-stone-700 h-2 rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all duration-500 ${
                                    isOvertime ? "bg-red-600" : isNearEnd ? "bg-amber-500" : "bg-blue-600"
                                  }`}
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>

                              <div className="flex items-center justify-between text-[11px] text-stone-500 dark:text-stone-400 pt-1">
                                <span>{activeSess.guestCount} 位入座 · 掃碼開單中</span>
                                <span className="font-bold text-stone-900 dark:text-stone-100">
                                  已有點單
                                </span>
                              </div>
                            </div>
                          ) : tInfo.status === "cleaning" ? (
                            <div className="mt-3 rounded-xl bg-amber-100/60 dark:bg-amber-950/50 p-3 border border-amber-200 dark:border-amber-800/80">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1">
                                  <Sparkles size={13} /> 結帳後預留清潔緩衝
                                </span>
                                <span className="text-sm font-black font-mono text-amber-700 dark:text-amber-300">
                                  ⏱️ {cleanMins}:{cleanSecs}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-amber-800/80 dark:text-amber-400">
                                倒數結束自動釋放空桌，或外場整理完畢一鍵提前恢復
                              </p>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={e => {
                                  e.stopPropagation();
                                  void mutate("table/clean", { tableId: tInfo.id }, `${tInfo.tableNumber} 已清潔完畢，恢復空桌！`);
                                }}
                                className="mt-2 w-full text-xs font-bold py-1.5 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition cursor-pointer flex items-center justify-center gap-1 shadow-xs"
                              >
                                <Check size={13} /> 完成清潔 (立即釋放為空桌)
                              </button>
                            </div>
                          ) : resv ? (
                            <div className="mt-3 rounded-xl bg-purple-100/60 dark:bg-purple-950/40 p-2.5 border border-purple-200 dark:border-purple-800">
                              <p className="text-xs font-bold text-purple-900 dark:text-purple-200">
                                預約客人: {resv.customerName} ({resv.guestCount} 位)
                              </p>
                              <p className="text-[11px] text-purple-700 dark:text-purple-300 mt-0.5">
                                時間: {new Date(resv.reservationTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                              </p>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={e => {
                                  e.stopPropagation();
                                  void mutate("reservation/seat", { reservationId: resv.id }, `${resv.customerName} 預約客戶已成功安排入座！`);
                                }}
                                className="mt-2 w-full text-xs font-bold py-1 px-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition cursor-pointer flex items-center justify-center gap-1 shadow-xs"
                              >
                                <UserCheck size={13} /> 客人到店 · 安排入座
                              </button>
                            </div>
                          ) : (
                            <div className="mt-4 flex flex-col justify-center text-xs text-stone-500 dark:text-stone-400">
                              <p className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-semibold">
                                <CheckCircle2 size={14} /> 桌面已清潔乾淨，可安排入座
                              </p>
                              <p className="text-[11px] text-stone-400 mt-1">
                                點選此卡片即可在下方進行快速開桌或掃碼帶位
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Bottom action indicator */}
                        <div className="mt-4 pt-2 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between text-xs">
                          <span className="text-stone-400 font-medium">
                            {isSelected ? "● 目前選定此桌" : "點擊選定操作"}
                          </span>
                          <span className="text-blue-600 dark:text-blue-400 font-bold flex items-center gap-1">
                            {activeSess ? "查看消費 / 加點" : tInfo.status === "cleaning" ? "清潔管理" : "開桌作業"} <ArrowRight size={12} />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Selected Table Action Control Panel */}
              {table && (
                <section className="rounded-2xl border border-blue-200 dark:border-blue-900 bg-blue-50/30 dark:bg-blue-950/10 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 dark:border-blue-900/60 pb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-black text-stone-900 dark:text-stone-100">{table.tableNumber} 操作台</span>
                      <span className="rounded-full px-2.5 py-0.5 text-xs font-bold bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700">
                        {zoneNames[table.zone || "main"]} · 容納 {table.capacity} 人
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {table.status === "cleaning" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void mutate("table/clean", { tableId: table.id }, `${table.tableNumber} 已清潔完畢，恢復空桌！`)}
                          className={`${button} bg-amber-600 hover:bg-amber-700 text-white text-xs`}
                        >
                          <Check size={14} /> 完成清潔 (釋放為空桌)
                        </button>
                      )}

                      {reservationOnTable && !session && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void mutate("reservation/seat", { reservationId: reservationOnTable.id }, `預約客戶已成功開桌入座！`)}
                          className={`${button} bg-purple-600 hover:bg-purple-700 text-white text-xs`}
                        >
                          <UserCheck size={14} /> 預約客到店開桌
                        </button>
                      )}
                    </div>
                  </div>

                  {/* If vacant: Open session */}
                  {!session && table.status === "vacant" && (
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-stone-900 p-4 rounded-xl border border-stone-200 dark:border-stone-800">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-stone-900 dark:text-stone-100">
                          {table.tableNumber} 空桌待命中，設定開桌用餐人數：
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
                        onClick={() => void mutate("session", { tableId: table.id, guestCount: guests }, `${table.tableNumber} 開桌成功！掃碼計時已啟動。`)}
                        className={`${button} bg-blue-600 hover:bg-blue-700 text-white font-bold`}
                      >
                        確認開桌 (啟動掃碼計時)
                      </button>
                    </div>
                  )}

                  {/* If occupied: Order Menu & Ordering cart */}
                  {session && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50 dark:bg-emerald-950/40 p-3 rounded-xl text-xs font-semibold text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900">
                        <span>● 用餐中 (Session ID: {session.id.slice(0, 8)}...) · 掃碼憑證生效中</span>
                        <span>已用餐: {getElapsedMinutes(session)} 分鐘 (平均預估: {avgDiningMinutes}m)</span>
                      </div>

                      {/* Menu & Cart */}
                      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                        {/* Menu Categories & Items */}
                        <div className="space-y-4">
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
                                    <div className="flex items-center justify-between">
                                      <h4 className="font-bold text-stone-900 dark:text-stone-100">{item.name}</h4>
                                      <span className="font-bold text-blue-600 dark:text-blue-400">{money(item.price)}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                                      工作站: {item.category}
                                    </p>
                                  </div>

                                  <button
                                    type="button"
                                    disabled={busy || item.isSoldOut}
                                    onClick={() => add(item)}
                                    className={`mt-4 ${button} ${
                                      item.isSoldOut
                                        ? "bg-stone-200 text-stone-500 cursor-not-allowed"
                                        : "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 border border-blue-200 dark:border-blue-800"
                                    } py-1.5 text-xs font-bold w-full`}
                                  >
                                    {item.isSoldOut ? "售完" : "+ 加入點餐單"}
                                  </button>
                                </article>
                              ))}
                          </div>
                        </div>

                        {/* Order Cart Sidebar */}
                        <aside className="h-fit space-y-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
                          <h3 className="font-bold text-stone-900 dark:text-stone-100 text-base border-b border-stone-100 dark:border-stone-800 pb-2">
                            {table.tableNumber} 內用加點清單
                          </h3>

                          {!cart.length ? (
                            <p className="py-8 text-center text-xs text-stone-400">尚未選擇加點餐點</p>
                          ) : (
                            <div className="space-y-3">
                              {cart.map(c => (
                                <div key={c.key} className="flex items-center justify-between text-xs">
                                  <div>
                                    <strong className="block text-stone-900 dark:text-stone-100">{c.name}</strong>
                                    <span className="text-[11px] text-stone-500">{money(c.unitPrice)} × {c.quantity}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setCart(lines =>
                                          lines
                                            .map(l => (l.key === c.key ? { ...l, quantity: l.quantity - 1 } : l))
                                            .filter(l => l.quantity > 0)
                                        )
                                      }
                                      className="h-6 w-6 rounded bg-stone-100 dark:bg-stone-800 font-bold"
                                    >
                                      -
                                    </button>
                                    <span className="w-5 text-center font-bold">{c.quantity}</span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setCart(lines =>
                                          lines.map(l => (l.key === c.key ? { ...l, quantity: l.quantity + 1 } : l))
                                        )
                                      }
                                      className="h-6 w-6 rounded bg-stone-100 dark:bg-stone-800 font-bold"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              ))}

                              <div className="border-t border-stone-100 dark:border-stone-800 pt-3 flex justify-between text-sm font-bold">
                                <span>加點小計</span>
                                <span className="text-blue-600 dark:text-blue-400">{money(cartTotal)}</span>
                              </div>

                              <button
                                type="button"
                                disabled={busy || !cart.length}
                                onClick={() => {
                                  void mutate(
                                    "order",
                                    {
                                      sessionToken: session.sessionToken,
                                      items: cart.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity, modifiers: i.modifiers })),
                                      idempotencyKey: orderKey.current,
                                    },
                                    "加點餐點已成功送達廚房出餐系統！",
                                    () => setCart([])
                                  );
                                }}
                                className={`${button} w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs`}
                              >
                                送出加點至廚房 KDS
                              </button>
                            </div>
                          )}
                        </aside>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {/* Subtab 2: Reservation Management */}
          {frontSubtab === "reservations" && (
            <section className="grid gap-6 lg:grid-cols-[380px_1fr]">
              <form
                onSubmit={e => void reserve(e)}
                className="h-fit space-y-4 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs"
              >
                <div className="flex items-center gap-2 border-b border-stone-100 dark:border-stone-800 pb-3">
                  <CalendarDays size={18} className="text-blue-600 dark:text-blue-400" />
                  <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">預約訂位登記</h3>
                </div>

                <div className="rounded-xl bg-blue-50/80 dark:bg-blue-950/40 p-3 text-xs text-blue-800 dark:text-blue-300 leading-relaxed border border-blue-200 dark:border-blue-900">
                  ⚡ 訂位時段自動涵蓋 <strong>90 分鐘用餐時間</strong> 與 <strong>5 分鐘翻桌清潔消毒緩衝</strong>，同一桌位同時段將精準防衝撞鎖定。
                </div>

                <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300">
                  選擇桌位
                  <select
                    className={`${field} mt-1`}
                    value={reservationTable}
                    onChange={e => setReservationTable(e.target.value)}
                  >
                    {data.tables.map(tInfo => (
                      <option key={tInfo.id} value={tInfo.id} className="dark:bg-stone-900 dark:text-stone-100">
                        {tInfo.tableNumber} · {tInfo.capacity} 人座 ({zoneNames[tInfo.zone || "main"]})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300">
                  顧客姓名
                  <input
                    className={`${field} mt-1`}
                    required
                    maxLength={100}
                    value={reservationName}
                    onChange={e => setReservationName(e.target.value)}
                    placeholder="請輸入顧客尊稱"
                  />
                </label>

                <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300">
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

                <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300">
                  用餐人數
                  <input
                    className={`${field} mt-1`}
                    type="number"
                    min={1}
                    max={data.tables.find(tInfo => tInfo.id === reservationTable)?.capacity || 10}
                    required
                    value={reservationGuests}
                    onChange={e => setReservationGuests(Number(e.target.value))}
                  />
                </label>

                <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300">
                  預約用餐時間 (台北時間)
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
                  className={`${button} w-full bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs`}
                >
                  確認建立預約訂位
                </button>
              </form>

              {/* Reservations list */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 pb-2">
                  <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">預約訂位與到店管理</h3>
                  <span className="text-xs text-stone-500">共 {data.reservations.length} 筆預約</span>
                </div>

                {!data.reservations.length ? (
                  <p className="rounded-2xl border border-dashed border-stone-200 dark:border-stone-800 p-8 text-center text-sm text-stone-400">
                    目前無預約訂位
                  </p>
                ) : (
                  data.reservations.map(r => {
                    const assignedTbl = data.tables.find(t => t.id === r.tableId);
                    const isConfirmed = r.status === "confirmed";

                    return (
                      <article
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <strong className="text-base text-stone-900 dark:text-stone-100">{r.customerName}</strong>
                            <span className="rounded-full bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 text-xs font-bold text-blue-700 dark:text-blue-300">
                              {r.guestCount} 位
                            </span>
                            <span className="text-xs text-stone-500 font-mono">
                              {r.customerPhone || "—"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                            指定桌號: <strong>{assignedTbl?.tableNumber || "未定"}</strong> ({assignedTbl ? zoneNames[assignedTbl.zone || "main"] : ""}) · 時間:{" "}
                            {new Date(r.reservationTime).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                              r.status === "confirmed"
                                ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                                : r.status === "seated"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
                            }`}
                          >
                            {r.status === "confirmed" ? "已確認預約" : r.status === "seated" ? "已安排入座" : "已取消"}
                          </span>

                          {isConfirmed && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void mutate(
                                    "reservation/seat",
                                    { reservationId: r.id },
                                    `${r.customerName} 預約客戶已成功安排入座！`
                                  )
                                }
                                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition cursor-pointer flex items-center gap-1 shadow-xs"
                              >
                                <UserCheck size={13} /> 安排入座
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void mutate(
                                    "reservation/cancel",
                                    { reservationId: r.id },
                                    `已取消 ${r.customerName} 的預約。`
                                  )
                                }
                                className="px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-red-50 text-stone-600 hover:text-red-600 text-xs font-semibold transition cursor-pointer border border-stone-200 dark:border-stone-700"
                              >
                                取消預約
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

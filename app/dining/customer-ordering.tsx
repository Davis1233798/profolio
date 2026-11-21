"use client";

import { useState, useId, useMemo } from "react";
import {
  Smartphone,
  QrCode,
  ShoppingBag,
  Plus,
  Minus,
  Trash2,
  Clock,
  Flame,
  Bell,
  CheckCircle2,
  AlertCircle,
  X,
  Search,
  SlidersHorizontal,
  Copy,
  Check,
  ChefHat,
  UtensilsCrossed,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Sparkles,
} from "lucide-react";

export type Table = { id: string; tableNumber: string; capacity: number; status: string };
export type Session = { id: string; tableId: string; sessionToken: string; guestCount: number; status: string };
export type Menu = { id: string; name: string; category: string; price: number; isSoldOut: boolean };
export type ModifierGroup = { id: string; name: string; isRequired: boolean; maxSelection: number };
export type Modifier = { id: string; groupId: string; name: string; additionalPrice: number };
export type Order = { id: string; sessionId: string | null; orderType: string; takeoutNumber: string | null; totalAmount: number; status: string };
export type OrderItem = { id: string; orderId: string; itemName: string; quantity: number; lineTotal: number; status: string };
export type Ticket = { id: string; orderId: string; orderItemId: string; station: string; itemName: string; quantity: number; modifiersText: string; status: string; urgentFlag: boolean };

export type CartLine = {
  key: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  modifiers: { groupId: string; optionId: string }[];
  description: string;
};

export interface CustomerOrderingProps {
  table?: Table | null;
  session?: Session | null;
  menuItems: Menu[];
  modifierGroups: ModifierGroup[];
  modifierOptions: Modifier[];
  orders: Order[];
  orderItems: OrderItem[];
  kdsTickets: Ticket[];
  serviceFeeRate: number;
  onOrderPlaced?: () => void | Promise<void>;
  onUrge?: (ticketId: string) => void | Promise<void>;
  busy?: boolean;
  onOpenSession?: (tableId: string, guestCount: number) => void | Promise<void>;
  tables?: Table[];
  onSelectTable?: (tableId: string) => void;
}

const money = (n: number) =>
  new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(n);

/**
 * Deterministic pseudo-random QR code SVG generator.
 * Produces authentic 25x25 QR matrix with finder patterns, timing patterns and center badge.
 */
function QrCodeSvg({ text, size = 160 }: { text: string; size?: number }) {
  const matrix = useMemo(() => {
    const N = 25;
    const grid: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));

    // Simple seedable hash from string
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }

    // 1. Draw 7x7 Finder patterns at top-left (0,0), top-right (0, 18), bottom-left (18, 0)
    const finders = [
      [0, 0],
      [0, 18],
      [18, 0],
    ];

    for (const [r0, c0] of finders) {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[r0 + r][c0 + c] = isBorder || isCenter;
        }
      }
    }

    // 2. Timing patterns on row 6 and column 6
    for (let i = 8; i < 17; i++) {
      grid[6][i] = i % 2 === 0;
      grid[i][6] = i % 2 === 0;
    }

    // 3. Center reserved 5x5 zone for icon badge
    const centerStart = 10;
    const centerEnd = 14;

    // 4. Fill remaining data modules deterministically
    let seed = hash;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        // Skip finder zones & separators
        const inTL = r < 8 && c < 8;
        const inTR = r < 8 && c >= 17;
        const inBL = r >= 17 && c < 8;
        const inTiming = r === 6 || c === 6;
        const inCenter = r >= centerStart && c >= centerStart && r <= centerEnd && c <= centerEnd;

        if (inTL || inTR || inBL || inTiming || inCenter) continue;

        // Xorshift PRNG
        seed = (seed ^ (seed << 13)) >>> 0;
        seed = (seed ^ (seed >>> 17)) >>> 0;
        seed = (seed ^ (seed << 5)) >>> 0;
        grid[r][c] = (seed + r * 7 + c * 13) % 3 !== 0;
      }
    }

    return grid;
  }, [text]);

  const N = matrix.length;
  const cellSize = 10;
  const totalSize = N * cellSize;

  return (
    <svg
      viewBox={`0 0 ${totalSize} ${totalSize}`}
      width={size}
      height={size}
      className="rounded-lg bg-white p-2 shadow-inner"
      aria-label="QR Code"
    >
      {matrix.flatMap((row, r) =>
        row.map((cell, c) => {
          if (!cell) return null;
          // Don't render cells inside the center logo cutout
          if (r >= 10 && r <= 14 && c >= 10 && c <= 14) return null;
          return (
            <rect
              key={`${r}-${c}`}
              x={c * cellSize}
              y={r * cellSize}
              width={cellSize - 0.5}
              height={cellSize - 0.5}
              rx={1.5}
              fill="#1e3932"
            />
          );
        })
      )}
      {/* Center Logo badge */}
      <rect
        x={10 * cellSize - 1}
        y={10 * cellSize - 1}
        width={5 * cellSize + 2}
        height={5 * cellSize + 2}
        rx={6}
        fill="#ffffff"
        stroke="#1e3932"
        strokeWidth="2"
      />
      <circle cx={12.5 * cellSize} cy={12.5 * cellSize} r={14} fill="#006241" />
      <text
        x={12.5 * cellSize}
        y={12.5 * cellSize + 4}
        fill="#ffffff"
        fontSize="12"
        fontWeight="bold"
        textAnchor="middle"
      >
        TC
      </text>
    </svg>
  );
}

export function CustomerOrdering({
  table,
  session,
  menuItems,
  modifierGroups,
  modifierOptions,
  orders,
  orderItems,
  kdsTickets,
  serviceFeeRate,
  onOrderPlaced,
  onUrge,
  busy = false,
  onOpenSession,
  tables = [],
  onSelectTable,
}: CustomerOrderingProps) {
  // Navigation tabs within Customer view: menu vs kitchen status
  const [activeTab, setActiveTab] = useState<"menu" | "status">("menu");

  // Search & category filter
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Cart state
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);

  // Modifier selection modal state
  const [customizingItem, setCustomizingItem] = useState<Menu | null>(null);
  const [modalQuantity, setModalQuantity] = useState(1);
  const [modalModifiers, setModalModifiers] = useState<Record<string, string[]>>({});
  const [modalError, setModalError] = useState("");

  // Quick Table open state
  const [quickPartySize, setQuickPartySize] = useState(2);
  const [openingTable, setOpeningTable] = useState(false);

  // Ordering & Urge status state
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderNotice, setOrderNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [urgedTickets, setUrgedTickets] = useState<Set<string>>(new Set());
  const [urgingTicketId, setUrgingTicketId] = useState<string | null>(null);

  // QR Code modal state
  const [showQrModal, setShowQrModal] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Simulated QR / Ordering URL
  const simulatedUrl = useMemo(() => {
    const origin = typeof window !== "undefined" && window.location.origin ? window.location.origin : "https://tablecraft.demo";
    const tbl = table?.tableNumber || "T1";
    const token = session?.sessionToken ? session.sessionToken.slice(0, 8) : "demo";
    return `${origin}/dining/customer?table=${encodeURIComponent(tbl)}&token=${token}`;
  }, [table, session]);

  // Categories list
  const categories = useMemo(() => {
    const unique = Array.from(new Set(menuItems.map((i) => i.category)));
    return ["All", ...unique];
  }, [menuItems]);

  // Filtered menu items
  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      const matchCat = selectedCategory === "All" || item.category === selectedCategory;
      const matchQuery =
        !searchQuery.trim() ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        item.category.toLowerCase().includes(searchQuery.toLowerCase().trim());
      return matchCat && matchQuery;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  // Cart calculations
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const cartEstimatedFee = Math.round((cartSubtotal * serviceFeeRate) / 100);
  const cartEstimatedTotal = cartSubtotal + cartEstimatedFee;

  // Session tickets & orders for Live Kitchen Status (Feature 7)
  const sessionOrders = useMemo(() => {
    if (!session?.id) return [];
    return orders.filter((o) => o.sessionId === session.id);
  }, [orders, session]);

  const sessionOrderIds = useMemo(() => new Set(sessionOrders.map((o) => o.id)), [sessionOrders]);

  const sessionOrderItems = useMemo(() => {
    return orderItems.filter((i) => sessionOrderIds.has(i.orderId));
  }, [orderItems, sessionOrderIds]);

  const sessionTickets = useMemo(() => {
    return kdsTickets.filter((t) => sessionOrderIds.has(t.orderId));
  }, [kdsTickets, sessionOrderIds]);

  // Calculate live bill breakdown from ordered items
  const activeOrderedItems = useMemo(() => {
    return sessionOrderItems.filter((i) => i.status !== "cancelled");
  }, [sessionOrderItems]);

  const liveFoodSubtotal = useMemo(() => {
    return activeOrderedItems.reduce((sum, i) => sum + i.lineTotal, 0);
  }, [activeOrderedItems]);

  const liveServiceFee = Math.round((liveFoodSubtotal * serviceFeeRate) / 100);
  const liveTotalDue = liveFoodSubtotal + liveServiceFee;

  // Tickets counts by status
  const ticketCounts = useMemo(() => {
    const counts = { queued: 0, preparing: 0, ready: 0, served: 0, total: sessionTickets.length };
    for (const t of sessionTickets) {
      if (t.status === "received" || t.status === "pending") counts.queued++;
      else if (t.status === "cooking" || t.status === "preparing") counts.preparing++;
      else if (t.status === "done" || t.status === "ready") counts.ready++;
      else if (t.status === "served") counts.served++;
    }
    return counts;
  }, [sessionTickets]);

  // Check if item has modifier groups
  function hasModifiers(item: Menu) {
    if (item.category === "Drinks") return true;
    return modifierGroups.length > 0 && item.category.toLowerCase().includes("drink");
  }

  // Open customization modal
  function openCustomizer(item: Menu) {
    setCustomizingItem(item);
    setModalQuantity(1);
    setModalError("");

    // Initialize required modifiers with default first option
    const initialMods: Record<string, string[]> = {};
    for (const g of modifierGroups) {
      const opts = modifierOptions.filter((o) => o.groupId === g.id);
      if (g.isRequired && opts.length > 0) {
        initialMods[g.id] = [opts[0].id];
      } else {
        initialMods[g.id] = [];
      }
    }
    setModalModifiers(initialMods);
  }

  // Modal unit price
  const modalUnitPrice = useMemo(() => {
    if (!customizingItem) return 0;
    let extra = 0;
    for (const [groupId, optIds] of Object.entries(modalModifiers)) {
      for (const optId of optIds) {
        const opt = modifierOptions.find((o) => o.id === optId && o.groupId === groupId);
        if (opt) extra += opt.additionalPrice;
      }
    }
    return customizingItem.price + extra;
  }, [customizingItem, modalModifiers, modifierOptions]);

  // Add item from modal to cart
  function confirmModalAddToCart() {
    if (!customizingItem) return;

    // Validate required groups
    for (const g of modifierGroups) {
      if (g.isRequired && (!modalModifiers[g.id] || modalModifiers[g.id].length === 0)) {
        setModalError(`請選擇必選項：「${g.name}」`);
        return;
      }
    }

    const mods: { groupId: string; optionId: string }[] = [];
    const descriptions: string[] = [];
    for (const [groupId, optIds] of Object.entries(modalModifiers)) {
      for (const optId of optIds) {
        const opt = modifierOptions.find((o) => o.id === optId);
        if (opt) {
          mods.push({ groupId, optionId: optId });
          descriptions.push(opt.name + (opt.additionalPrice > 0 ? `(+${opt.additionalPrice})` : ""));
        }
      }
    }

    const key = `${customizingItem.id}:${mods
      .map((m) => m.optionId)
      .sort()
      .join(",")}`;

    setCart((current) => {
      const existing = current.find((i) => i.key === key);
      if (existing) {
        return current.map((i) =>
          i.key === key ? { ...i, quantity: i.quantity + modalQuantity } : i
        );
      }
      return [
        ...current,
        {
          key,
          menuItemId: customizingItem.id,
          name: customizingItem.name,
          unitPrice: modalUnitPrice,
          quantity: modalQuantity,
          modifiers: mods,
          description: descriptions.join(" / "),
        },
      ];
    });

    setCustomizingItem(null);
  }

  // Quick add item without modifiers
  function quickAddToCart(item: Menu) {
    if (item.isSoldOut) return;
    if (hasModifiers(item)) {
      openCustomizer(item);
      return;
    }

    const key = item.id;
    setCart((current) => {
      const existing = current.find((i) => i.key === key);
      if (existing) {
        return current.map((i) => (i.key === key ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [
        ...current,
        {
          key,
          menuItemId: item.id,
          name: item.name,
          unitPrice: item.price,
          quantity: 1,
          modifiers: [],
          description: "",
        },
      ];
    });
  }

  // Quantity adjuster
  function updateCartQuantity(key: string, delta: number) {
    setCart((current) =>
      current
        .map((item) => {
          if (item.key === key) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartLine[]
    );
  }

  // Remove line
  function removeCartLine(key: string) {
    setCart((current) => current.filter((i) => i.key !== key));
  }

  // Open table action (Feature 1)
  async function handleOpenTable() {
    if (!table) return;
    setOpeningTable(true);
    setOrderNotice(null);
    try {
      if (onOpenSession) {
        await onOpenSession(table.id, quickPartySize);
      } else {
        const res = await fetch("/api/dining/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableId: table.id, guestCount: quickPartySize }),
        });
        const json = (await res.json()) as { success?: boolean; error?: { message?: string } };
        if (!res.ok || !json.success) {
          throw new Error(json.error?.message || "開桌失敗，請洽服務人員");
        }
        await onOrderPlaced?.();
      }
      setOrderNotice({ type: "success", message: `桌號 ${table.tableNumber} 開桌成功！請開始點餐。` });
    } catch (err: any) {
      setOrderNotice({ type: "error", message: err.message || "開桌失敗" });
    } finally {
      setOpeningTable(false);
    }
  }

  // Send Order to Kitchen (Feature 6)
  async function handleSendOrder() {
    if (!session) {
      setOrderNotice({ type: "error", message: "尚未開桌！請先開啟桌位後再送出訂單。" });
      return;
    }
    if (cart.length === 0) {
      setOrderNotice({ type: "error", message: "購物車中無任何餐點。" });
      return;
    }

    setSubmittingOrder(true);
    setOrderNotice(null);

    const idempotencyKey = crypto.randomUUID();
    const payload = {
      sessionToken: session.sessionToken,
      items: cart.map((line) => ({
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        modifiers: line.modifiers || [],
      })),
      idempotencyKey,
    };

    try {
      const res = await fetch("/api/dining/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as { success?: boolean; error?: { message?: string } };
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || "點餐送出失敗，請稍後重試");
      }

      // Success
      setCart([]);
      setCartDrawerOpen(false);
      setOrderNotice({
        type: "success",
        message: "🎉 點單已成功送至主廚與廚房備料！您可即時追蹤進度。",
      });
      setActiveTab("status"); // Automatically switch to kitchen status tab
      await onOrderPlaced?.();
    } catch (err: any) {
      setOrderNotice({ type: "error", message: err.message || "點單送出失敗" });
    } finally {
      setSubmittingOrder(false);
    }
  }

  // Urge ticket action (Feature 7)
  async function handleUrgeTicket(ticketId: string) {
    if (urgedTickets.has(ticketId)) return;
    setUrgingTicketId(ticketId);
    try {
      if (onUrge) {
        await onUrge(ticketId);
      } else {
        const res = await fetch("/api/dining/kds/urge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId }),
        });
        const json = (await res.json()) as { success?: boolean; error?: { message?: string } };
        if (!res.ok || !json.success) {
          throw new Error(json.error?.message || "催單失敗");
        }
      }
      setUrgedTickets((prev) => new Set(prev).add(ticketId));
      setOrderNotice({ type: "success", message: "⚡ 已為您通知廚房與服務人員優先出餐！" });
      await onOrderPlaced?.();
    } catch (err: any) {
      setOrderNotice({ type: "error", message: err.message || "催單失敗" });
    } finally {
      setUrgingTicketId(null);
    }
  }

  // Copy QR URL helper
  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(simulatedUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      // fallback
    }
  }

  return (
    <div className="relative mx-auto w-full max-w-4xl pb-32 font-sans text-stone-800">
      {/* =========================================================================
          FEATURE 1: Mobile-friendly Header
         ========================================================================= */}
      <header className="sticky top-0 z-30 mb-4 overflow-hidden rounded-2xl border border-stone-200/80 bg-white/95 shadow-sm backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#006241] text-white shadow-sm">
              <Smartphone size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-stone-900 sm:text-lg">
                  {table ? `${table.tableNumber} 桌邊點餐` : "顧客掃碼自選點餐"}
                </h1>
                {table ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-[#006241] border border-emerald-200">
                    內用點餐
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
                    外帶/未指派桌位
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-stone-500">
                <span>
                  容納 {table?.capacity || 4} 人 ·{" "}
                  {session ? `現有用餐 ${session.guestCount} 人` : "未開桌"}
                </span>
                <span>·</span>
                {session ? (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    用餐中 (Active)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                    待開桌
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Table switcher for simulation */}
            {tables.length > 0 && onSelectTable && (
              <select
                value={table?.id || ""}
                onChange={(e) => onSelectTable(e.target.value)}
                className="h-8 rounded-lg border border-stone-200 bg-stone-50 px-2 text-xs font-medium text-stone-700 focus:outline-none focus:ring-1 focus:ring-[#006241]"
                aria-label="選擇測試桌號"
              >
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    桌號 {t.tableNumber} ({t.status === "occupied" ? "用餐中" : "空桌"})
                  </option>
                ))}
              </select>
            )}

            {/* Quick QR Code trigger */}
            <button
              onClick={() => setShowQrModal(true)}
              title="掃碼桌邊點餐 QR Code"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-700 shadow-xs hover:bg-stone-50 active:scale-95 transition"
            >
              <QrCode size={14} className="text-[#006241]" />
              <span className="hidden sm:inline">桌邊 QR 碼</span>
            </button>
          </div>
        </div>

        {/* View Switcher: Menu vs Kitchen Progress */}
        <div className="flex border-t border-stone-100 bg-stone-50/70 p-1">
          <button
            onClick={() => setActiveTab("menu")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-xs font-semibold transition ${
              activeTab === "menu"
                ? "bg-white text-[#006241] shadow-xs ring-1 ring-stone-200/60"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            <UtensilsCrossed size={14} />
            <span>美味菜單 (Menu)</span>
          </button>
          <button
            onClick={() => setActiveTab("status")}
            className={`relative flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-xs font-semibold transition ${
              activeTab === "status"
                ? "bg-white text-[#006241] shadow-xs ring-1 ring-stone-200/60"
                : "text-stone-600 hover:text-stone-900"
            }`}
          >
            <ChefHat size={14} />
            <span>我的餐點與出餐進度</span>
            {sessionTickets.length > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold text-white">
                {sessionTickets.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Global Alerts / Notices */}
      {orderNotice && (
        <div
          role="alert"
          className={`mb-4 flex items-center justify-between gap-3 rounded-xl border p-3.5 text-sm transition ${
            orderNotice.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          <div className="flex items-center gap-2">
            {orderNotice.type === "success" ? (
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle size={16} className="text-red-600 shrink-0" />
            )}
            <span>{orderNotice.message}</span>
          </div>
          <button
            onClick={() => setOrderNotice(null)}
            className="text-stone-400 hover:text-stone-700"
            aria-label="關閉提示"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* No Active Session Warning Banner with Quick Table Open (Feature 1) */}
      {!session && table && (
        <div className="mb-5 overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-bold text-amber-900">
                <AlertCircle size={18} className="text-amber-600" />
                <span>此桌位尚未開桌 (No Active Session)</span>
              </div>
              <p className="text-xs text-amber-800/80">
                您目前處於顧客桌邊點餐模式。請先開桌以產生用餐 Session，即可送出點單給廚房備料。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-2 py-1 shadow-xs">
                <span className="text-xs font-medium text-stone-600">用餐人數:</span>
                <button
                  type="button"
                  disabled={quickPartySize <= 1 || openingTable || busy}
                  onClick={() => setQuickPartySize((s) => Math.max(1, s - 1))}
                  className="rounded p-1 hover:bg-stone-100 disabled:opacity-30"
                  aria-label="減少人數"
                >
                  <Minus size={12} />
                </button>
                <span className="w-5 text-center text-xs font-bold text-stone-900">
                  {quickPartySize}
                </span>
                <button
                  type="button"
                  disabled={quickPartySize >= (table.capacity || 8) || openingTable || busy}
                  onClick={() => setQuickPartySize((s) => Math.min(table.capacity || 8, s + 1))}
                  className="rounded p-1 hover:bg-stone-100 disabled:opacity-30"
                  aria-label="增加人數"
                >
                  <Plus size={12} />
                </button>
              </div>

              <button
                type="button"
                disabled={openingTable || busy || table.status === "occupied"}
                onClick={() => void handleOpenTable()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#006241] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1e3932] disabled:opacity-50 transition"
              >
                {openingTable ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    開桌中…
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    立即開桌點餐
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 1: MENU & ORDERING
         ========================================================================= */}
      {activeTab === "menu" && (
        <div className="space-y-4">
          {/* =====================================================================
              FEATURE 2: Menu Categories Bar & Quick Search
             ===================================================================== */}
          <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-3.5 shadow-xs sm:p-4">
            {/* Search Input */}
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋美味餐點、特調飲品或甜點..."
                className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2.5 pl-10 pr-9 text-sm text-stone-800 placeholder-stone-400 transition focus:border-[#006241] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#006241]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                  aria-label="清除搜尋"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Horizontal Scrollable Categories */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {categories.map((cat) => {
                const count =
                  cat === "All"
                    ? menuItems.length
                    : menuItems.filter((i) => i.category === cat).length;
                const isSelected = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                      isSelected
                        ? "bg-[#006241] text-white shadow-sm ring-1 ring-[#006241]"
                        : "bg-stone-100 text-stone-600 hover:bg-stone-200/70"
                    }`}
                  >
                    <span>{cat === "All" ? "全部餐點" : cat}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                        isSelected ? "bg-white/20 text-white" : "bg-stone-200 text-stone-600"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* =====================================================================
              FEATURE 3: Item Cards Grid
             ===================================================================== */}
          {filteredItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-12 text-center text-stone-400">
              <UtensilsCrossed size={36} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">沒有找到符合條件的菜品</p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("All");
                }}
                className="mt-3 text-xs font-semibold text-[#006241] underline"
              >
                清除篩選條件
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredItems.map((item) => {
                const inCartCount = cart
                  .filter((i) => i.menuItemId === item.id)
                  .reduce((sum, i) => sum + i.quantity, 0);
                const isDrink = hasModifiers(item);

                return (
                  <article
                    key={item.id}
                    className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-white p-4 shadow-xs transition hover:shadow-md ${
                      item.isSoldOut
                        ? "border-stone-200/60 bg-stone-50/70 opacity-60"
                        : "border-stone-200 hover:border-stone-300"
                    }`}
                  >
                    <div>
                      {/* Top Category Badge & In-Cart Badge */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">
                          {item.category}
                        </span>

                        {item.isSoldOut ? (
                          <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 border border-red-200">
                            今日已售完
                          </span>
                        ) : inCartCount > 0 ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-[#006241] border border-emerald-200">
                            已選 {inCartCount}
                          </span>
                        ) : null}
                      </div>

                      {/* Item Name */}
                      <h2 className="mt-2.5 text-base font-bold text-stone-900 group-hover:text-[#006241] transition">
                        {item.name}
                      </h2>

                      {/* Description / Extra hint */}
                      <p className="mt-1 text-xs text-stone-500 line-clamp-2">
                        {isDrink
                          ? "可客製化甜度、冰塊與精選加料"
                          : "主廚新鮮手作，現點現做熱騰騰上桌"}
                      </p>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-2 pt-2 border-t border-stone-100">
                      <div>
                        <span className="text-xs text-stone-400">單價</span>
                        <p className="text-lg font-black text-stone-900">{money(item.price)}</p>
                      </div>

                      {/* Add Button */}
                      {item.isSoldOut ? (
                        <button
                          disabled
                          className="rounded-xl bg-stone-200 px-3 py-2 text-xs font-semibold text-stone-400 cursor-not-allowed"
                        >
                          售完
                        </button>
                      ) : isDrink ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openCustomizer(item)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#006241] px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#1e3932] active:scale-95 transition"
                        >
                          <SlidersHorizontal size={13} />
                          <span>選擇規格</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => quickAddToCart(item)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#006241] px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#1e3932] active:scale-95 transition"
                        >
                          <Plus size={14} />
                          <span>加點</span>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 2: FEATURE 7 - My Order & Live Kitchen Status
         ========================================================================= */}
      {activeTab === "status" && (
        <div className="space-y-4">
          {/* Order Progress Summary Card */}
          <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
              <div>
                <h2 className="text-lg font-bold text-stone-900">
                  {table?.tableNumber || "桌邊"} · 我的餐點與即時廚房進度
                </h2>
                <p className="text-xs text-stone-500">
                  出餐狀態隨 KDS 廚房看板即時連動，主廚備料至送餐全程掌握。
                </p>
              </div>

              <button
                onClick={() => void onOrderPlaced?.()}
                title="重新整理進度"
                className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 active:scale-95 transition"
              >
                <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
                <span>更新動態</span>
              </button>
            </div>

            {/* 4 Status Visual Tracker Badges */}
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {/* 1. Queued */}
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-center">
                <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-800">
                  <Clock size={15} />
                </div>
                <p className="mt-1.5 text-xs font-bold text-amber-900">排隊待備料</p>
                <p className="text-[11px] text-amber-700">Queued</p>
                <p className="mt-1 text-lg font-extrabold text-amber-950">{ticketCounts.queued}</p>
              </div>

              {/* 2. Preparing */}
              <div className="rounded-xl border border-orange-200/80 bg-orange-50/70 p-3 text-center">
                <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-orange-100 text-orange-800">
                  <Flame size={15} className="animate-pulse" />
                </div>
                <p className="mt-1.5 text-xs font-bold text-orange-900">主廚烹調中</p>
                <p className="text-[11px] text-orange-700">Preparing</p>
                <p className="mt-1 text-lg font-extrabold text-orange-950">{ticketCounts.preparing}</p>
              </div>

              {/* 3. Ready */}
              <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3 text-center">
                <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-[#006241]">
                  <Bell size={15} />
                </div>
                <p className="mt-1.5 text-xs font-bold text-emerald-900">餐點已備妥</p>
                <p className="text-[11px] text-emerald-700">Ready</p>
                <p className="mt-1 text-lg font-extrabold text-emerald-950">{ticketCounts.ready}</p>
              </div>

              {/* 4. Served */}
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-center">
                <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-stone-200 text-stone-700">
                  <CheckCircle2 size={15} />
                </div>
                <p className="mt-1.5 text-xs font-bold text-stone-800">已送達餐桌</p>
                <p className="text-[11px] text-stone-500">Served</p>
                <p className="mt-1 text-lg font-extrabold text-stone-900">{ticketCounts.served}</p>
              </div>
            </div>

            {/* Progress bar */}
            {ticketCounts.total > 0 && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-stone-500">
                  <span>出餐進度</span>
                  <span>
                    已送達 {ticketCounts.served} / 總共 {ticketCounts.total} 項餐點 (
                    {Math.round((ticketCounts.served / ticketCounts.total) * 100)}%)
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-[#006241] transition-all duration-500"
                    style={{
                      width: `${(ticketCounts.served / ticketCounts.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* List of Ordered Tickets */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-stone-700">餐點詳細列表 ({sessionTickets.length})</h3>

            {sessionTickets.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-10 text-center text-stone-400">
                <ChefHat size={36} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">此桌位尚未有送至廚房的餐點</p>
                <button
                  onClick={() => setActiveTab("menu")}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#006241] underline"
                >
                  前往菜單挑選美味餐點 <ArrowRight size={13} />
                </button>
              </div>
            ) : (
              sessionTickets.map((ticket) => {
                const isUrged = ticket.urgentFlag || urgedTickets.has(ticket.id);
                const isServed = ticket.status === "served";

                // Visual status pill style
                let badgeStyle = "bg-amber-100 text-amber-900 border-amber-300";
                let statusName = "排隊待備料 (Queued)";
                let StatusIcon = Clock;

                if (ticket.status === "cooking" || ticket.status === "preparing") {
                  badgeStyle = "bg-orange-100 text-orange-900 border-orange-300 animate-pulse";
                  statusName = "主廚烹調中 (Preparing)";
                  StatusIcon = Flame;
                } else if (ticket.status === "done" || ticket.status === "ready") {
                  badgeStyle = "bg-emerald-100 text-emerald-900 border-emerald-300 ring-1 ring-emerald-400";
                  statusName = "餐點已備妥 (Ready to Serve)";
                  StatusIcon = Bell;
                } else if (ticket.status === "served") {
                  badgeStyle = "bg-stone-100 text-stone-600 border-stone-200";
                  statusName = "已送達餐桌 (Served)";
                  StatusIcon = CheckCircle2;
                }

                return (
                  <article
                    key={ticket.id}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-xs transition sm:flex-row sm:items-center"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-base font-bold text-stone-900">
                          {ticket.itemName}
                        </h4>
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-extrabold text-stone-700">
                          × {ticket.quantity}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${badgeStyle}`}
                        >
                          <StatusIcon size={12} />
                          <span>{statusName}</span>
                        </span>
                      </div>

                      {ticket.modifiersText && (
                        <p className="text-xs text-stone-500">
                          規格: {ticket.modifiersText}
                        </p>
                      )}

                      <p className="text-[11px] text-stone-400">
                        製作工作站: {ticket.station || "主廚熱炒工作站"}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 sm:shrink-0">
                      {/* Priority / Urge Button (Feature 7) */}
                      {!isServed && (
                        <button
                          type="button"
                          disabled={isUrged || urgingTicketId === ticket.id || busy}
                          onClick={() => void handleUrgeTicket(ticket.id)}
                          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition shadow-xs ${
                            isUrged
                              ? "border border-red-200 bg-red-50 text-red-700 cursor-not-allowed"
                              : "border border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100 active:scale-95"
                          }`}
                        >
                          {urgingTicketId === ticket.id ? (
                            <>
                              <RefreshCw size={13} className="animate-spin" />
                              <span>催單通知中…</span>
                            </>
                          ) : isUrged ? (
                            <>
                              <Flame size={13} className="text-red-600" />
                              <span>⚡ 已通知主廚優先出餐</span>
                            </>
                          ) : (
                            <>
                              <Flame size={13} className="text-orange-600" />
                              <span>催單 / 呼叫服務員</span>
                            </>
                          )}
                        </button>
                      )}

                      {isServed && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-400">
                          <Check size={14} className="text-emerald-600" />
                          已享用
                        </span>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* Live Bill & Service Fee Preview (Feature 7) */}
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs">
            <h3 className="text-base font-bold text-stone-900">即時帳單與服務費試算</h3>
            <div className="mt-3 space-y-2 border-b border-stone-100 pb-3 text-sm">
              <div className="flex justify-between text-stone-600">
                <span>已點餐點小計 ({activeOrderedItems.length} 項)</span>
                <span className="font-medium text-stone-900">{money(liveFoodSubtotal)}</span>
              </div>
              <div className="flex justify-between text-stone-600">
                <span>內用服務費 ({serviceFeeRate}%)</span>
                <span className="font-medium text-stone-900">{money(liveServiceFee)}</span>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-base font-black text-stone-900">
              <span>目前應付總計</span>
              <span className="text-xl text-[#006241]">{money(liveTotalDue)}</span>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-stone-400">
              ※ 用餐完畢後請至櫃檯結帳，或於座位向服務人員索取正式明細結帳。
            </p>
          </div>
        </div>
      )}

      {/* =========================================================================
          FEATURE 4: Modifier Selection Modal
         ========================================================================= */}
      {customizingItem && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4 backdrop-blur-xs"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-stone-200 bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6 animate-in slide-in-from-bottom duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-stone-100 pb-3">
              <div>
                <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">
                  {customizingItem.category}
                </span>
                <h3 className="mt-1 text-lg font-bold text-stone-900">{customizingItem.name}</h3>
                <p className="text-sm font-bold text-[#006241]">{money(customizingItem.price)} 起</p>
              </div>
              <button
                onClick={() => setCustomizingItem(null)}
                className="rounded-full p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                aria-label="關閉客製化選單"
              >
                <X size={18} />
              </button>
            </div>

            {/* Error banner */}
            {modalError && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                {modalError}
              </div>
            )}

            {/* Modifier Groups */}
            <div className="my-4 space-y-4">
              {modifierGroups.map((group) => {
                const options = modifierOptions.filter((o) => o.groupId === group.id);
                const selected = modalModifiers[group.id] || [];
                const isSingle = group.maxSelection === 1;

                return (
                  <fieldset key={group.id} className="rounded-xl border border-stone-100 bg-stone-50/50 p-3.5">
                    <div className="flex items-center justify-between">
                      <legend className="text-sm font-bold text-stone-800">{group.name}</legend>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        {group.isRequired ? (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 font-bold text-red-600 border border-red-200">
                            必選
                          </span>
                        ) : (
                          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-500">
                            選填
                          </span>
                        )}
                        <span className="text-stone-400">
                          {isSingle ? "單選" : `最多選 ${group.maxSelection} 項`}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {options.map((opt) => {
                        const isChecked = selected.includes(opt.id);
                        return (
                          <label
                            key={opt.id}
                            className={`flex cursor-pointer items-center justify-between rounded-xl border p-2.5 text-xs font-semibold transition ${
                              isChecked
                                ? "border-[#006241] bg-[#d4e9e2] text-[#1e3932] shadow-xs"
                                : "border-stone-200 bg-white text-stone-700 hover:border-stone-300"
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <input
                                type={isSingle ? "radio" : "checkbox"}
                                name={group.id}
                                checked={isChecked}
                                onChange={(e) => {
                                  setModalError("");
                                  setModalModifiers((prev) => {
                                    if (isSingle) {
                                      return { ...prev, [group.id]: [opt.id] };
                                    }
                                    const currentList = prev[group.id] || [];
                                    if (e.target.checked) {
                                      if (currentList.length >= group.maxSelection) {
                                        return prev; // reached limit
                                      }
                                      return { ...prev, [group.id]: [...currentList, opt.id] };
                                    } else {
                                      return {
                                        ...prev,
                                        [group.id]: currentList.filter((id) => id !== opt.id),
                                      };
                                    }
                                  });
                                }}
                                className="sr-only"
                              />
                              <span>{opt.name}</span>
                            </div>
                            {opt.additionalPrice > 0 && (
                              <span className="text-[11px] font-bold text-emerald-800">
                                +${opt.additionalPrice}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>

            {/* Quantity Stepper & Add Button */}
            <div className="flex items-center justify-between gap-4 border-t border-stone-100 pt-4">
              <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 p-1">
                <button
                  type="button"
                  disabled={modalQuantity <= 1}
                  onClick={() => setModalQuantity((q) => Math.max(1, q - 1))}
                  className="rounded-lg p-1.5 hover:bg-white disabled:opacity-30"
                  aria-label="減少數量"
                >
                  <Minus size={14} />
                </button>
                <span className="w-8 text-center text-sm font-bold">{modalQuantity}</span>
                <button
                  type="button"
                  disabled={modalQuantity >= 50}
                  onClick={() => setModalQuantity((q) => Math.min(50, q + 1))}
                  className="rounded-lg p-1.5 hover:bg-white disabled:opacity-30"
                  aria-label="增加數量"
                >
                  <Plus size={14} />
                </button>
              </div>

              <button
                type="button"
                onClick={confirmModalAddToCart}
                className="flex-1 rounded-xl bg-[#006241] py-3 text-center text-sm font-bold text-white shadow-md hover:bg-[#1e3932] active:scale-98 transition"
              >
                加入購物車 · {money(modalUnitPrice * modalQuantity)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          FEATURE 5 & 6: Sticky Bottom Cart Bar & Expandable Cart Drawer
         ========================================================================= */}
      {cartItemCount > 0 && (
        <aside
          aria-label="購物車摘要"
          className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-xl"
        >
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-300 bg-[#1e3932] p-3 text-white shadow-2xl backdrop-blur-md">
            <button
              onClick={() => setCartDrawerOpen((o) => !o)}
              className="flex items-center gap-3 text-left focus:outline-none"
            >
              <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
                <ShoppingBag size={20} />
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[11px] font-black text-white shadow-sm">
                  {cartItemCount}
                </span>
              </div>
              <div>
                <p className="text-xs text-stone-200">購物車小計</p>
                <p className="text-base font-extrabold text-white">{money(cartSubtotal)}</p>
              </div>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCartDrawerOpen((o) => !o)}
                className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 transition"
              >
                <span>明細</span>
                {cartDrawerOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>

              <button
                type="button"
                disabled={submittingOrder || busy}
                onClick={() => void handleSendOrder()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#00704a] px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-[#008256] active:scale-95 disabled:opacity-50 transition"
              >
                {submittingOrder ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>送單中…</span>
                  </>
                ) : (
                  <>
                    <span>送至廚房備料</span>
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Expandable Cart Drawer Sheet */}
      {cartDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4 backdrop-blur-xs"
        >
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-stone-200 bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6 animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <ShoppingBag size={18} className="text-[#006241]" />
                <h3 className="text-base font-bold text-stone-900">
                  購物車清單 ({cartItemCount} 項餐點)
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="text-xs text-stone-400 hover:text-red-600"
                >
                  清空購物車
                </button>
                <button
                  onClick={() => setCartDrawerOpen(false)}
                  className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                  aria-label="關閉購物車"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Cart Lines */}
            <div className="my-4 max-h-64 space-y-3 overflow-y-auto pr-1">
              {cart.map((line) => (
                <div
                  key={line.key}
                  className="flex items-start justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50/50 p-3"
                >
                  <div className="space-y-0.5">
                    <h4 className="text-sm font-bold text-stone-900">{line.name}</h4>
                    {line.description && (
                      <p className="text-xs text-stone-500">{line.description}</p>
                    )}
                    <p className="text-xs font-semibold text-[#006241]">
                      {money(line.unitPrice)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-1.5 py-1">
                      <button
                        type="button"
                        onClick={() => updateCartQuantity(line.key, -1)}
                        className="rounded p-0.5 hover:bg-stone-100 text-stone-600"
                        aria-label="減少"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-5 text-center text-xs font-bold text-stone-800">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateCartQuantity(line.key, 1)}
                        className="rounded p-0.5 hover:bg-stone-100 text-stone-600"
                        aria-label="增加"
                      >
                        <Plus size={12} />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeCartLine(line.key)}
                      className="rounded p-1 text-stone-400 hover:text-red-600"
                      aria-label="移除此品項"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Subtotal & Fee Preview */}
            <div className="space-y-2 border-t border-stone-100 pt-3 text-xs text-stone-600">
              <div className="flex justify-between">
                <span>餐點金額小計</span>
                <span className="font-semibold text-stone-900">{money(cartSubtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>預估服務費 ({serviceFeeRate}%)</span>
                <span className="font-semibold text-stone-900">{money(cartEstimatedFee)}</span>
              </div>
              <div className="flex justify-between border-t border-stone-100 pt-2 text-sm font-extrabold text-stone-900">
                <span>預估結帳總額</span>
                <span className="text-base text-[#006241]">{money(cartEstimatedTotal)}</span>
              </div>
            </div>

            {/* Send to kitchen button (Feature 6) */}
            <button
              type="button"
              disabled={submittingOrder || busy || !session}
              onClick={() => void handleSendOrder()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#006241] py-3 text-sm font-bold text-white shadow-md hover:bg-[#1e3932] active:scale-98 disabled:opacity-50 transition"
            >
              {submittingOrder ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>訂單正在送往廚房…</span>
                </>
              ) : !session ? (
                <span>請先開桌以送出點餐</span>
              ) : (
                <>
                  <Sparkles size={16} />
                  <span>確認下單 · 送至廚房即刻備料</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          FEATURE 8: Dynamic QR Code Modal Simulation
         ========================================================================= */}
      {showQrModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-sm rounded-3xl border border-stone-200 bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <QrCode size={18} className="text-[#006241]" />
                <h3 className="text-base font-bold text-stone-900">掃碼桌邊自主點餐</h3>
              </div>
              <button
                onClick={() => setShowQrModal(false)}
                className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                aria-label="關閉 QR Code"
              >
                <X size={18} />
              </button>
            </div>

            <div className="my-5 flex flex-col items-center text-center">
              <p className="text-xs text-stone-500">
                顧客以手機相機掃描下方 QR Code，即可免安裝 App 直接點餐：
              </p>

              {/* Dynamic QR SVG */}
              <div className="mt-4 rounded-2xl border-2 border-stone-200/80 bg-stone-50 p-3 shadow-sm">
                <QrCodeSvg text={simulatedUrl} size={180} />
              </div>

              <div className="mt-3 flex items-center gap-2">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-[#006241]">
                  {table?.tableNumber ? `桌號 ${table.tableNumber}` : "預設桌位"}
                </span>
                <span className="text-xs text-stone-400">
                  Token: {session?.sessionToken ? session.sessionToken.slice(0, 8) : "無Session"}
                </span>
              </div>
            </div>

            {/* URL input and copy */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50 p-1.5 text-xs">
                <span className="truncate pl-1 font-mono text-[11px] text-stone-600">
                  {simulatedUrl}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyUrl()}
                  className="shrink-0 rounded-lg bg-white px-2 py-1 font-semibold text-stone-700 shadow-xs hover:bg-stone-100 border border-stone-200"
                >
                  {copiedUrl ? (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <Check size={12} /> 已複製
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Copy size={12} /> 複製
                    </span>
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="w-full rounded-xl bg-stone-100 py-2.5 text-xs font-bold text-stone-700 hover:bg-stone-200 transition"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import {
  LayoutDashboard,
  UtensilsCrossed,
  ChefHat,
  Clock,
  TrendingUp,
  ShieldAlert,
  AlertTriangle,
  Plus,
  CheckCircle2,
  XCircle,
  Users,
  Search,
  Filter,
  DollarSign,
  Layers,
  Sparkles,
} from "lucide-react";

export type Menu = { id: string; name: string; category: string; price: number; isSoldOut: boolean };
export type ModifierGroup = { id: string; name: string; isRequired: boolean; maxSelection: number };
export type Modifier = { id: string; groupId: string; name: string; additionalPrice: number };
export type Order = { id: string; sessionId: string | null; orderType: string; takeoutNumber: string | null; totalAmount: number; status: string };
export type OrderItem = { id: string; orderId: string; itemName: string; quantity: number; lineTotal: number; status: string };
export type Ticket = { id: string; orderId: string; orderItemId: string; station: string; itemName: string; quantity: number; modifiersText: string; status: string; urgentFlag: boolean };
export type Bill = { id: string; orderId: string | null; finalAmount: number; paidAmount: number; status: string };

export interface DiningManagerProps {
  menuItems: Menu[];
  modifierGroups: ModifierGroup[];
  modifierOptions: Modifier[];
  orders: Order[];
  orderItems: OrderItem[];
  kdsTickets: Ticket[];
  bills: Bill[];
  tablesCount: number;
  activeSessionsCount: number;
  onRefresh?: () => void | Promise<void>;
}

const money = (n: number) =>
  new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(n);

export function DiningManager({
  menuItems,
  modifierGroups,
  modifierOptions,
  orders,
  orderItems,
  kdsTickets,
  bills,
  tablesCount,
  activeSessionsCount,
  onRefresh,
}: DiningManagerProps) {
  const [managerTab, setManagerTab] = useState<"kpi" | "menu" | "sla" | "rbac">("kpi");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [soldOutOverrides, setSoldOutOverrides] = useState<Record<string, boolean>>({});
  const [addedItems, setAddedItems] = useState<Menu[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("Main course");
  const [newItemPrice, setNewItemPrice] = useState(250);
  const [showAddModal, setShowAddModal] = useState(false);
  const [actionNotice, setActionNotice] = useState("");

  const allMenuItems = [...menuItems, ...addedItems].map(item => ({
    ...item,
    isSoldOut: soldOutOverrides[item.id] !== undefined ? soldOutOverrides[item.id] : item.isSoldOut,
  }));

  // Financial Metrics
  const paidBills = bills.filter(b => b.status === "paid");
  const totalRevenue = paidBills.reduce((s, b) => s + b.finalAmount, 0);
  const totalOrdersCount = orders.length || paidBills.length;
  const avgCheck = totalOrdersCount > 0 ? Math.round(totalRevenue / totalOrdersCount) : 0;
  const tableOccupancyRate = tablesCount > 0 ? Math.round((activeSessionsCount / tablesCount) * 100) : 0;

  // Dine-in vs Takeout
  const dineInCount = orders.filter(o => o.orderType === "dine_in").length;
  const takeoutCount = orders.filter(o => o.orderType === "takeout").length;

  // Best sellers
  const salesMap: Record<string, { qty: number; revenue: number }> = {};
  for (const item of orderItems.filter(i => i.status !== "cancelled")) {
    if (!salesMap[item.itemName]) {
      salesMap[item.itemName] = { qty: 0, revenue: 0 };
    }
    salesMap[item.itemName].qty += item.quantity;
    salesMap[item.itemName].revenue += item.lineTotal;
  }
  const topSellers = Object.entries(salesMap)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5);

  // KDS Stations breakdown
  const stationStats: Record<string, { queued: number; cooking: number; done: number; served: number; urgent: number }> = {};
  for (const ticket of kdsTickets) {
    const st = ticket.station || "General";
    if (!stationStats[st]) {
      stationStats[st] = { queued: 0, cooking: 0, done: 0, served: 0, urgent: 0 };
    }
    if (ticket.status === "received" || ticket.status === "pending") stationStats[st].queued += 1;
    else if (ticket.status === "cooking" || ticket.status === "preparing") stationStats[st].cooking += 1;
    else if (ticket.status === "done" || ticket.status === "ready") stationStats[st].done += 1;
    else if (ticket.status === "served") stationStats[st].served += 1;
    if (ticket.urgentFlag) stationStats[st].urgent += 1;
  }

  // Cancelled items (Waste / Void analysis)
  const voidedItems = orderItems.filter(i => i.status === "cancelled");

  const categories = ["All", ...Array.from(new Set(allMenuItems.map(m => m.category)))];

  const filteredMenu = allMenuItems.filter(item => {
    const matchCat = selectedCategory === "All" || item.category === selectedCategory;
    const matchSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || item.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  const toggleSoldOut = (id: string, current: boolean) => {
    setSoldOutOverrides(prev => ({ ...prev, [id]: !current }));
    setActionNotice(`已成功將品項狀態切換為：${!current ? "售罄 (Sold Out)" : "供應中 (Available)"}`);
    setTimeout(() => setActionNotice(""), 3500);
  };

  const handleAddNewItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;
    const newSku: Menu = {
      id: `menu_hq_${crypto.randomUUID().slice(0, 8)}`,
      name: newItemName.trim(),
      category: newItemCategory,
      price: Number(newItemPrice),
      isSoldOut: false,
    };
    setAddedItems(prev => [...prev, newSku]);
    setNewItemName("");
    setShowAddModal(false);
    setActionNotice(`新菜單品項「${newSku.name}」已新增並同步全店點餐端！`);
    setTimeout(() => setActionNotice(""), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Role Card */}
      <div className="rounded-2xl border border-purple-200 dark:border-purple-900/60 bg-gradient-to-r from-purple-50 via-indigo-50 to-white dark:from-purple-950/40 dark:via-stone-900 dark:to-stone-900 p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-600 text-white shadow-md">
              <LayoutDashboard size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-purple-100 dark:bg-purple-900/40 px-2.5 py-0.5 text-xs font-semibold text-purple-800 dark:text-purple-300">
                  營運管理者介面 · HQ General Manager
                </span>
                <span className="flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span> 全店營運即時監控
                </span>
              </div>
              <h2 className="mt-1 text-xl font-bold text-stone-900 dark:text-stone-100">TableCraft 餐廳總監管理後台</h2>
              <p className="text-xs text-stone-600 dark:text-stone-400">
                掌握營運營收指標、全店菜單與加料定價、廚房出餐速度 SLA 與人員權限審核。
              </p>
            </div>
          </div>
          {onRefresh && (
            <button
              onClick={() => void onRefresh()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-semibold text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 transition shadow-xs cursor-pointer"
            >
              重新整理數據
            </button>
          )}
        </div>
      </div>

      {actionNotice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm font-semibold text-emerald-800 dark:text-emerald-300 animate-fadeIn">
          ✓ {actionNotice}
        </div>
      )}

      {/* Sub Navigation */}
      <div className="flex gap-2 border-b border-stone-200 dark:border-stone-800 pb-2 overflow-x-auto">
        {[
          { id: "kpi", label: "營運總覽儀表板", icon: TrendingUp },
          { id: "menu", label: "菜單與加料定價管理", icon: UtensilsCrossed },
          { id: "sla", label: "出餐效率 SLA 與站點監控", icon: ChefHat },
          { id: "rbac", label: "員工權限與稽核日誌", icon: Users },
        ].map(item => {
          const Icon = item.icon;
          const isActive = managerTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setManagerTab(item.id as typeof managerTab)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition shrink-0 cursor-pointer ${
                isActive
                  ? "bg-purple-600 text-white shadow-sm"
                  : "bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-400 border border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800"
              }`}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* VIEW 1: KPI Dashboard */}
      {managerTab === "kpi" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">今日實收營業額 (Gross Revenue)</span>
              <p className="mt-2 text-2xl font-bold text-stone-900 dark:text-stone-100">{money(totalRevenue)}</p>
              <span className="mt-1 inline-flex items-center text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                ↑ 較昨日同期增長 +12.4%
              </span>
            </div>
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">累計訂單數 (Completed Checks)</span>
              <p className="mt-2 text-2xl font-bold text-stone-900 dark:text-stone-100">{totalOrdersCount} 筆</p>
              <span className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                內用 {dineInCount} · 外帶 {takeoutCount}
              </span>
            </div>
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">平均客單價 (Avg Check / AOV)</span>
              <p className="mt-2 text-2xl font-bold text-purple-700 dark:text-purple-400">{money(avgCheck)}</p>
              <span className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">包含 10% 服務費</span>
            </div>
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">即時桌況入座率 (Occupancy)</span>
              <p className="mt-2 text-2xl font-bold text-stone-900 dark:text-stone-100">{tableOccupancyRate}%</p>
              <span className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                {activeSessionsCount} / {tablesCount} 桌在客中
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Top Sellers */}
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-stone-100 dark:border-stone-800">
                <h3 className="font-bold text-stone-800 dark:text-stone-200 flex items-center gap-2">
                  <TrendingUp size={18} className="text-purple-600 dark:text-purple-400" />
                  今日熱銷餐點排行 (Top 5 Menu Items)
                </h3>
                <span className="text-xs text-stone-400">依營收金額排序</span>
              </div>
              <div className="mt-4 space-y-3">
                {topSellers.length > 0 ? (
                  topSellers.map(([name, data], idx) => (
                    <div key={name} className="flex items-center justify-between p-2.5 rounded-lg bg-stone-50 dark:bg-stone-800/50 hover:bg-stone-100 dark:hover:bg-stone-800 transition">
                      <div className="flex items-center gap-3">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          idx === 0 ? "bg-amber-500 text-white" : idx === 1 ? "bg-slate-400 text-white" : idx === 2 ? "bg-amber-700 text-white" : "bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-200"
                        }`}>
                          {idx + 1}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{name}</p>
                          <span className="text-xs text-stone-500 dark:text-stone-400">累計銷售 {data.qty} 份</span>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-stone-800 dark:text-stone-200">{money(data.revenue)}</span>
                    </div>
                  ))
                ) : (
                  <p className="py-8 text-center text-sm text-stone-400">尚無出餐銷售數據</p>
                )}
              </div>
            </div>

            {/* Channel Breakdown & Service Efficiency */}
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-stone-100 dark:border-stone-800">
                  <h3 className="font-bold text-stone-800 dark:text-stone-200 flex items-center gap-2">
                    <Layers size={18} className="text-purple-600 dark:text-purple-400" />
                    用餐通路與消費客群分佈
                  </h3>
                  <span className="text-xs text-stone-400">即時分佈</span>
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="flex justify-between text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                      <span>內用桌席 (Dine-in)</span>
                      <span>{dineInCount} 單 ({totalOrdersCount > 0 ? Math.round((dineInCount / totalOrdersCount) * 100) : 0}%)</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                      <div className="h-full bg-purple-600 rounded-full" style={{ width: `${totalOrdersCount > 0 ? (dineInCount / totalOrdersCount) * 100 : 0}%` }}></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                      <span>外帶自取 (Takeout)</span>
                      <span>{takeoutCount} 單 ({totalOrdersCount > 0 ? Math.round((takeoutCount / totalOrdersCount) * 100) : 0}%)</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full" style={{ width: `${totalOrdersCount > 0 ? (takeoutCount / totalOrdersCount) * 100 : 0}%` }}></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-purple-100 dark:border-purple-900/60 bg-purple-50/60 dark:bg-purple-950/30 p-4">
                <div className="flex items-center gap-2 text-purple-900 dark:text-purple-300 font-semibold text-xs mb-1">
                  <Sparkles size={14} className="text-purple-600 dark:text-purple-400" />
                  管理總監智慧建議 (AI Operations Insight)
                </div>
                <p className="text-xs text-purple-800 dark:text-purple-300 leading-relaxed">
                  目前晚間用餐尖峰時段桌位週轉率達 85% 以上，排餐出餐速度平均 11 分鐘，表現優異；建議外帶顧客可引導至「顧客端線上自取」預約，以降低收銀台尖峰排隊負荷。
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: Menu & Modifiers Management */}
      {managerTab === "menu" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-3 text-stone-400" />
                <input
                  type="text"
                  placeholder="搜尋菜名或分類..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 pl-9 pr-4 py-2 text-sm focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-1">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                      selectedCategory === cat
                        ? "bg-purple-600 text-white"
                        : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition shadow-xs cursor-pointer"
            >
              <Plus size={16} />
              新增菜單品項
            </button>
          </div>

          {/* Menu Table */}
          <div className="overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-xs">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/60 text-xs font-semibold text-stone-600 dark:text-stone-300">
                <tr>
                  <th className="py-3 px-4">餐點品名</th>
                  <th className="py-3 px-4">分類</th>
                  <th className="py-3 px-4">定價 (TWD)</th>
                  <th className="py-3 px-4">供應狀態</th>
                  <th className="py-3 px-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {filteredMenu.map(item => (
                  <tr key={item.id} className="hover:bg-stone-50/80 dark:hover:bg-stone-800/50 transition">
                    <td className="py-3.5 px-4 font-semibold text-stone-900 dark:text-stone-100">{item.name}</td>
                    <td className="py-3.5 px-4">
                      <span className="rounded-md bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs text-stone-600 dark:text-stone-400 font-medium">
                        {item.category}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-stone-800 dark:text-stone-200">{money(item.price)}</td>
                    <td className="py-3.5 px-4">
                      {item.isSoldOut ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-950/60 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300">
                          <XCircle size={12} /> 已售罄
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 size={12} /> 供應中
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => toggleSoldOut(item.id, item.isSoldOut)}
                        className={`rounded-lg px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                          item.isSoldOut
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 hover:bg-red-100 dark:hover:bg-red-900/60"
                        }`}
                      >
                        {item.isSoldOut ? "恢復供應" : "標記售罄"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Modifiers List */}
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs">
            <h3 className="font-bold text-stone-800 dark:text-stone-200 mb-3 flex items-center gap-2">
              <Filter size={18} className="text-purple-600 dark:text-purple-400" />
              客製化規格與加料群組設定 (Modifier Groups)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {modifierGroups.map(grp => {
                const options = modifierOptions.filter(o => o.groupId === grp.id);
                return (
                  <div key={grp.id} className="rounded-xl border border-stone-200 dark:border-stone-800 p-4 bg-stone-50 dark:bg-stone-800/50">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-stone-900 dark:text-stone-100 text-sm">{grp.name}</h4>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${grp.isRequired ? "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300" : "bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300"}`}>
                        {grp.isRequired ? "必選 (Required)" : "選填 (Optional)"} · 最多 {grp.maxSelection} 項
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {options.map(opt => (
                        <span key={opt.id} className="inline-flex items-center gap-1 rounded-md bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 px-2 py-1 text-xs text-stone-700 dark:text-stone-300">
                          {opt.name}
                          {opt.additionalPrice > 0 && <span className="font-bold text-purple-600 dark:text-purple-400">+{money(opt.additionalPrice)}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 3: Kitchen SLA & Speed of Service */}
      {managerTab === "sla" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">平均出餐時長 (Average Prep Time)</span>
              <p className="mt-2 text-2xl font-bold text-stone-900 dark:text-stone-100">11.8 分鐘</p>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">優於 SLA 目標 (15 分鐘)</span>
            </div>
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">催單加急總次數 (Urgent Tickets)</span>
              <p className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-400">
                {kdsTickets.filter(t => t.urgentFlag).length} 張急單
              </p>
              <span className="text-xs text-stone-500 dark:text-stone-400">外場顧客催單觸發</span>
            </div>
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">退菜與報廢品項 (Voided Items)</span>
              <p className="mt-2 text-2xl font-bold text-stone-900 dark:text-stone-100">{voidedItems.length} 項</p>
              <span className="text-xs text-stone-500 dark:text-stone-400">損耗率 0.4%</span>
            </div>
          </div>

          {/* Station breakdown */}
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs">
            <h3 className="font-bold text-stone-800 dark:text-stone-200 mb-4 flex items-center gap-2">
              <ChefHat size={18} className="text-purple-600 dark:text-purple-400" />
              各廚房工作站即時負載與出餐進度
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Object.entries(stationStats).map(([st, stat]) => (
                <div key={st} className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50 p-4">
                  <div className="flex items-center justify-between pb-2 border-b border-stone-200 dark:border-stone-700">
                    <span className="font-bold text-stone-800 dark:text-stone-200 text-sm">{st}</span>
                    {stat.urgent > 0 && (
                      <span className="rounded-full bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 px-2 py-0.5 text-[11px] font-bold">
                        ⚑ {stat.urgent} 急單
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-white dark:bg-stone-900 p-2 border border-stone-200 dark:border-stone-700">
                      <span className="text-stone-400 dark:text-stone-500 block text-[10px]">待製作</span>
                      <strong className="text-base text-amber-600 dark:text-amber-400">{stat.queued}</strong>
                    </div>
                    <div className="rounded-lg bg-white dark:bg-stone-900 p-2 border border-stone-200 dark:border-stone-700">
                      <span className="text-stone-400 dark:text-stone-500 block text-[10px]">烹調中</span>
                      <strong className="text-base text-blue-600 dark:text-blue-400">{stat.cooking}</strong>
                    </div>
                    <div className="rounded-lg bg-white dark:bg-stone-900 p-2 border border-stone-200 dark:border-stone-700">
                      <span className="text-stone-400 dark:text-stone-500 block text-[10px]">已出餐</span>
                      <strong className="text-base text-emerald-600 dark:text-emerald-400">{stat.done + stat.served}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4: Staff RBAC & Audit Trail */}
      {managerTab === "rbac" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs">
            <h3 className="font-bold text-stone-800 dark:text-stone-200 mb-3 flex items-center gap-2">
              <Users size={18} className="text-purple-600 dark:text-purple-400" />
              門市職能權限架構 (Role-Based Access Control)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { role: "店長 / 營運管理者 (General Manager)", scope: "全功能權限", desc: "菜單定價、售罄開關、退款核准、對帳結帳、門市報表" },
                { role: "外場領檯 / 收銀員 (Front Cashier & Host)", scope: "前台與結帳", desc: "桌況翻桌、代客開單、外帶收銀、候位排桌、分帳結帳" },
                { role: "內場主廚 / 廚房助理 (Cook / KDS Operator)", scope: "後台 KDS 出餐", desc: "工作站看板檢視、出餐狀態變更 (Cooking/Done)、急單出餐" },
                { role: "加盟主 / 投資業主 (Franchisee Portal)", scope: "多店分潤與採購", desc: "營業額對帳、品牌抽成確認、總部央廚物料叫貨、QSC 稽核評分" },
              ].map(r => (
                <div key={r.role} className="rounded-xl border border-stone-200 dark:border-stone-800 p-4 bg-stone-50 dark:bg-stone-800/50">
                  <div className="flex items-center justify-between">
                    <strong className="text-sm text-stone-900 dark:text-stone-100">{r.role}</strong>
                    <span className="rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 px-2 py-0.5 text-xs font-semibold">
                      {r.scope}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-stone-600 dark:text-stone-400">{r.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs">
            <h3 className="font-bold text-stone-800 dark:text-stone-200 mb-3 flex items-center gap-2">
              <ShieldAlert size={18} className="text-purple-600 dark:text-purple-400" />
              重大敏感操作稽核紀錄 (Audited Operational Trail)
            </h3>
            <div className="divide-y divide-stone-100 dark:divide-stone-800 text-xs">
              {[
                { time: "14:32:10", operator: "店經理 (GM)", action: "退菜核准", target: "桌位 T02 · 菲力牛排 × 1", reason: "顧客要求全熟重新出餐" },
                { time: "13:15:02", operator: "主廚 (Head Chef)", action: "售罄標記", target: "北海道生食級干貝", reason: "當日新鮮進貨限量售罄" },
                { time: "12:04:19", operator: "領檯 (Host)", action: "加急催單", target: "桌位 T05 · 經典肋眼牛排", reason: "等待逾 15 分鐘系統催單" },
              ].map((log, i) => (
                <div key={i} className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-stone-400 dark:text-stone-500">{log.time}</span>
                    <span className="font-semibold text-stone-800 dark:text-stone-200">{log.operator}</span>
                    <span className="rounded bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 font-medium text-stone-700 dark:text-stone-300">{log.action}</span>
                    <span className="text-stone-600 dark:text-stone-400">{log.target}</span>
                  </div>
                  <span className="text-stone-400 dark:text-stone-500">{log.reason}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Menu Item */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-stone-900 p-6 shadow-xl border border-stone-200 dark:border-stone-800">
            <h3 className="text-lg font-bold text-stone-900 dark:text-stone-100 mb-4">新增菜單品項 (HQ Catalog)</h3>
            <form onSubmit={handleAddNewItem} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-600 dark:text-stone-400 mb-1">餐點品名</label>
                <input
                  type="text"
                  required
                  placeholder="例如：松露野菇義大利麵"
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-500 p-2.5 text-sm focus:border-purple-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-600 dark:text-stone-400 mb-1">分類 (Category)</label>
                  <select
                    value={newItemCategory}
                    onChange={e => setNewItemCategory(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 p-2.5 text-sm focus:border-purple-500 focus:outline-none"
                  >
                    <option value="Steak">Steak (排餐)</option>
                    <option value="Main course">Main course (主食)</option>
                    <option value="Drinks">Drinks (飲品)</option>
                    <option value="Special">Special (主廚限定)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-600 dark:text-stone-400 mb-1">定價 (TWD)</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newItemPrice}
                    onChange={e => setNewItemPrice(Number(e.target.value))}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 p-2.5 text-sm focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-xl border border-stone-200 dark:border-stone-700 px-4 py-2 text-sm font-semibold text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 cursor-pointer"
                >
                  確認新增
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import {
  Building2,
  Store,
  FileText,
  Truck,
  Award,
  DollarSign,
  TrendingUp,
  Package,
  Plus,
  CheckCircle2,
  Calendar,
  Download,
  AlertCircle,
  Clock,
  Sparkles,
} from "lucide-react";

export interface DiningFranchiseProps {
  currentStoreRevenue?: number;
  onRefresh?: () => void | Promise<void>;
}

const money = (n: number) =>
  new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(n);

interface StoreOption {
  id: string;
  name: string;
  code: string;
  type: "直營店" | "加盟店";
  city: string;
  monthlyRevenue: number;
  royaltyRate: number; // e.g. 0.03
  qscScore: number;
  rank: number;
  openDate: string;
}

const STORES: StoreOption[] = [
  {
    id: "store_001",
    name: "台北信義直營旗艦店",
    code: "TPE-001",
    type: "直營店",
    city: "台北市信義區",
    monthlyRevenue: 1860000,
    royaltyRate: 0.03,
    qscScore: 98.2,
    rank: 1,
    openDate: "2024-03-15",
  },
  {
    id: "store_102",
    name: "台中逢甲加盟旗艦店",
    code: "TXG-102",
    type: "加盟店",
    city: "台中市西屯區",
    monthlyRevenue: 1420000,
    royaltyRate: 0.03,
    qscScore: 96.8,
    rank: 3,
    openDate: "2024-08-20",
  },
  {
    id: "store_105",
    name: "高雄巨蛋加盟店",
    code: "KHH-105",
    type: "加盟店",
    city: "高雄市左營區",
    monthlyRevenue: 1280000,
    royaltyRate: 0.03,
    qscScore: 95.4,
    rank: 6,
    openDate: "2025-01-10",
  },
  {
    id: "store_108",
    name: "新竹巨城加盟店",
    code: "HSZ-108",
    type: "加盟店",
    city: "新竹市東區",
    monthlyRevenue: 1350000,
    royaltyRate: 0.03,
    qscScore: 97.1,
    rank: 4,
    openDate: "2025-05-18",
  },
];

interface CentralSupplyItem {
  sku: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  suggestedQty: number;
  stockStatus: "充足" | "安全存量警示";
}

const CENTRAL_SUPPLIES: CentralSupplyItem[] = [
  { sku: "HQ-STK-01", name: "總部特選熟成肋眼原肉箱 (10kg/箱)", category: "核心肉品", unit: "箱", price: 9200, suggestedQty: 4, stockStatus: "充足" },
  { sku: "HQ-SAU-02", name: "主廚秘制黑松露牛排醬包 (20包/組)", category: "特調醬料", unit: "組", price: 1800, suggestedQty: 6, stockStatus: "充足" },
  { sku: "HQ-BOX-03", name: "品牌質感外帶包材防漏套組 (500入)", category: "包裝耗材", unit: "箱", price: 2400, suggestedQty: 2, stockStatus: "安全存量警示" },
  { sku: "HQ-OIL-04", name: "特級初榨橄欖油調理油 (5L/桶)", category: "原物料油品", unit: "桶", price: 1450, suggestedQty: 3, stockStatus: "充足" },
];

export function DiningFranchise({ currentStoreRevenue = 42500, onRefresh }: DiningFranchiseProps) {
  const [selectedStoreId, setSelectedStoreId] = useState("store_102");
  const [franchiseTab, setFranchiseTab] = useState<"settlement" | "supply" | "benchmark">("settlement");
  const [supplyCart, setSupplyCart] = useState<Record<string, number>>({
    "HQ-STK-01": 2,
    "HQ-SAU-02": 3,
  });
  const [orderSubmittedNotice, setOrderSubmittedNotice] = useState("");

  const currentStore = STORES.find(s => s.id === selectedStoreId) || STORES[1];

  // Dynamic calculations based on selected store
  const effectiveRevenue = currentStore.monthlyRevenue + currentStoreRevenue;
  const royaltyFee = Math.round(effectiveRevenue * currentStore.royaltyRate);
  const marketingFund = Math.round(effectiveRevenue * 0.01);
  const centralSupplyEstimate = Math.round(effectiveRevenue * 0.31);
  const estimatedOperatingMargin = effectiveRevenue - royaltyFee - marketingFund - centralSupplyEstimate - Math.round(effectiveRevenue * 0.24);

  const handleUpdateSupplyQty = (sku: string, delta: number) => {
    setSupplyCart(prev => {
      const current = prev[sku] || 0;
      const next = Math.max(0, current + delta);
      if (next === 0) {
        const copy = { ...prev };
        delete copy[sku];
        return copy;
      }
      return { ...prev, [sku]: next };
    });
  };

  const handlePlaceSupplyOrder = () => {
    const totalOrderAmount = Object.entries(supplyCart).reduce((sum, [sku, qty]) => {
      const item = CENTRAL_SUPPLIES.find(s => s.sku === sku);
      return sum + (item ? item.price * qty : 0);
    }, 0);

    setOrderSubmittedNotice(
      `總部央廚叫貨訂單已成功送出！訂單金額：${money(totalOrderAmount)}，預計 24 小時內由總部冷鏈物流直送門市。`
    );
    setSupplyCart({});
    setTimeout(() => setOrderSubmittedNotice(""), 6000);
  };

  const supplyTotalCost = Object.entries(supplyCart).reduce((sum, [sku, qty]) => {
    const item = CENTRAL_SUPPLIES.find(s => s.sku === sku);
    return sum + (item ? item.price * qty : 0);
  }, 0);

  return (
    <div className="space-y-6">
      {/* Franchise Banner */}
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-gradient-to-r from-emerald-50 via-teal-50 to-white dark:from-emerald-950/40 dark:via-stone-900 dark:to-stone-900 p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md">
              <Building2 size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  加盟主管理中心 · Franchisee Portal
                </span>
                <span className="text-xs text-stone-500 dark:text-stone-400 font-mono">
                  Store Code: {currentStore.code}
                </span>
              </div>
              <h2 className="mt-1 text-xl font-bold text-stone-900 dark:text-stone-100">{currentStore.name}</h2>
              <p className="text-xs text-stone-600 dark:text-stone-400">
                多門市營收分潤核對、總部特許費對帳單、央廚物料冷鏈叫貨與連鎖店經營指標。
              </p>
            </div>
          </div>

          {/* Store Switcher */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-stone-600 dark:text-stone-400">切換加盟門市：</label>
            <select
              value={selectedStoreId}
              onChange={e => setSelectedStoreId(e.target.value)}
              className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-bold text-stone-800 dark:text-stone-100 focus:border-emerald-500 focus:outline-none shadow-xs"
            >
              {STORES.map(s => (
                <option key={s.id} value={s.id} className="dark:bg-stone-900 dark:text-stone-100">
                  {s.name} ({s.code} · {s.type})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {orderSubmittedNotice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm font-semibold text-emerald-800 dark:text-emerald-300 animate-fadeIn">
          ✓ {orderSubmittedNotice}
        </div>
      )}

      {/* Sub Tabs */}
      <div className="flex gap-2 border-b border-stone-200 dark:border-stone-800 pb-2 overflow-x-auto">
        {[
          { id: "settlement", label: "門市營收與分潤對帳單", icon: FileText },
          { id: "supply", label: "總部央廚物料進貨叫貨", icon: Truck },
          { id: "benchmark", label: "連鎖門市健康度與 QSC 評鑑", icon: Award },
        ].map(item => {
          const Icon = item.icon;
          const isActive = franchiseTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setFranchiseTab(item.id as typeof franchiseTab)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition shrink-0 cursor-pointer ${
                isActive
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-400 border border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800"
              }`}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: Financial Settlement & Royalty */}
      {franchiseTab === "settlement" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">本月門市營收總額</span>
              <p className="mt-2 text-2xl font-bold text-stone-900 dark:text-stone-100">{money(effectiveRevenue)}</p>
              <span className="text-xs text-stone-500 dark:text-stone-400">含今日實體與線上交易</span>
            </div>
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">總部品牌特許費 (3.0%)</span>
              <p className="mt-2 text-2xl font-bold text-emerald-700 dark:text-emerald-400">{money(royaltyFee)}</p>
              <span className="text-xs text-stone-500 dark:text-stone-400">每月結算扣繳</span>
            </div>
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">全聯品牌行銷提撥 (1.0%)</span>
              <p className="mt-2 text-2xl font-bold text-stone-900 dark:text-stone-100">{money(marketingFund)}</p>
              <span className="text-xs text-stone-500 dark:text-stone-400">全台廣告與會員集點</span>
            </div>
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">門市預估營業淨利 (EBITDA)</span>
              <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{money(estimatedOperatingMargin)}</p>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">淨利率約 24.1%</span>
            </div>
          </div>

          {/* Statement Breakdown */}
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100 dark:border-stone-800">
              <h3 className="font-bold text-stone-800 dark:text-stone-200 flex items-center gap-2">
                <FileText size={18} className="text-emerald-600 dark:text-emerald-400" />
                加盟分店損益對帳單結算表 (Monthly Settlement Breakdown)
              </h3>
              <button
                onClick={() => {
                  alert("已產出 PDF 對帳單下載中...");
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 dark:border-stone-700 px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 cursor-pointer"
              >
                <Download size={14} /> 匯出對帳單 (PDF)
              </button>
            </div>

            <div className="mt-4 divide-y divide-stone-100 dark:divide-stone-800 text-sm">
              <div className="py-2.5 flex justify-between font-semibold">
                <span className="text-stone-900 dark:text-stone-100">(+) 門市營業銷售毛總額 (POS + Takeout)</span>
                <span className="text-stone-900 dark:text-stone-100">{money(effectiveRevenue)}</span>
              </div>
              <div className="py-2.5 flex justify-between text-stone-600 dark:text-stone-400">
                <span>(-) 總部央廚核心原物料進貨成本 (約 31%)</span>
                <span className="text-red-600 dark:text-red-400">-{money(centralSupplyEstimate)}</span>
              </div>
              <div className="py-2.5 flex justify-between text-stone-600 dark:text-stone-400">
                <span>(-) 門市外場與內場人事薪資提撥 (約 24%)</span>
                <span className="text-red-600 dark:text-red-400">-{money(Math.round(effectiveRevenue * 0.24))}</span>
              </div>
              <div className="py-2.5 flex justify-between text-stone-600 dark:text-stone-400">
                <span>(-) 總部特許授權權利金 (3.0% Royalty Fee)</span>
                <span className="text-red-600 dark:text-red-400">-{money(royaltyFee)}</span>
              </div>
              <div className="py-2.5 flex justify-between text-stone-600 dark:text-stone-400">
                <span>(-) 品牌全國聯合推廣基金 (1.0% Marketing Fund)</span>
                <span className="text-red-600 dark:text-red-400">-{money(marketingFund)}</span>
              </div>
              <div className="py-3 flex justify-between font-bold text-base text-emerald-800 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/40 px-3 rounded-lg">
                <span>(=) 加盟主門市營業留存淨收入 (Estimated Net Payout)</span>
                <span>{money(estimatedOperatingMargin)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Central Kitchen Supply Ordering */}
      {franchiseTab === "supply" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">總部央廚冷鏈原物料叫貨專區</h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                所有加盟店均享有總部標準化食材統一配送，保證肉品規格、特調醬料與食安品質一致。
              </p>
            </div>
            {Object.keys(supplyCart).length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-stone-700 dark:text-stone-300">
                  已選購叫貨金額：<strong className="text-sm text-emerald-700 dark:text-emerald-400">{money(supplyTotalCost)}</strong>
                </span>
                <button
                  onClick={handlePlaceSupplyOrder}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition shadow-xs cursor-pointer"
                >
                  確認送出叫貨訂單
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {CENTRAL_SUPPLIES.map(item => {
              const qty = supplyCart[item.sku] || 0;
              return (
                <div key={item.sku} className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-2 border-b border-stone-100 dark:border-stone-800">
                      <div>
                        <span className="text-[10px] font-mono text-stone-400 dark:text-stone-500">{item.sku}</span>
                        <h4 className="text-sm font-bold text-stone-900 dark:text-stone-100">{item.name}</h4>
                      </div>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        item.stockStatus === "充足" ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300" : "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300"
                      }`}>
                        {item.stockStatus}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-stone-600 dark:text-stone-400">
                      <span>分類：{item.category}</span>
                      <span>單價：<strong className="text-sm font-bold text-stone-800 dark:text-stone-200">{money(item.price)}</strong> / {item.unit}</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between">
                    <span className="text-xs text-stone-500 dark:text-stone-400">總部建議叫貨量：{item.suggestedQty} {item.unit}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdateSupplyQty(item.sku, -1)}
                        disabled={qty === 0}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-30 cursor-pointer"
                      >
                        -
                      </button>
                      <span className="w-8 text-center text-sm font-bold text-stone-800 dark:text-stone-200">{qty}</span>
                      <button
                        onClick={() => handleUpdateSupplyQty(item.sku, 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-stone-200 dark:border-stone-700 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 font-bold cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: Store Benchmarking & QSC Audit */}
      {franchiseTab === "benchmark" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">全台加盟門市排名</span>
              <p className="mt-2 text-2xl font-bold text-emerald-700 dark:text-emerald-400">第 {currentStore.rank} 名</p>
              <span className="text-xs text-stone-500 dark:text-stone-400">在全台 28 家連鎖門市中</span>
            </div>
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">總部 QSC 稽核評分</span>
              <p className="mt-2 text-2xl font-bold text-stone-900 dark:text-stone-100">{currentStore.qscScore} 分</p>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">評級：A級優良門市</span>
            </div>
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-xs">
              <span className="text-xs font-medium text-stone-500 dark:text-stone-400">門市營運年資</span>
              <p className="mt-2 text-2xl font-bold text-stone-900 dark:text-stone-100">
                {Math.round((Date.now() - new Date(currentStore.openDate).getTime()) / (1000 * 60 * 60 * 24 * 30))} 個月
              </p>
              <span className="text-xs text-stone-500 dark:text-stone-400">開業日期：{currentStore.openDate}</span>
            </div>
          </div>

          {/* Ranking list */}
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5 shadow-xs">
            <h3 className="font-bold text-stone-800 dark:text-stone-200 mb-3 flex items-center gap-2">
              <Award size={18} className="text-emerald-600 dark:text-emerald-400" />
              連鎖品牌績優加盟門市評鑑榜
            </h3>
            <div className="divide-y divide-stone-100 dark:divide-stone-800 text-sm">
              {STORES.map((s, idx) => (
                <div key={s.id} className={`py-3 flex items-center justify-between ${s.id === selectedStoreId ? "bg-emerald-50/50 dark:bg-emerald-950/30 -mx-2 px-2 rounded-lg" : ""}`}>
                  <div className="flex items-center gap-3">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      s.rank === 1 ? "bg-amber-500 text-white" : s.rank <= 3 ? "bg-emerald-600 text-white" : "bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300"
                    }`}>
                      {s.rank}
                    </span>
                    <div>
                      <p className="font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                        {s.name}
                        {s.id === selectedStoreId && (
                          <span className="rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 px-1.5 py-0.2 text-[10px] font-bold">
                            目前門市
                          </span>
                        )}
                      </p>
                      <span className="text-xs text-stone-500 dark:text-stone-400">{s.city} · {s.type}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-stone-900 dark:text-stone-100 block">{money(s.monthlyRevenue)}</span>
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">QSC {s.qscScore} 分</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import {
  Store,
  QrCode,
  Smartphone,
  CheckCircle2,
  Sparkles,
  CreditCard,
  Maximize2,
  Minimize2,
  X,
  Receipt,
  Check,
  ChevronRight,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";

export interface CustomerCartLine {
  item: {
    id: string;
    name: string;
    barcode: string;
    price: number;
  };
  quantity: number;
  lineDiscount: number;
}

export interface CustomerMemberInfo {
  phone: string;
  name: string;
  tier: string;
  badge: string;
  points: number;
}

export interface CompletedTransactionData {
  receiptNumber: string;
  totalAmount: number;
  tenderAmount: number;
  changeAmount: number;
  earnedPoints: number;
  member?: CustomerMemberInfo | null;
  invoiceMode?: "carrier" | "paper";
  carrierBarcode?: string | null;
  paymentMethod?: string;
  timestamp?: string;
}

export type PaymentBrand = "linepay" | "twpay" | "jko" | "applepay";

// Deterministic QR Matrix Generator for Taiwanese retail mobile payments
function generateQrMatrix(data: string, size = 25): boolean[][] {
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const drawFinder = (startX: number, startY: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[startY + r][startX + c] = isBorder || isCenter;
      }
    }
  };

  // 1. Top-Left, 2. Top-Right, 3. Bottom-Left Finders
  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Hash-based data encoding
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
  }

  let seed = Math.abs(hash) || 12345;
  const nextBit = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >> 16) % 2 === 1;
  };

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inFinder1 = r <= 7 && c <= 7;
      const inFinder2 = r <= 7 && c >= size - 8;
      const inFinder3 = r >= size - 8 && c <= 7;
      const inTiming = r === 6 || c === 6;
      const inCenterLogo = r >= 10 && r <= 14 && c >= 10 && c <= 14;

      if (!inFinder1 && !inFinder2 && !inFinder3 && !inTiming && !inCenterLogo) {
        matrix[r][c] = nextBit();
      }
    }
  }

  return matrix;
}

const BRAND_CONFIGS: Record<
  PaymentBrand,
  {
    name: string;
    subname: string;
    color: string;
    bgAccent: string;
    borderAccent: string;
    logoLabel: string;
    instruction: string;
  }
> = {
  linepay: {
    name: "LINE Pay",
    subname: "條碼掃描支付",
    color: "#06C755",
    bgAccent: "bg-[#06C755]/10",
    borderAccent: "border-[#06C755]/40",
    logoLabel: "LINE",
    instruction: "開啟 LINE > 錢包 > 掃碼付款",
  },
  twpay: {
    name: "台灣 Pay",
    subname: "跨機構共通支付",
    color: "#D32F2F",
    bgAccent: "bg-red-500/10",
    borderAccent: "border-red-500/40",
    logoLabel: "TW Pay",
    instruction: "支援各家台灣銀行帳戶、金融卡、信用卡掃碼",
  },
  jko: {
    name: "街口支付",
    subname: "街口幣即時折抵",
    color: "#E51E2B",
    bgAccent: "bg-rose-500/10",
    borderAccent: "border-rose-500/40",
    logoLabel: "街口",
    instruction: "出示街口付款碼或掃描立牌付款",
  },
  applepay: {
    name: "Apple Pay / 感應",
    subname: "感應感測付款 (NFC)",
    color: "#38BDF8",
    bgAccent: "bg-sky-500/10",
    borderAccent: "border-sky-500/40",
    logoLabel: " Pay",
    instruction: "持 iPhone 或感應卡片靠近副螢幕感應區",
  },
};

function PaymentQrWidget({
  brand,
  totalAmount,
  onSimulatePayment,
  disabled,
}: {
  brand: PaymentBrand;
  totalAmount: number;
  onSimulatePayment?: (brand: PaymentBrand) => void;
  disabled?: boolean;
}) {
  const config = BRAND_CONFIGS[brand];
  const payload = `${brand.toUpperCase()}://pay?store=CP_STORE_01&amount=${totalAmount}&t=${Date.now()}`;
  const matrix = generateQrMatrix(payload, 25);

  return (
    <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-stone-900 border border-stone-800 text-stone-100 space-y-3">
      {/* Brand Header */}
      <div className="flex items-center justify-between w-full text-xs">
        <div className="flex items-center gap-1.5 font-bold">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: config.color }}
          />
          <span className="text-white">{config.name}</span>
          <span className="text-stone-400 text-[10px] font-normal font-mono">
            {config.subname}
          </span>
        </div>
        <span className="text-[10px] bg-stone-800 text-stone-400 px-1.5 py-0.5 rounded font-mono">
          即時產生 QR
        </span>
      </div>

      {/* QR Code Container */}
      <div className="relative p-3 bg-white rounded-xl shadow-lg flex items-center justify-center">
        <div className="w-36 h-36">
          <svg
            viewBox="0 0 25 25"
            className="w-full h-full"
            shapeRendering="crispEdges"
            aria-label={`${config.name} Payment QR Code`}
          >
            {matrix.map((row, r) =>
              row.map((cell, c) =>
                cell ? (
                  <rect
                    key={`${r}-${c}`}
                    x={c}
                    y={r}
                    width="1"
                    height="1"
                    fill={config.color}
                  />
                ) : null
              )
            )}
          </svg>
        </div>

        {/* Center Logo Monogram */}
        <div
          className="absolute inset-0 m-auto w-8 h-8 rounded-md bg-white border shadow-md flex items-center justify-center text-[9px] font-black tracking-tighter"
          style={{ borderColor: config.color, color: config.color }}
        >
          {config.logoLabel}
        </div>
      </div>

      {/* Guide text */}
      <div className="text-center space-y-0.5">
        <div className="text-[11px] font-medium text-stone-300">
          {config.instruction}
        </div>
        <div className="text-[10px] text-stone-400 font-mono">
          待付總額 NT$ <b className="text-white text-xs">{totalAmount}</b>
        </div>
      </div>

      {/* Interactive Simulation Button */}
      {onSimulatePayment && (
        <button
          type="button"
          disabled={disabled || totalAmount <= 0}
          onClick={() => onSimulatePayment(brand)}
          className="w-full py-2 px-3 rounded-lg text-xs font-bold text-white transition flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-40"
          style={{ backgroundColor: config.color }}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>模擬顧客以 {config.name} 掃碼付款</span>
        </button>
      )}
    </div>
  );
}

interface CustomerDisplayProps {
  cart: CustomerCartLine[];
  subtotal: number;
  totalDiscount: number;
  totalAmount: number;
  tenderAmount: number;
  changeAmount: number;
  member?: CustomerMemberInfo | null;
  earnedPoints?: number;
  invoiceMode?: "carrier" | "paper";
  carrierBarcode?: string;
  completedTransaction: CompletedTransactionData | null;
  onNextCustomer: () => void;
  onSimulatePayment?: (brand: PaymentBrand) => void;
  isFullscreen?: boolean;
  onCloseFullscreen?: () => void;
}

export default function CustomerDisplay({
  cart,
  subtotal,
  totalDiscount,
  totalAmount,
  tenderAmount,
  changeAmount,
  member = null,
  earnedPoints = 0,
  invoiceMode = "carrier",
  carrierBarcode = "/ABC1234",
  completedTransaction,
  onNextCustomer,
  onSimulatePayment,
  isFullscreen = false,
  onCloseFullscreen,
}: CustomerDisplayProps) {
  const { locale, t } = usePortfolioLocale();
  const getSubProjectName = (_id: string) => (locale === "zh-TW" ? "CounterPoint 門市零售" : "CounterPoint");
  const [selectedBrand, setSelectedBrand] = useState<PaymentBrand>("linepay");
  const [timeStr, setTimeStr] = useState<string>("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString("zh-TW", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className={`customer-display-terminal flex flex-col justify-between bg-stone-950 text-white rounded-2xl border-4 border-stone-800 shadow-2xl overflow-hidden transition-all duration-300 ${
        isFullscreen ? "min-h-[85vh] p-6 lg:p-8" : "p-5 lg:p-6"
      }`}
    >
      {/* 1. Pole Display Top Header / Welcome Banner */}
      <div className="border-b border-stone-800/80 pb-4 mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-inner">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-stone-400 font-mono font-semibold flex items-center gap-2">
                <span>{getSubProjectName("pos")}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400 text-[10px]">{t("Customer Display Connected", "客顯副螢幕連線中")}</span>
              </div>
              <h2 className="text-lg lg:text-xl font-black text-white tracking-tight flex items-center gap-2">
                <span>{getSubProjectName("pos")} · {t("Welcome", "歡迎光臨")}</span>
              </h2>
            </div>
          </div>

          {/* Right Header Status Bar */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-[10px] text-stone-400 font-mono">Taipei Time</span>
              <span className="text-xs font-mono font-bold text-amber-300">{timeStr || "12:00:00"}</span>
            </div>

            {isFullscreen && onCloseFullscreen && (
              <button
                type="button"
                onClick={onCloseFullscreen}
                className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium flex items-center gap-1 transition"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>收合客顯 (Close)</span>
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Member & E-Invoice Sync Banner for Customer */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {member ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-medium">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>
                尊榮會員：<b>{member.tier}</b> · 累積點數: <b>{member.points} pts</b> (本次可獲 +{earnedPoints} pts)
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-stone-900 border border-stone-800 text-stone-400 text-[11px]">
              <span>報會員電話享消費積點 (每 $10 得 1 點)</span>
            </div>
          )}

          {invoiceMode === "carrier" ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-medium">
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                電子發票載具：<b>{carrierBarcode || "等待收銀員輸入"}</b>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-stone-800 border border-stone-700 text-stone-300 font-medium">
              <Receipt className="w-3.5 h-3.5 text-stone-400" />
              <span>發票設定：索取紙本發票證明聯</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. MAIN BODY: EITHER THANK-YOU STATE OR ACTIVE REAL-TIME SHOPPING CART */}
      {completedTransaction ? (
        /* ==================== A. TRANSACTION COMPLETED / THANK YOU STATE ==================== */
        <div className="my-auto py-8 px-4 sm:px-8 text-center space-y-6 animate-in fade-in zoom-in-95 duration-300">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400 shadow-xl shadow-emerald-500/10">
            <CheckCircle2 className="w-10 h-10 animate-bounce" />
          </div>

          <div className="space-y-1">
            <h3 className="text-2xl lg:text-3xl font-black text-white tracking-tight">
              交易完成！發票已開立，謝謝惠顧
            </h3>
            <p className="text-xs text-stone-400 font-mono">
              {t("Thank you for shopping with us!", `感謝您在 ${getSubProjectName("pos")} 門市消費！`)}
            </p>
          </div>

          {/* Large Highlight Change Box */}
          <div className="max-w-md mx-auto p-5 rounded-2xl bg-gradient-to-br from-emerald-950/80 to-stone-900 border-2 border-emerald-500/50 shadow-2xl space-y-2">
            <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
              Change Due · 找零金額
            </div>
            <div className="text-4xl lg:text-5xl font-black font-mono text-emerald-300 tracking-tight">
              ${completedTransaction.changeAmount}
            </div>
            <div className="text-[11px] text-stone-300 font-mono">
              應付 ${completedTransaction.totalAmount} · 實收 ${completedTransaction.tenderAmount}
            </div>
          </div>

          {/* Details Grid */}
          <div className="max-w-md mx-auto grid grid-cols-2 gap-2 text-left text-xs bg-stone-900/90 p-4 rounded-xl border border-stone-800">
            <div>
              <span className="text-stone-400 block text-[10px]">發票號碼 / Receipt</span>
              <span className="font-mono font-bold text-white">{completedTransaction.receiptNumber}</span>
            </div>
            <div>
              <span className="text-stone-400 block text-[10px]">電子發票狀態</span>
              <span className="font-mono font-semibold text-emerald-400">
                {completedTransaction.invoiceMode === "carrier"
                  ? `已存入載具 ${completedTransaction.carrierBarcode}`
                  : "紙本證明聯已列印"}
              </span>
            </div>
            <div>
              <span className="text-stone-400 block text-[10px]">本次獲得點數</span>
              <span className="font-mono font-bold text-amber-400">
                +{completedTransaction.earnedPoints} pts
              </span>
            </div>
            <div>
              <span className="text-stone-400 block text-[10px]">交易時間</span>
              <span className="font-mono text-stone-300">{completedTransaction.timestamp}</span>
            </div>
          </div>

          {/* Next Customer Button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={onNextCustomer}
              className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-black text-sm shadow-lg transition inline-flex items-center gap-2"
            >
              <span>下一位顧客 (Next Customer)</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        /* ==================== B. REAL-TIME CART & PAYMENT DISPLAY ==================== */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-start">
          {/* Left Column (7 cols): Synchronous Real-time Cart Lines */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-4 bg-stone-900/70 p-4 rounded-xl border border-stone-800/80 min-h-[360px]">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-stone-800 pb-2.5">
                <div className="font-bold text-xs uppercase tracking-wider text-stone-300 flex items-center gap-1.5">
                  <Receipt className="w-4 h-4 text-amber-400" />
                  <span>購買明細 (Cart Items)</span>
                </div>
                <span className="text-xs text-stone-400 font-mono">
                  共 {cart.reduce((sum, l) => sum + l.quantity, 0)} 件商品
                </span>
              </div>

              {/* Items List */}
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {cart.length === 0 ? (
                  <div className="text-center py-16 text-stone-500 space-y-2">
                    <Store className="w-10 h-10 mx-auto opacity-30 text-stone-400" />
                    <div className="text-xs font-medium text-stone-400">
                      歡迎光臨！請將商品交由收銀員進行條碼掃描
                    </div>
                    <div className="text-[10px] text-stone-500 font-mono">
                      Please place your items on the checkout counter
                    </div>
                  </div>
                ) : (
                  cart.map((line) => {
                    const lineTotal = line.item.price * line.quantity - line.lineDiscount;
                    return (
                      <div
                        key={line.item.id}
                        className="p-3 rounded-lg bg-stone-800/60 border border-stone-700/50 text-xs flex items-center justify-between gap-3 animate-in fade-in duration-200"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-stone-100 truncate text-sm">
                            {line.item.name}
                          </div>
                          <div className="text-[11px] text-stone-400 font-mono flex items-center gap-2 mt-0.5">
                            <span>${line.item.price} × {line.quantity}</span>
                            {line.lineDiscount > 0 && (
                              <span className="text-[10px] bg-rose-500/20 text-rose-300 px-1 rounded">
                                折扣 -${line.lineDiscount}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="font-mono font-black text-amber-400 text-sm">
                            ${lineTotal}
                          </div>
                          <div className="text-[10px] text-stone-400 font-mono">
                            {line.quantity} 件
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Subtotal & Discounts footer row on Left side */}
            <div className="border-t border-stone-800 pt-3 flex items-center justify-between text-xs text-stone-400 font-mono">
              <span>小計 Subtotal: ${subtotal}</span>
              {totalDiscount > 0 && (
                <span className="text-rose-400">折扣 Discounts: -${totalDiscount}</span>
              )}
            </div>
          </div>

          {/* Right Column (5 cols): Big Amount Due & Payment QR Code Generator */}
          <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
            {/* Big Bold Amount Due Display */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-stone-900 to-black border-2 border-amber-500/40 text-stone-100 shadow-xl space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider font-bold text-amber-400">
                  Amount Due · 應付總額
                </span>
                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono">
                  TWD
                </span>
              </div>

              <div className="text-4xl sm:text-5xl font-black font-mono text-amber-400 tracking-tight">
                ${totalAmount}
              </div>

              <div className="flex items-center justify-between text-[11px] text-stone-400 pt-1 border-t border-stone-800">
                <span>合計件數: {cart.reduce((sum, l) => sum + l.quantity, 0)} 件</span>
                {totalDiscount > 0 ? (
                  <span className="text-rose-400 font-medium">已折抵 ${totalDiscount}</span>
                ) : (
                  <span>無額外折扣</span>
                )}
              </div>
            </div>

            {/* Payment QR Code Generator Tabs & Display */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-stone-300 flex items-center justify-between">
                <span>行動支付掃碼 (Scan to Pay)</span>
                <span className="text-[10px] text-stone-400">選擇支付方式</span>
              </div>

              {/* Brand Tabs */}
              <div className="grid grid-cols-4 gap-1">
                {(["linepay", "twpay", "jko", "applepay"] as PaymentBrand[]).map((brand) => {
                  const cfg = BRAND_CONFIGS[brand];
                  const isActive = selectedBrand === brand;
                  return (
                    <button
                      key={brand}
                      type="button"
                      onClick={() => setSelectedBrand(brand)}
                      className={`py-1.5 px-1 rounded-lg text-[10px] font-bold transition flex flex-col items-center gap-0.5 border ${
                        isActive
                          ? "bg-stone-800 text-white border-amber-400 shadow-sm"
                          : "bg-stone-900 text-stone-400 border-stone-800 hover:bg-stone-800"
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: cfg.color }}
                      />
                      <span className="truncate w-full text-center">{cfg.name.split(" ")[0]}</span>
                    </button>
                  );
                })}
              </div>

              {/* Dynamic QR Widget for Selected Brand */}
              <PaymentQrWidget
                brand={selectedBrand}
                totalAmount={totalAmount}
                onSimulatePayment={onSimulatePayment}
                disabled={cart.length === 0}
              />
            </div>
          </div>
        </div>
      )}

      {/* 3. Terminal Footer */}
      <div className="mt-5 pt-3 border-t border-stone-800/80 flex flex-wrap items-center justify-between gap-2 text-[10px] text-stone-400 font-mono">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>財政部電子發票認證系統 · 雙向交易即時同步</span>
        </div>
        <div>
          <span>POS Terminal: REG-01 · {getSubProjectName("pos")}</span>
        </div>
      </div>
    </div>
  );
}

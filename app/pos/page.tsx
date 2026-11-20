"use client";

import { WorkspaceHeader, WorkspaceLinks, WorkspaceLoading } from "@/components/workspace-header";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import PosOperations from "./operations";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import {
  Calculator,
  ArrowLeft,
  RotateCcw,
  Barcode,
  Plus,
  Minus,
  Trash2,
  DollarSign,
  Receipt,
  PauseCircle,
  PlayCircle,
  Undo2,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

interface CartLine {
  item: any;
  quantity: number;
  lineDiscount: number;
}

export default function PosPage() {
  const { t } = usePortfolioLocale();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Cashier Cart state
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tenderAmount, setTenderAmount] = useState<number>(200);
  const [barcodeInput, setBarcodeInput] = useState<string>("4710001001");
  const [checkingOut, setCheckingOut] = useState(false);
  const checkoutAttempt = useRef<{ signature: string; key: string } | null>(null);
  const [lastReceipt, setLastReceipt] = useState<any>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/pos/data");
      const json: any = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error?.message || t("Unable to load POS data", "無法載入 POS 資料"));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const addToCart = (item: any) => {
    setCart(prev => {
      const existing = prev.find(l => l.item.id === item.id);
      if (existing) {
        return prev.map(l => (l.item.id === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { item, quantity: 1, lineDiscount: 0 }];
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart(prev =>
      prev
        .map(l => {
          if (l.item.id === itemId) {
            const newQty = l.quantity + delta;
            return newQty > 0 ? { ...l, quantity: newQty } : null;
          }
          return l;
        })
        .filter(Boolean) as CartLine[]
    );
  };

  const setLineDiscount = (itemId: string, discount: number) => {
    setCart(prev =>
      prev.map(l => (l.item.id === itemId ? { ...l, lineDiscount: Math.max(0, discount) } : l))
    );
  };

  // Calculations
  const subtotal = cart.reduce((sum, l) => sum + l.item.price * l.quantity, 0);
  const totalDiscount = cart.reduce((sum, l) => sum + l.lineDiscount, 0);
  const totalAmount = Math.max(0, subtotal - totalDiscount);
  const changeAmount = Math.max(0, tenderAmount - totalAmount);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setCheckingOut(true);
    setError(null);
    setSuccessMsg(null);

    const store = data.stores[0];
    const reg = data.registers[0];
    const shift = data.shifts.find((s: any) => s.status === "open") || data.shifts[0];

    const signature = JSON.stringify({
      storeId: store?.id,
      registerId: reg?.id,
      shiftId: shift?.id,
      cart: cart.map(line => ({
        barcode: line.item.barcode,
        quantity: line.quantity,
        lineDiscount: line.lineDiscount,
      })),
      tenderAmount,
    });
    if (checkoutAttempt.current?.signature !== signature)
      checkoutAttempt.current = { signature, key: crypto.randomUUID() };
    try {
      const res = await fetch("/api/pos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: store?.id || "store_default",
          registerId: reg?.id || "reg_default",
          shiftId: shift?.id || "shift_default",
          items: cart.map(c => ({
            barcode: c.item.barcode,
            quantity: c.quantity,
            lineDiscount: c.lineDiscount,
          })),
          tenderAmount,
          idempotencyKey: checkoutAttempt.current.key,
        }),
      });

      const json: any = await res.json();
      if (json.success) {
        checkoutAttempt.current = null;
        setLastReceipt(json.data);
        setSuccessMsg(
          t(
            `Checkout complete. Receipt: ${json.data.receiptNumber}, due $${json.data.totalAmount}, tendered $${json.data.tenderAmount}, change $${json.data.changeAmount}`,
            `結帳完成。收據號碼：${json.data.receiptNumber}，應收 $${json.data.totalAmount}，實收 $${json.data.tenderAmount}，找零 $${json.data.changeAmount}`
          )
        );
        setCart([]);
        fetchData();
      } else {
        setError(json.error?.message || t("Checkout failed", "結帳失敗"));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCheckingOut(false);
    }
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput) return;
    const match = data?.catalogItems.find((it: any) => it.barcode === barcodeInput.trim());
    if (match) {
      addToCart(match);
      setBarcodeInput("");
    } else {
      setError(
        t(
          `No product found for barcode ${barcodeInput}`,
          `找不到條碼為 ${barcodeInput} 的商品`
        )
      );
    }
  };

  if (loading && !data) return <WorkspaceLoading name="CounterPoint" error={error} onRetry={fetchData} />;

  const shift = data?.shifts?.find((s: any) => s.status === "open") || data?.shifts[0];
  const report = data?.dailyReport;

  return (
    <main data-site="pos" className="suite-page suite-pos space-y-6">
      <WorkspaceHeader
        brand="CounterPoint"
        eyebrow="POS / Retail workspace"
        title="Better service. Simpler checkout."
        description="Select products, review the cart and collect payment. Every transaction is traceable."
        onRefresh={fetchData}
        busy={loading}
      />
      <WorkspaceLinks
        links={[
          { href: "#register", label: "Products and checkout" },
          { href: "#pos-operations", label: "Shifts and transactions" },
        ]}
      />
      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2"
        >
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* POS Layout: Left Catalog Grid, Right Cashier Cart */}
      <section className="register-context" aria-label={t("Shift summary", "班次摘要")}>
        <span>
          {t("Current shift", "目前班次")}{" "}
          <b>{shift?.status === "open" ? t("Open", "開班中") : t("No open shift", "未開班")}</b>
        </span>
        <span>
          {t("Opening cash", "開班備用金")}{" "}
          <b>${shift?.openingCash?.toLocaleString() ?? "—"}</b>
        </span>
        <span>
          {t("Daily net sales", "當日淨銷售額")}{" "}
          <b>${report?.netSales?.toLocaleString() ?? "—"}</b>
        </span>
      </section>

      <div id="register" className="register-layout grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols: Catalog & Barcode Scanner */}
        <div className="lg:col-span-7 space-y-6">
          {/* Barcode Search Bar */}
          <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
            <form onSubmit={handleBarcodeSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <Barcode className="w-4 h-4 absolute left-3 top-3 text-stone-400" />
                <input
                  aria-label={t("Product barcode", "商品條碼")}
                  type="text"
                  placeholder={t(
                    "Scan or enter product barcode (e.g.: 4710001001 / 4710001002)",
                    "掃描或輸入商品條碼 (例如：4710001001 / 4710001002)"
                  )}
                  value={barcodeInput}
                  onChange={e => setBarcodeInput(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-300 text-xs font-mono focus:ring-1 focus:ring-primary"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-primary hover:bg-[#0040b0] text-white text-xs font-medium transition"
              >
                {t("Add", "加入")}
              </button>
            </form>
          </div>

          {/* Catalog Quick Tap Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {data?.catalogItems.map((item: any) => (
              <button key={item.id} onClick={() => addToCart(item)} className="pos-product">
                <div>
                  <div className="font-bold text-xs text-stone-900 group-hover:text-primary transition line-clamp-2">
                    {item.name}
                  </div>
                  <div className="text-[10px] text-stone-400 font-mono mt-0.5">{item.barcode}</div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold font-mono text-sm text-stone-900">${item.price}</span>
                  <span className="text-[10px] text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                    {t("Stock", "庫存")}:{item.stockQuantity}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Quick Demo Instruction */}
          <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200 text-xs text-amber-900 space-y-1">
            <div className="font-bold">{t("Example workflow:", "操作示範流程：")}</div>
            <div>
              {t(
                "Add two cold brew coffees ($200), apply a $10 line discount ($190 due), then tender $200 for $10 change.",
                "加入 2 杯冷萃咖啡 ($200)，設定 $10 明細折價（應收 $190），實收 $200 現金，系統自動找零 $10。"
              )}
            </div>
          </div>
        </div>

        {/* Right 5 Cols: Cashier Register & Checkout Terminal */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-stone-200 p-6 shadow-sm flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-stone-600" />
                <span>{t("Checkout cart", "收銀購物車")}</span>
              </h3>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  className="text-[11px] text-stone-400 hover:text-stone-700 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{t("Clear", "清空")}</span>
                </button>
              )}
            </div>

            {/* Cart Items List */}
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <div className="text-center py-10 text-stone-400 text-xs">
                  {t("Your cart is empty. Select a product to begin.", "購物車目前為空，請點選商品以開始。")}
                </div>
              ) : (
                cart.map(line => (
                  <div
                    key={line.item.id}
                    className="p-3 rounded-lg border border-stone-100 bg-stone-50/60 text-xs space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-bold text-stone-900">{line.item.name}</div>
                        <div className="text-stone-500 font-mono text-[11px]">
                          ${line.item.price} x {line.quantity}
                        </div>
                      </div>
                      <div className="font-bold font-mono text-stone-900">
                        ${line.item.price * line.quantity - line.lineDiscount}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span>{t("Discount:", "折價:")}</span>
                        <input
                          aria-label={`${line.item.name} ${t("Line discount", "明細折價")}`}
                          type="number"
                          min="0"
                          max={line.item.price * line.quantity}
                          value={line.lineDiscount}
                          onChange={e => setLineDiscount(line.item.id, parseInt(e.target.value) || 0)}
                          className="w-16 p-1 rounded border border-stone-300 text-center font-mono text-xs"
                        />
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          aria-label={`Decrease ${line.item.name} Quantity`}
                          onClick={() => updateQuantity(line.item.id, -1)}
                          className="w-6 h-6 rounded bg-stone-200 hover:bg-stone-300 flex items-center justify-center"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center font-mono font-bold">{line.quantity}</span>
                        <button
                          aria-label={`Increase ${line.item.name} Quantity`}
                          onClick={() => updateQuantity(line.item.id, 1)}
                          className="w-6 h-6 rounded bg-stone-200 hover:bg-stone-300 flex items-center justify-center"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Summary & Payment Controls */}
          <div className="border-t border-stone-100 pt-4 space-y-4">
            <div className="space-y-1.5 text-xs text-stone-600">
              <div className="flex justify-between">
                <span>{t("Subtotal:", "小計:")}</span>
                <span className="font-mono font-bold text-stone-900">${subtotal}</span>
              </div>
              <div className="flex justify-between text-rose-600">
                <span>{t("Allocated discount:", "分攤折價:")}</span>
                <span className="font-mono font-bold">-${totalDiscount}</span>
              </div>
              <div className="flex justify-between text-base font-extrabold text-stone-900 pt-1 border-t border-dashed border-stone-200">
                <span>{t("Total due:", "應付總額:")}</span>
                <span className="font-mono text-amber-700 text-lg">${totalAmount}</span>
              </div>
            </div>

            {/* Quick Tender Cash Buttons */}
            <div className="space-y-2">
              <div className="text-[11px] text-stone-500 font-medium">
                {t("Cash tendered (Tender):", "實收現金 (Tender):")}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[totalAmount, 200, 500, 1000].map((amt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setTenderAmount(amt)}
                    className={`py-1.5 rounded border text-xs font-mono font-semibold transition ${
                      tenderAmount === amt
                        ? "bg-primary text-white border-primary"
                        : "bg-stone-50 text-stone-700 hover:bg-stone-100"
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-stone-500">{t("Change due:", "應找零錢:")}</span>
                <span className="font-mono font-black text-emerald-700 text-base">${changeAmount}</span>
              </div>
            </div>

            <button
              onClick={handleCheckout}
              disabled={
                cart.length === 0 ||
                checkingOut ||
                tenderAmount < totalAmount ||
                !data?.shifts.some((entry: any) => entry.status === "open")
              }
              className="w-full py-3 rounded-xl bg-primary hover:bg-[#0040b0] disabled:opacity-50 text-white font-bold text-sm shadow-md transition"
            >
              {checkingOut
                ? t("Checking out...", "結帳處理中…")
                : `${t("Confirm payment", "確認結帳")} $${tenderAmount} (${t("Change", "找零")} $${changeAmount})`}
            </button>
          </div>
        </div>
      </div>
      {data && (
        <div id="pos-operations">
          <PosOperations data={data} cart={cart} setCart={setCart} refresh={fetchData} />
        </div>
      )}
    </main>
  );
}

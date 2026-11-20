"use client";

import { WorkspaceHeader, WorkspaceLinks, WorkspaceLoading } from "@/components/workspace-header";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ErpAdvanced } from "./advanced";
import { ErpOperations } from "@/components/domain-operations";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import {
  Database,
  ArrowLeft,
  RotateCcw,
  Boxes,
  ArrowRightLeft,
  FileCheck2,
  DollarSign,
  Scale,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

export default function ErpPage() {
  const { t } = usePortfolioLocale();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Transfer form state
  const [transferItem, setTransferItem] = useState<string>("");
  const [fromWh, setFromWh] = useState<string>("");
  const [toWh, setToWh] = useState<string>("");
  const [transferQty, setTransferQty] = useState<number>(3);
  const [transferring, setTransferring] = useState(false);

  // Invoice payment state
  const [payAmount, setPayAmount] = useState<number>(600);
  const [paying, setPaying] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/erp/data");
      const json: any = await res.json();
      if (json.success) {
        setData(json.data);
        if (json.data.items.length > 0 && !transferItem) {
          setTransferItem(json.data.items[0].id);
        }
        if (json.data.warehouses.length >= 2) {
          setFromWh(json.data.warehouses[0].id);
          setToWh(json.data.warehouses[1].id);
        }
      } else {
        setError(json.error?.message || t("Unable to load ERP data", "無法載入 ERP 資料"));
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

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferItem || !fromWh || !toWh) return;
    setTransferring(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/erp/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: transferItem,
          fromWarehouseId: fromWh,
          toWarehouseId: toWh,
          quantity: transferQty,
        }),
      });

      const json: any = await res.json();
      if (json.success) {
        setSuccess(
          t(
            `Transfer complete. Source balance: ${json.data.sourceBalanceAfter}, destination balance: ${json.data.destBalanceAfter}, total stock preserved`,
            `調撥完成。來源倉餘額：${json.data.sourceBalanceAfter}，目的倉餘額：${json.data.destBalanceAfter}，總庫存守恆一致。`
          )
        );
        fetchData();
      } else {
        setError(json.error?.message || t("Transfer failed", "調撥失敗"));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTransferring(false);
    }
  };

  const handlePayInvoice = async (invoiceId: string) => {
    setPaying(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/erp/invoice/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          amount: payAmount,
        }),
      });

      const json: any = await res.json();
      if (json.success) {
        setSuccess(
          t(
            `Payment recorded. Total received: $${json.data.paidAmount}, outstanding: $${json.data.unpaidAmount}, status: ${json.data.status}`,
            `付款已記錄。累計已付：$${json.data.paidAmount}，未結金額：$${json.data.unpaidAmount}，狀態：${json.data.status}`
          )
        );
        fetchData();
      } else {
        setError(json.error?.message || t("Payment failed", "付款失敗"));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPaying(false);
    }
  };

  if (loading && !data) return <WorkspaceLoading name="LedgerWorks" error={error} onRetry={fetchData} />;

  const tb = data?.trialBalance;

  return (
    <main data-site="erp" className="suite-page suite-erp space-y-7">
      <WorkspaceHeader
        brand="LedgerWorks"
        eyebrow="ERP / Operations workspace"
        title="Every transaction, clearly connected."
        description="Connect inventory, purchasing, sales and accounting in one workspace."
        onRefresh={fetchData}
        busy={loading}
      />
      <WorkspaceLinks
        links={[
          { href: "#finance", label: "Accounting overview" },
          { href: "#inventory", label: "Inventory and transfers" },
          { href: "#erp-operations", label: "Purchasing and sales" },
          { href: "#erp-advanced", label: "Advanced accounting" },
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

      {success && (
        <div
          role="status"
          className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2"
        >
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Trial Balance & Costing Overview */}
      <section id="finance" className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-emerald-600" />
            <h2 className="text-sm font-bold text-stone-900">{t("Trial balance check", "試算表檢查")}</h2>
          </div>
          <span className="text-xs font-mono font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
            {tb?.isBalanced
              ? t("✓ Debits and credits balanced (Balanced)", "✓ 借貸平衡 (Balanced)")
              : t("Debits and credits unbalanced", "借貸不平衡")}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="p-3 bg-stone-50 rounded-lg border border-stone-200">
            <div className="text-stone-500 font-medium">{t("Total debits (Grand Debit)", "借方總額 (Grand Debit)")}</div>
            <div className="text-xl font-bold font-mono text-stone-900 mt-1">${tb?.grandDebit?.toLocaleString()}</div>
          </div>
          <div className="p-3 bg-stone-50 rounded-lg border border-stone-200">
            <div className="text-stone-500 font-medium">{t("Total credits (Grand Credit)", "貸方總額 (Grand Credit)")}</div>
            <div className="text-xl font-bold font-mono text-stone-900 mt-1">${tb?.grandCredit?.toLocaleString()}</div>
          </div>
          <div className="p-3 bg-stone-50 rounded-lg border border-stone-200">
            <div className="text-stone-500 font-medium">
              {t("Moving average cost (Moving Average)", "移動平均成本 (Moving Average)")}
            </div>
            <div className="text-xl font-bold font-mono text-emerald-700 mt-1">
              ${data?.costing?.[0]?.movingAverageCost?.toLocaleString() ?? "—"} / {t("units", "件")}
            </div>
            <div className="text-[10px] text-stone-400">
              {data?.items?.find((item: any) => item.id === data?.costing?.[0]?.itemId)?.name || t("No cost data", "無成本資料")}{" "}
              · {t("Book cost", "帳面成本")}
            </div>
          </div>
        </div>
      </section>

      {/* Main Grid: Stock Ledger & Transfer */}
      <div id="inventory" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Stock Ledger & Invoices */}
        <div className="lg:col-span-2 space-y-6">
          <section className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-stone-700" />
                <span>{t("Stock ledger (Stock Ledger)", "庫存異動明細帳 (Stock Ledger)")}</span>
              </h3>
              <span className="text-xs text-stone-500">{t("Latest posted transactions", "最新過帳異動")}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 bg-stone-50/50">
                    <th className="p-2.5 font-medium">{t("Reference", "單據編號")}</th>
                    <th className="p-2.5 font-medium">{t("Warehouse", "倉庫")}</th>
                    <th className="p-2.5 font-medium">{t("Movement type", "異動類型")}</th>
                    <th className="p-2.5 font-medium">{t("Quantity change", "異動數量")}</th>
                    <th className="p-2.5 font-medium">{t("Closing balance", "異動後餘額")}</th>
                    <th className="p-2.5 font-medium">{t("Unit cost", "單位成本")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 font-mono">
                  {data?.stockLedger.slice(0, 8).map((stk: any) => (
                    <tr key={stk.id} className="hover:bg-stone-50/80">
                      <td className="p-2.5 font-medium text-stone-900">{stk.referenceDoc}</td>
                      <td className="p-2.5">
                        {data?.warehouses.find((warehouse: any) => warehouse.id === stk.warehouseId)?.name ||
                          stk.warehouseId}
                      </td>
                      <td className="p-2.5">
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-700 font-sans">
                          {stk.changeType}
                        </span>
                      </td>
                      <td
                        className={`p-2.5 font-bold ${stk.quantityChange > 0 ? "text-emerald-700" : "text-rose-600"}`}
                      >
                        {stk.quantityChange > 0 ? `+${stk.quantityChange}` : stk.quantityChange}
                      </td>
                      <td className="p-2.5 font-bold text-stone-900">{stk.balanceAfter}</td>
                      <td className="p-2.5 text-stone-600">${stk.unitCost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Invoices & Settlement */}
          <section className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span>{t("Settle receivables and payables", "應收與應付帳款核銷結算")}</span>
            </h3>

            <div className="space-y-3 text-xs">
              {data?.invoices.map((inv: any) => {
                const unpaid = inv.totalAmount - inv.paidAmount;
                return (
                  <div
                    key={inv.id}
                    className="p-4 rounded-xl border border-stone-200 bg-stone-50 flex flex-wrap items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="font-mono font-bold text-stone-900">{inv.invoiceNumber}</div>
                      <div className="text-stone-500">
                        {t("Total", "總額")}: ${inv.totalAmount} | {t("Paid", "已付")}: ${inv.paidAmount} |{" "}
                        {t("Outstanding", "未結")}: ${unpaid}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {unpaid > 0 ? (
                        <>
                          <input
                            type="number"
                            min="1"
                            max={unpaid}
                            value={payAmount}
                            onChange={e => setPayAmount(parseInt(e.target.value) || 0)}
                            className="w-24 p-1.5 rounded border border-stone-300 text-xs font-mono"
                          />
                          <button
                            onClick={() => handlePayInvoice(inv.id)}
                            disabled={paying}
                            className="px-3 py-1.5 rounded-lg bg-primary hover:bg-[#0040b0] text-white font-medium text-xs shadow-sm transition"
                          >
                            {paying ? t("Processing payment...", "付款處理中…") : t("Collect balance", "收取/支付帳款")}
                          </button>
                        </>
                      ) : (
                        <span className="text-emerald-700 font-semibold px-2 py-1 bg-emerald-100 rounded">
                          {t("✓ Fully settled (Paid)", "✓ 已全數結清 (Paid)")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right Col: Inter-warehouse Transfer */}
        <div className="space-y-6">
          <section className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-emerald-600" />
              <span>{t("Warehouse transfer (stock conserved)", "跨倉庫調撥 (庫存總量守恆)")}</span>
            </h3>
            <p className="text-xs text-stone-500">
              {t(
                "An atomic transfer deducts from the source and adds to the destination, preserving total stock.",
                "原子調撥自來源倉扣除並計入目的倉，確保組織總庫存恆定不變。"
              )}
            </p>

            <form onSubmit={handleTransfer} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-stone-700 mb-1">{t("Transfer item", "調撥品項")}</label>
                <select
                  aria-label={t("Transfer item", "調撥品項")}
                  value={transferItem}
                  onChange={e => setTransferItem(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 p-2 text-xs"
                >
                  {data?.items.map((it: any) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">{t("Source warehouse", "來源倉庫")}</label>
                  <select
                    aria-label={t("Source warehouse", "來源倉庫")}
                    value={fromWh}
                    onChange={e => setFromWh(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 p-2 text-xs"
                  >
                    {data?.warehouses.map((w: any) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">
                    {t("Destination warehouse", "目的倉庫")}
                  </label>
                  <select
                    aria-label={t("Destination warehouse", "目的倉庫")}
                    value={toWh}
                    onChange={e => setToWh(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 p-2 text-xs"
                  >
                    {data?.warehouses.map((w: any) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">
                  {t("Transfer quantity (units)", "調撥數量 (件)")}
                </label>
                <input
                  aria-label={t("Transfer quantity (units)", "調撥數量 (件)")}
                  type="number"
                  min="1"
                  value={transferQty}
                  onChange={e => setTransferQty(parseInt(e.target.value) || 1)}
                  className="w-full rounded-lg border border-stone-300 p-2 text-xs font-mono"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={transferring}
                className="w-full py-2.5 rounded-lg bg-primary hover:bg-[#0040b0] text-white font-medium text-xs transition shadow-sm"
              >
                {transferring ? t("Transferring...", "調撥處理中…") : t("Confirm stock transfer", "確認執行庫存調撥")}
              </button>
            </form>
          </section>

          {/* Box Conversion Ratio Card */}
          <section className="bg-stone-50 rounded-xl border border-stone-200 p-5 space-y-2 text-xs">
            <h4 className="font-bold text-stone-900">{t("Units and pack conversion", "品項包裝與單位換算")}</h4>
            <p className="text-stone-600">
              {t(
                "Pack conversion converts two packs of ten sensor modules into twenty inventory units.",
                "入庫拆箱換算：將 2 箱感測模組（每箱 10 件）自動換算為 20 件庫存單位入帳。"
              )}
            </p>
          </section>
        </div>
      </div>
      {data && (
        <div id="erp-operations">
          <ErpOperations data={data} onSaved={fetchData} />
        </div>
      )}
      {data && (
        <div id="erp-advanced">
          <ErpAdvanced data={data} onSaved={fetchData} />
        </div>
      )}
    </main>
  );
}

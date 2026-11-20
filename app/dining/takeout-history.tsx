"use client";
import { useState } from "react";
import { usePortfolioLocale } from "@/components/portfolio-experience";

type Order = { id: string; takeoutNumber: string | null; totalAmount: number; status: string };
type Bill = { orderId: string | null; status: string; paidAmount: number };

export function TakeoutHistory({
  orders,
  bills,
  busy,
  onRefund,
}: {
  orders: Order[];
  bills: Bill[];
  busy: boolean;
  onRefund: (orderId: string, reason: string) => void;
}) {
  const { t } = usePortfolioLocale();
  const [reason, setReason] = useState("");
  const net = bills.filter(b => orders.some(o => o.id === b.orderId)).reduce((sum, b) => sum + b.paidAmount, 0);

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-bold">{t("Takeout pickup history", "外帶取餐紀錄歷程")}</h2>
        <p className="text-sm text-stone-600">
          {t("Net takeout receipts:", "外帶實收淨額:")} NT$ {net.toLocaleString("zh-TW")}
        </p>
      </div>
      <label className="block text-xs text-stone-600">
        {t(
          "Full refund reason (manager required; demo ledger only)",
          "全額退款原因 (須主管權限；僅限示範台帳)"
        )}
        <input
          className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm"
          maxLength={500}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={t("e.g. Customer canceled takeout", "例如：顧客取消外帶訂單")}
        />
      </label>
      {orders.length === 0 && (
        <p className="py-6 text-center text-sm text-stone-400">{t("No takeout orders", "尚無外帶訂單")}</p>
      )}
      {orders
        .slice()
        .reverse()
        .map(order => {
          const bill = bills.find(b => b.orderId === order.id);
          return (
            <article
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-100 py-4"
            >
              <div className="min-w-0">
                <p className="break-all font-mono text-sm font-semibold">{order.takeoutNumber}</p>
                <p className="mt-2 text-xs text-stone-500">
                  {order.status === "cancelled"
                    ? t("Canceled", "已取消")
                    : order.status === "completed"
                    ? t("Collected", "已取餐")
                    : t("Kitchen processing", "廚房製作中")}{" "}
                  · {bill?.status === "refunded" ? t("Fully refunded", "已全額退款") : t("Paid", "已付款")} · NT${" "}
                  {order.totalAmount.toLocaleString("zh-TW")}
                </p>
              </div>
              <button
                disabled={busy || !reason.trim() || bill?.status !== "paid"}
                onClick={() => onRefund(order.id, reason)}
                className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-40"
              >
                {t("Refund in full and cancel", "全額退款並取消")}
              </button>
            </article>
          );
        })}
    </section>
  );
}

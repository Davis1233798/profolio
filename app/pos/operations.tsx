"use client";
import { useState } from "react";
import { usePortfolioLocale } from "@/components/portfolio-experience";

type Props = { data: any; cart: any[]; setCart: (cart: any[]) => void; refresh: () => void };
const field = "w-full rounded-lg border border-stone-300 bg-white p-2 text-sm";
const button =
  "rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold hover:bg-stone-100 disabled:opacity-40";

export default function PosOperations({ data, cart, setCart, refresh }: Props) {
  const { t } = usePortfolioLocale();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cartName, setCartName] = useState("Guest cart");
  const [cash, setCash] = useState(1000);
  const [notes, setNotes] = useState("");
  const [selectedSale, setSelectedSale] = useState("");
  const [returns, setReturns] = useState<Record<string, number>>({});
  const [receipt, setReceipt] = useState<any>(null);
  const openShift = data.shifts.find((shift: any) => shift.status === "open");
  const sale = data.sales.find((entry: any) => entry.id === selectedSale);
  const lines = (data.saleLines || []).filter((line: any) => line.saleId === selectedSale);

  const action = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/pos/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json: any = await response.json();
      if (!json.success) throw new Error(json.error?.message || t("Operation failed", "操作失敗"));
      if (payload.action === "hold") setCart([]);
      if (payload.action === "retrieve") {
        const restored = json.data.items.map((line: any) => ({
          item: data.catalogItems.find((item: any) => item.barcode === line.barcode),
          quantity: line.quantity,
          lineDiscount: line.lineDiscount || 0,
        }));
        if (restored.some((line: any) => !line.item))
          throw new Error(
            t(
              "A held item is inactive. Contact an administrator.",
              "掛單中有商品已下架或無效，請聯絡管理員。"
            )
          );
        setCart(restored);
      }
      if (payload.action === "receipt") setReceipt(json.data);
      if (payload.action === "refund") setReturns({});
      setMessage(
        payload.action === "close"
          ? t(
              `Shift closed. Expected cash: $${json.data.expectedCash}, variance: $${json.data.discrepancy}`,
              `結班完成。應有現金：$${json.data.expectedCash}，差額：$${json.data.discrepancy}`
            )
          : payload.action === "refund"
          ? t(
              `Refund complete: $${json.data.totalRefundAmount}`,
              `退款完成：$${json.data.totalRefundAmount}`
            )
          : t("Operation complete", "作業完成")
      );
      refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <h2 className="text-lg font-bold">{t("Held carts, shifts and refunds", "暫存掛單、開結班與退貨作業")}</h2>
      {message && (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <article className="space-y-3 rounded-xl border bg-white p-5">
          <h3 className="font-semibold">{t("Hold cart", "暫存掛單")}</h3>
          <label className="block text-xs">
            {t("Held cart name", "掛單名稱")}
            <input
              className={field}
              value={cartName}
              maxLength={80}
              onChange={event => setCartName(event.target.value)}
            />
          </label>
          <button
            className={button}
            disabled={busy || !cart.length || !cartName.trim()}
            onClick={() =>
              action({
                action: "hold",
                storeId: data.stores[0]?.id,
                cartName,
                items: cart.map(line => ({
                  barcode: line.item.barcode,
                  quantity: line.quantity,
                  lineDiscount: line.lineDiscount,
                })),
              })
            }
          >
            {t("Hold and clear cart", "暫存並清空購物車")}
          </button>
          <p className="text-xs text-stone-500">
            {t(
              "Holding does not reserve stock. Recall into an empty cart and check out at current prices.",
              "掛單不保留庫存。取回時請確認購物車為空，結帳將以當前價格為準。"
            )}
          </p>
          {!data.heldCarts.length && (
            <p className="text-sm text-stone-400">{t("No held carts", "目前無暫存掛單")}</p>
          )}
          {data.heldCarts.map((held: any) => (
            <div key={held.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
              <span className="min-w-0 break-words">{held.cartName}</span>
              <button
                className={button}
                disabled={busy || cart.length > 0}
                onClick={() => action({ action: "retrieve", cartId: held.id })}
              >
                {t("Recall", "取回掛單")}
              </button>
            </div>
          ))}
        </article>
        <article className="space-y-3 rounded-xl border bg-white p-5">
          <h3 className="font-semibold">
            {openShift ? t("Cash count and shift closing", "現金盤點與交班結班") : t("Open new shift", "開啟新班次")}
          </h3>
          <p className="break-all text-xs text-stone-500">
            {openShift
              ? `${t("Current shift", "目前班次")} ${openShift.id}，${t("Opening cash", "開班備用金")}: $${
                  openShift.openingCash
                }`
              : t("No open shift. Enter opening cash first.", "尚未開班。請先輸入開班備用金以開班。")}
          </p>
          <label className="block text-xs">
            {openShift ? t("Counted cash TWD", "實盤現金 (新台幣 TWD)") : t("Opening cash TWD", "開班備用金 (新台幣 TWD)")}
            <input
              type="number"
              min={0}
              step={1}
              className={field}
              value={cash}
              onChange={event => setCash(Number(event.target.value))}
            />
          </label>
          {openShift && (
            <label className="block text-xs">
              {t("Variance notes (required for discrepancies)", "差額說明 (有盤差時必填)")}
              <input
                className={field}
                maxLength={500}
                value={notes}
                onChange={event => setNotes(event.target.value)}
              />
            </label>
          )}
          <button
            className={button}
            disabled={busy || !Number.isSafeInteger(cash) || cash < 0}
            onClick={() =>
              action(
                openShift
                  ? { action: "close", shiftId: openShift.id, closingCash: cash, notes }
                  : { action: "open", registerId: data.registers[0]?.id, openingCash: cash }
              )
            }
          >
            {openShift ? t("Close shift", "確認結班") : t("Open shift", "開班")}
          </button>
        </article>
      </div>
      <article className="space-y-4 rounded-xl border bg-white p-5">
        <h3 className="font-semibold">{t("Receipts and refunds", "收據查詢與退貨退款")}</h3>
        <label className="block text-xs">
          {t("Original sale", "原銷售單據")}
          <select
            className={field}
            value={selectedSale}
            onChange={event => {
              setSelectedSale(event.target.value);
              setReturns({});
              setReceipt(null);
            }}
          >
            <option value="">{t("Select a sale", "請選擇銷售單")}</option>
            {data.sales.map((entry: any) => (
              <option key={entry.id} value={entry.id}>
                {entry.receiptNumber} · ${entry.totalAmount}
              </option>
            ))}
          </select>
        </label>
        {!data.sales.length && (
          <p className="text-sm text-stone-400">
            {t("Receipts and refunds are available after the first sale.", "完成首筆交易後即可查詢收據或辦理退款。")}
          </p>
        )}
        {sale && (
          <>
            <button
              className={button}
              disabled={busy}
              onClick={() => action({ action: "receipt", receiptNumber: sale.receiptNumber })}
            >
              {t("View reprinted receipt", "檢視補印收據")}
            </button>
            {lines.map((line: any) => (
              <div
                key={line.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"
              >
                <span>
                  {line.name} · {t("Purchased", "購買")} {line.quantity} · {t("Returned", "已退")}{" "}
                  {line.refundedQuantity}
                </span>
                <label className="text-xs">
                  {t("Return quantity", "退貨數量")}
                  <input
                    type="number"
                    min={0}
                    max={line.quantity - line.refundedQuantity}
                    step={1}
                    className="ml-2 w-20 rounded border p-2"
                    value={returns[line.id] || 0}
                    onChange={event => setReturns({ ...returns, [line.id]: Number(event.target.value) })}
                  />
                </label>
              </div>
            ))}
            <label className="block text-xs">
              {t("Refund reason (manager access)", "退款原因 (需主管權限)")}
              <input
                className={field}
                value={notes}
                maxLength={500}
                onChange={event => setNotes(event.target.value)}
              />
            </label>
            <button
              className={button}
              disabled={busy || !notes.trim() || !Object.values(returns).some(quantity => quantity > 0)}
              onClick={() =>
                action({
                  action: "refund",
                  saleId: sale.id,
                  reason: notes,
                  lineReturns: Object.entries(returns)
                    .filter(([, quantity]) => quantity > 0)
                    .map(([lineId, quantity]) => ({ lineId, quantity })),
                })
              }
            >
              {t("Confirm return and cash refund", "確認退貨並以現金退款")}
            </button>
          </>
        )}
        {receipt && (
          <div className="rounded-lg border-2 border-dashed bg-stone-50 p-4 font-mono text-sm">
            <strong>
              [{t("REPRINTED RECEIPT", "補印收據")}] {receipt.receiptNumber}
            </strong>
            <p>{t("Cash transaction demo · Not a tax invoice", "現金交易示範 · 非正式稅務發票")}</p>
            {receipt.lines.map((line: any) => (
              <p key={line.id}>
                {line.name} × {line.quantity}: ${line.lineTotal}
              </p>
            ))}
            <p>
              {t("Total", "總額")} ${receipt.totalAmount} · {t("Tendered", "實收")} ${receipt.tenderAmount} ·{" "}
              {t("Change", "找零")} ${receipt.changeAmount}
            </p>
          </div>
        )}
      </article>
    </section>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import theme from "@/components/infrastructure-theme.module.css";
import { usePortfolioLocale } from "@/components/portfolio-experience";

type Reading = {
  time: string;
  device: string;
  value: number;
  anomaly: boolean;
  assessment?: {
    status: string;
    samples: number;
    score: number | null;
    threshold: number | null;
    model_id: string | null;
    decision_method: string;
  } | null;
};
type ProjectedOrder = {
  revision: number;
  order: {
    id: string;
    orderNo: string;
    status: string;
    targetQuantity: number;
    completedQuantity: number;
    scrappedQuantity: number;
  };
  quality: { failedQuantity: number };
};

export default function IndustrialPage() {
  const { t } = usePortfolioLocale();
  const orderStates: Record<string, string> = {
    draft: t("Draft", "草稿"),
    released: t("Released", "已下達"),
    in_progress: t("In progress", "進行中"),
    completed: t("Completed", "已完工"),
    closed: t("Closed", "已結案"),
  };

  const [message, setMessage] = useState(
    t(
      "Refresh measurements to read equipment records for this organization.",
      "請點擊重新整理量測以讀取此組織的設備紀錄。"
    )
  );
  const [rows, setRows] = useState<Reading[]>([]);
  const [orders, setOrders] = useState<ProjectedOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/mes/industrial");
      const data = (await response.json()) as {
        status?: string;
        measurements?: Reading[];
        workOrders?: ProjectedOrder[];
      };
      if (!response.ok)
        throw new Error(
          data.status === "not_configured"
            ? t("Equipment data service is not connected. Contact your administrator.", "設備資料服務未連線，請聯絡管理員。")
            : t("Equipment data service is temporarily unavailable. Try again later.", "設備資料服務暫時無法使用，請稍後再試。")
        );
      if (!Array.isArray(data.measurements) || !Array.isArray(data.workOrders))
        throw new Error(t("Invalid equipment data format.", "設備資料格式無效。"));
      setRows(data.measurements);
      setOrders(data.workOrders);
      setLoaded(true);
      setMessage(
        t(
          `Updated ${data.measurements.length} measurements and ${data.workOrders.length} work order summaries.`,
          `已更新 ${data.measurements.length} 筆設備量測與 ${data.workOrders.length} 筆工單摘要。`
        )
      );
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : t("Connection failed. Try again later.", "連線失敗，請稍後再試。"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main data-site="mes" className={`${theme.mes} min-h-screen`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <Link href="/mes" className="inline-flex text-primary text-sm">
          ← {t("ForgeFlow Manufacturing workspace", "智慧製造 ForgeFlow 工作區")}
        </Link>
        <header className="flex flex-wrap justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="text-xs text-stone-600 dark:text-stone-400 tracking-widest">{t("FORGEFLOW / EQUIPMENT", "智慧製造 / 設備監測")}</p>
            <h1 className="text-3xl font-semibold mt-2">
              {t("Equipment measurements and anomaly tracking", "設備量測監控與異常偵測追蹤")}
            </h1>
            <p className="text-sm text-stone-600 mt-2">
              {t("Inspect the latest 100 equipment signals and production status.", "檢視最新 100 筆設備訊號與產線即時狀態。")}
            </p>
          </div>
          <button
            disabled={loading}
            onClick={load}
            className="inline-flex bg-primary text-white rounded-lg px-5 py-3 self-center"
          >
            {loading ? t("Refreshing…", "更新中…") : t("Refresh measurements", "重新整理量測")}
          </button>
        </header>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            [t("Measurements", "量測次數"), rows.length],
            [t("Anomaly signals", "異常訊號次數"), rows.filter(r => r.anomaly).length],
            [t("Equipment count", "監控設備總數"), new Set(rows.map(r => r.device)).size],
          ].map(([label, value]) => (
            <section key={label as string} className="border rounded-xl p-5">
              <p className="text-xs text-stone-600">{label}</p>
              <p className="text-3xl tabular-nums font-semibold mt-2">{loaded ? value : "—"}</p>
            </section>
          ))}
        </div>
        <p role={error ? "alert" : "status"} className={`text-sm ${error ? "text-red-800" : "text-stone-600"}`}>
          {message}
        </p>
        <section className="border rounded-xl overflow-hidden">
          <h2 className="font-semibold p-5 border-b border-border">{t("Measurement history", "設備量測歷程")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr>
                  <th scope="col">{t("Measurement time (Taipei)", "量測時間 (台北)")}</th>
                  <th scope="col">{t("Equipment", "設備名稱")}</th>
                  <th scope="col">{t("Value", "數值")}</th>
                  <th scope="col">{t("Anomaly assessment", "異常評估判定")}</th>
                  <th scope="col">{t("Model basis", "模型判斷基準")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.device}:${r.time}:${i}`} className="border-t border-border">
                    <td>{new Date(r.time).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</td>
                    <td>{r.device}</td>
                    <td className="tabular-nums">{r.value}</td>
                    <td>
                      <span className={r.anomaly ? "text-amber-800 font-semibold" : "text-stone-600"}>
                        {r.anomaly ? t("⚠ Anomaly signals", "⚠ 異常訊號") : t("No anomaly flag", "正常無標記")}
                      </span>
                    </td>
                    <td className="text-xs text-stone-600">
                      {r.assessment?.status === "ready" ? (
                        <span title={r.assessment.model_id ?? undefined}>
                          Isolation Forest · {r.assessment.samples} {t("records", "筆")}
                          <br />
                          {t("Score", "分數")} {r.assessment.score?.toFixed(3)} / {t("threshold", "門檻值")}{" "}
                          {r.assessment.threshold?.toFixed(3)}
                        </span>
                      ) : r.assessment ? (
                        `${
                          r.assessment.status === "insufficient_variation"
                            ? t("Insufficient signal variation", "訊號變異不足")
                            : t("Model warmup", "模型暖機中")
                        } · ${r.assessment.samples} ${t("records", "筆")}`
                      ) : (
                        t("Historical statistics", "歷史統計基準")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <p className="text-sm text-stone-600 p-8 text-center">
              {loaded
                ? t("No equipment measurements available.", "目前無設備量測資料。")
                : t("Refresh measurements to display records here.", "請點擊重新整理量測以載入數據。")}
            </p>
          )}
        </section>
        <p className="text-xs text-stone-600">
          {t(
            "Each equipment model uses up to 256 prior measurements for Isolation Forest, requiring at least 64 samples and varying signals. Warmup uses a statistical baseline. Scores above the threshold suggest unusual signals for human review. The model has not been validated against real factory failures.",
            "每個設備模型最多使用先前 256 筆量測數據進行孤立森林 (Isolation Forest) 訓練，需要至少 64 筆有效樣本。分數超過門檻值代表異常訊號以供人工檢視。此模型尚未經真實工廠故障驗證。"
          )}
        </p>
        <section className="border rounded-xl overflow-hidden">
          <div className="p-5 border-b border-border">
            <h2 className="font-semibold">{t("Synchronized work order summary", "工單同步總覽摘要")}</h2>
            <p className="text-sm text-stone-600 mt-2 leading-7">
              {t(
                "Read summaries from work orders, reports and quality changes refresh each minute. Check the manufacturing workspace for current state before operations.",
                "從工單、報工與品檢異動摘要每分鐘更新一次。操作前請至製造工作區確認即時狀態。"
              )}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr>
                  <th scope="col">{t("Work order", "工單編號")}</th>
                  <th scope="col">{t("Production status", "生產狀態")}</th>
                  <th scope="col">{t("Good / Target", "良品數 / 目標量")}</th>
                  <th scope="col">{t("Scrap", "報廢數")}</th>
                  <th scope="col">{t("Quality defects", "品管不合格數")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(({ order, quality }) => (
                  <tr key={order.id} className="border-t border-border">
                    <td>{order.orderNo}</td>
                    <td>{orderStates[order.status] ?? order.status}</td>
                    <td className="tabular-nums">
                      {order.completedQuantity} / {order.targetQuantity}
                    </td>
                    <td className="tabular-nums">{order.scrappedQuantity}</td>
                    <td className="tabular-nums">{quality.failedQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!orders.length && (
            <p className="text-sm text-stone-600 p-8 text-center">
              {loaded
                ? t("No synchronized work orders. Refresh after the next sync.", "目前無同步工單，請於下次同步後重新整理。")
                : t("Refresh to show synchronized work order summaries.", "請點擊重新整理以顯示同步工單摘要。")}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

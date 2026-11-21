"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import styles from "./mes-workbench.module.css";
import { MesOperations } from "@/components/domain-operations";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import { Factory, CheckCircle, AlertTriangle, RotateCcw } from "lucide-react";

export default function MesPage() {
  const { t, locale } = usePortfolioLocale();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Report form state
  const [selectedWo, setSelectedWo] = useState<string>("");
  const [goodQty, setGoodQty] = useState<number>(10);
  const [scrapQty, setScrapQty] = useState<number>(0);
  const [reportNote, setReportNote] = useState<string>("");
  const [reporting, setReporting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);
  const reportAttempt = useRef({ signature: "", key: "" });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/mes/data");
      const json: any = await res.json();
      if (json.success) {
        setData(json.data);
        setUpdatedAt(new Date().toLocaleTimeString("en-US", { hour12: false }));
        if (json.data.workOrders.length > 0 && !selectedWo) {
          setSelectedWo(json.data.workOrders[0].id);
        }
      } else {
        setError(json.error?.message || t("Unable to load MES data", "無法載入 MES 資料"));
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

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWo) return;
    setReporting(true);
    setReportSuccess(null);
    setError(null);

    try {
      const wo = data.workOrders.find((w: any) => w.id === selectedWo);
      const op = data.operations.find((o: any) => o.workOrderId === selectedWo);
      const signature = JSON.stringify([selectedWo, op?.id, goodQty, scrapQty, reportNote]);
      if (reportAttempt.current.signature !== signature) reportAttempt.current = { signature, key: crypto.randomUUID() };

      const res = await fetch("/api/mes/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workOrderId: selectedWo,
          operationId: op?.id || "op_default",
          goodQuantity: goodQty,
          scrapQuantity: scrapQty,
          notes: reportNote || "Routine production report",
          idempotencyKey: reportAttempt.current.key,
        }),
      });

      const json: any = await res.json();
      if (json.success) {
        reportAttempt.current = { signature: "", key: "" };
        setReportSuccess(
          t(
            `Report saved. Good units: ${json.data.goodQuantity}, scrap: ${json.data.scrapQuantity}, completed total: ${json.data.totalCompleted}`,
            `報工已儲存。良品數：${json.data.goodQuantity}，報廢數：${json.data.scrapQuantity}，累計完工數：${json.data.totalCompleted}`
          )
        );
        fetchData();
      } else {
        setError(json.error?.message || t("Production reporting failed", "生產報工失敗"));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReporting(false);
    }
  };

  const orders = data?.workOrders ?? [];
  const selected = orders.find((wo: any) => wo.id === selectedWo);
  const productName = (id: string) => data?.products?.find((p: any) => p.id === id)?.name ?? "—";
  const statusNames: Record<string, string> = {
    draft: t("Draft", "草稿"),
    released: t("Released", "已下達"),
    in_progress: t("In progress", "進行中"),
    completed: t("Completed", "已完工"),
    closed: t("Closed", "已結案"),
  };
  const visibleOrders = orders.filter(
    (wo: any) =>
      (statusFilter === "all" || wo.status === statusFilter) &&
      `${wo.orderNo} ${productName(wo.productId)}`.toLowerCase().includes(query.toLowerCase())
  );
  const good = orders.reduce((n: number, w: any) => n + w.completedQuantity, 0);
  const scrap = orders.reduce((n: number, w: any) => n + w.scrappedQuantity, 0);
  const target = orders.reduce((n: number, w: any) => n + w.targetQuantity, 0);
  const quality = data?.qualityChecks ?? [];
  const materials = (data?.materials ?? []).filter((m: any) => m.workOrderId === selectedWo);
  const stamp = (value: string) =>
    value
      ? new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : value.replace(" ", "T") + "Z").toLocaleString(
          "zh-TW",
          {
            timeZone: "Asia/Taipei",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }
        )
      : "—";
  const panelTitle = (title: string, count?: number) => (
    <div className={styles.panelTitle}>
      <h2>{title}</h2>
      {count !== undefined && <span>{count} {t("records", "筆紀錄")}</span>}
    </div>
  );
  const badge = (status: string) => (
    <span
      className={`${styles.badge} ${
        status === "in_progress"
          ? styles.active
          : status === "completed" || status === "closed"
          ? styles.success
          : ""
      }`}
    >
      {statusNames[status] ?? status}
    </span>
  );

  return (
    <main data-site="mes" className={styles.shell}>
      <div className={styles.appBar}>
        <span>
          <Factory size={17} /> {locale === "zh-TW" ? "智慧製造 ForgeFlow" : "ForgeFlow"} <b>{t("Manufacturing execution", "製造執行系統")}</b>
        </span>
        <nav aria-label={t("MES Workspace", "MES 製造工作區")}>
          <a href="#dispatch">{t("Shop floor overview", "生產現場總覽")}</a>
          <a href="#trace">{t("Material traceability", "物料批號追溯")}</a>
          <a href="#workflow">{t("Production operations", "生產作業中心")}</a>
          <Link href="/mes/industrial">{t("Equipment and AIoT ↗", "設備監測與 AIoT ↗")}</Link>
        </nav>
      </div>
      <div className={styles.content}>
        <header className={styles.pageHeader}>
          <div>
            <p>{t("Manufacturing / Production control", "製造管理 / 生產管制")}</p>
            <h1>
              {t("Manufacturing workspace", "製造工作區")}{" "}
              <span>{t("Shop floor overview", "現場作業總覽")}</span>
            </h1>
          </div>
          <div className={styles.headerActions}>
            <span role="status">
              {loading
                ? t("Updating data…", "更新資料中…")
                : updatedAt
                ? `${t("Refresh", "重新整理")} ${updatedAt}`
                : t("Not loaded", "尚未載入")}
            </span>
            <button onClick={fetchData} disabled={loading}>
              <RotateCcw size={14} />
              {t("Refresh", "重新整理")}
            </button>
            <a href="#workflow" className={styles.primary}>
              {t("Production operations", "前往生產作業")}
            </a>
          </div>
        </header>
        {error && (
          <div role="alert" className={styles.error}>
            <AlertTriangle size={15} />
            {error}
          </div>
        )}
        {reportSuccess && (
          <div role="status" className={styles.notice}>
            <CheckCircle size={15} />
            {reportSuccess}
          </div>
        )}
        {loading && !data && (
          <p role="status" className={styles.notice}>
            {t(
              "Loading work orders, materials and production records…",
              "正在載入工單、原物料與生產報工紀錄…"
            )}
          </p>
        )}
        <section className={styles.metrics} aria-label={t("Organization production summary", "組織生產數據彙總")}>
          {[
            [t("Work orders", "工單總數"), orders.length, t("All work orders", "全部工單")],
            [t("In progress", "進行中"), orders.filter((w: any) => w.status === "in_progress").length, t("Started", "已開工")],
            [t("Good units completed", "完工良品"), good, `${t("Target", "目標")} ${target} ${t("units", "件")}`],
            [t("Scrap quantity", "報廢數量"), scrap, t("Total reported", "累計已報廢")],
            [
              t("Production yield", "生產良率"),
              good + scrap ? `${((good / (good + scrap)) * 100).toFixed(1)}%` : "—",
              t("Good / reported units", "良品 / 報工總數"),
            ],
            [
              t("Materials pending", "待備料工單"),
              orders.filter((w: any) => !w.materialsStaged && !["completed", "closed"].includes(w.status)).length,
              t("Work orders awaiting materials", "等待備料工單"),
            ],
          ].map(([label, value, hint]) => (
            <div key={label as string}>
              <p>{label}</p>
              <strong>{data ? value : "—"}</strong>
              <small>{hint}</small>
            </div>
          ))}
        </section>
        <div className={styles.workspace}>
          <div className={styles.overview}>
            <section id="dispatch" className={styles.panel} aria-label={t("Shop floor work orders", "現場工單")}>
              {panelTitle(t("Work orders", "生產工單"), orders.length)}
              <div className={styles.filters}>
                <label>
                  {t("Search work orders", "搜尋工單")}
                  <input
                    aria-label={t("Search work order or product", "搜尋工單或產品")}
                    placeholder={t("Work order / Product", "工單編號 / 產品品名")}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                  />
                </label>
                <label>
                  {t("Work order status", "工單狀態")}
                  <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                    <option value="all">{t("All statuses", "全部狀態")}</option>
                    {Object.entries(statusNames).map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <span>
                  {visibleOrders.length} / {orders.length} {t("records", "筆紀錄")}
                </span>
              </div>
              <div className={styles.tableScroll}>
                <table>
                  <thead>
                    <tr>
                      {[
                        t("Work order / Product", "工單編號 / 產品品名"),
                        t("Status", "狀態"),
                        t("Target", "目標量"),
                        t("Good", "良品"),
                        t("Scrap", "報廢"),
                        t("Completion", "完工進度"),
                        t("Materials", "備料狀態"),
                        t("Actions", "操作"),
                      ].map(h => (
                        <th key={h} scope="col">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOrders.map((wo: any) => {
                      const progress = wo.targetQuantity
                        ? Math.min(100, ((wo.completedQuantity + wo.scrappedQuantity) / wo.targetQuantity) * 100)
                        : 0;
                      return (
                        <tr key={wo.id} className={selectedWo === wo.id ? styles.selected : ""}>
                          <td>
                            <b className={styles.orderNo}>{wo.orderNo}</b>
                            <small className={styles.subline}>{productName(wo.productId)}</small>
                          </td>
                          <td>{badge(wo.status)}</td>
                          <td className={styles.number}>{wo.targetQuantity}</td>
                          <td className={`${styles.number} ${styles.good}`}>{wo.completedQuantity}</td>
                          <td className={`${styles.number} ${wo.scrappedQuantity ? styles.bad : ""}`}>
                            {wo.scrappedQuantity}
                          </td>
                          <td>
                            <div className={styles.progress}>
                              <span style={{ width: `${progress}%` }} />
                            </div>
                            <small>{progress.toFixed(0)}%</small>
                          </td>
                          <td>
                            <span className={wo.materialsStaged ? styles.good : styles.warning}>
                              {wo.materialsStaged ? t("✓ Ready", "✓ 已備妥") : t("△ Materials pending", "△ 待備料")}
                            </span>
                          </td>
                          <td>
                            <button
                              aria-pressed={selectedWo === wo.id}
                              aria-label={`${t("Select", "選取")} ${wo.orderNo}`}
                              onClick={() => {
                                setSelectedWo(wo.id);
                                setReportSuccess(null);
                              }}
                            >
                              {t("Select", "選取")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!visibleOrders.length && (
                <p className={styles.empty}>
                  {loading ? t("Loading data", "載入資料中…") : t("No matching work orders", "查無符合工單")}
                </p>
              )}
              <div className={styles.tableFooter}>
                <span>
                  {t(
                    "Select a work order to report production and inspect material inputs.",
                    "請選擇工單以進行報工或檢視投料追溯。"
                  )}
                </span>
                <span>{t("Quantity unit: pieces", "數量單位：件 (pcs)")}</span>
              </div>
            </section>
            <div className={styles.detailGrid}>
              <section id="trace" className={styles.panel} aria-label={t("Material lots", "原物料批號清單")}>
                {panelTitle(t("Material lots", "原物料批號清單"), data?.lots?.length ?? 0)}
                <div className={styles.smallScroll}>
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{t("Lot / Material", "批號 / 原物料")}</th>
                        <th scope="col">{t("Received", "入庫數量")}</th>
                        <th scope="col">{t("Available balance", "可用餘額")}</th>
                        <th scope="col">{t("Status", "狀態")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.lots?.map((lot: any) => (
                        <tr key={lot.id}>
                          <td>
                            <b>{lot.lotNumber}</b>
                            <small className={styles.subline}>{lot.materialSku}</small>
                          </td>
                          <td className={styles.number}>{lot.initialQuantity}</td>
                          <td className={`${styles.number} ${styles.good}`}>{lot.currentQuantity}</td>
                          <td>
                            {["active", "available"].includes(lot.status)
                              ? t("Available", "可用")
                              : lot.status === "depleted"
                              ? t("Exhausted", "已耗盡")
                              : lot.status === "quarantined"
                              ? t("Quarantined", "已隔離")
                              : lot.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data?.lots?.length && (
                    <p className={styles.empty}>{t("No material lots", "目前無物料批號")}</p>
                  )}
                </div>
              </section>
              <section className={styles.panel} aria-label={t("Recent production reports", "最近生產報工紀錄")}>
                {panelTitle(t("Recent production reports", "最近生產報工紀錄"), data?.reports?.length ?? 0)}
                <div className={styles.smallScroll}>
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{t("Work order / Time", "工單 / 報工時間")}</th>
                        <th scope="col">{t("Good", "良品")}</th>
                        <th scope="col">{t("Scrap", "報廢")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...(data?.reports ?? [])]
                        .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
                        .slice(0, 20)
                        .map((r: any) => (
                          <tr key={r.id}>
                            <td>
                              <b>{orders.find((w: any) => w.id === r.workOrderId)?.orderNo ?? "—"}</b>
                              <small className={styles.subline}>{stamp(r.createdAt)}</small>
                            </td>
                            <td className={`${styles.number} ${styles.good}`}>{r.goodQuantity}</td>
                            <td className={styles.number}>{r.scrapQuantity}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!data?.reports?.length && (
                    <p className={styles.empty}>
                      {t("Submitted production reports will appear here.", "提交的報工紀錄將顯示於此處。")}
                    </p>
                  )}
                </div>
              </section>
            </div>
            <section className={styles.panel} aria-label={t("Selected work order traceability", "選定工單投料追溯")}>
              {panelTitle(t("Material input traceability", "原物料投料追溯明細"), materials.length)}
              <div className={styles.traceRows}>
                {materials.map((m: any) => (
                  <div key={m.id}>
                    <b>{data?.lots?.find((l: any) => l.id === m.materialLotId)?.lotNumber ?? "—"}</b>
                    <span>{m.materialSku}</span>
                    <span>
                      {t("Material issued", "已領料")} {m.issuedQuantity}
                    </span>
                    <span>
                      {t("Material returned", "已退料")} {m.returnedQuantity}
                    </span>
                    <strong>
                      {t("Net consumption", "淨耗用量")} {m.netQuantity}
                    </strong>
                  </div>
                ))}
                {!materials.length && (
                  <p className={styles.empty}>
                    {t("No material movements for this work order.", "此工單目前尚無領退料異動紀錄。")}
                  </p>
                )}
              </div>
            </section>
            <section aria-label={t("Work centers and downtime", "工作中心與停機紀錄")} className={`${styles.panel} ${styles.centers}`}>
              {panelTitle(t("Work centers and downtime", "工作中心與停機紀錄"), data?.workCenters?.length ?? 0)}
              <div className={styles.centerGrid}>
                {data?.workCenters?.map((center: any) => (
                  <div key={center.id}>
                    <Factory size={16} />
                    <b>{center.name}</b>
                    <span>{center.code}</span>
                    <span>
                      {t("Capacity", "額定產能")} {center.capacityMinutesPerDay} {t("min/day", "分鐘/天")}
                    </span>
                    <span>
                      {t("Downtime records", "停機紀錄")}{" "}
                      {(data.downtimeEvents ?? []).filter((d: any) => d.workCenterId === center.id).length}{" "}
                      {t("records", "筆紀錄")}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <aside className={styles.sidebar} aria-label={t("Work order operations and quality", "工單作業與品質")}>
            <section className={styles.panel}>
              {panelTitle(t("Work order details and reporting", "工單明細與報工作業"))}
              <div className={styles.selectedInfo}>
                <span>{t("Currently selected", "目前選取工單")}</span>
                <strong>{selected?.orderNo ?? t("Select a work order", "請選擇工單")}</strong>
                {selected && badge(selected.status)}
                <dl>
                  <div>
                    <dt>{t("Product", "產品品名")}</dt>
                    <dd>{selected ? productName(selected.productId) : "—"}</dd>
                  </div>
                  <div>
                    <dt>{t("Target / Reported", "目標量 / 已報工量")}</dt>
                    <dd>
                      {selected
                        ? `${selected.targetQuantity} / ${selected.completedQuantity + selected.scrappedQuantity}`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Remaining", "剩餘待產")}</dt>
                    <dd>
                      {selected
                        ? Math.max(0, selected.targetQuantity - selected.completedQuantity - selected.scrappedQuantity)
                        : "—"}
                    </dd>
                  </div>
                </dl>
              </div>
              <form className={styles.reportForm} onSubmit={handleReport}>
                <label htmlFor="mes-report-order">
                  {t("Work order", "工單")}
                  <select id="mes-report-order" value={selectedWo} onChange={e => setSelectedWo(e.target.value)}>
                    <option value="">{t("Select", "請選擇")}</option>
                    {orders.map((w: any) => (
                      <option key={w.id} value={w.id}>
                        {w.orderNo}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.quantityGrid}>
                  <label htmlFor="mes-good">
                    {t("Good quantity", "完工良品數量")}
                    <input
                      id="mes-good"
                      type="number"
                      min="0"
                      value={goodQty}
                      onChange={e => setGoodQty(Math.max(0, parseInt(e.target.value) || 0))}
                      required
                    />
                  </label>
                  <label htmlFor="mes-scrap">
                    {t("Scrap quantity", "報廢數量")}
                    <input
                      id="mes-scrap"
                      type="number"
                      min="0"
                      value={scrapQty}
                      onChange={e => setScrapQty(Math.max(0, parseInt(e.target.value) || 0))}
                    />
                  </label>
                </div>
                <label htmlFor="mes-note">
                  {t("Notes / Exceptions", "備註 / 異常原因")}
                  <input
                    id="mes-note"
                    value={reportNote}
                    onChange={e => setReportNote(e.target.value)}
                    placeholder={t("Enter batch notes", "請輸入批次備註或異常說明")}
                  />
                </label>
                <button
                  className={styles.primary}
                  disabled={reporting || !selected || selected.status !== "in_progress"}
                  type="submit"
                >
                  {reporting ? t("Submitting report…", "送出報工中…") : t("Submit production report", "送出生產報工")}
                </button>
                <p>
                  {selected?.status !== "in_progress"
                    ? t(
                        "Materials must be ready and the work order started before reporting.",
                        "報工前須確認已完成備料且工單處於進行中狀態。"
                      )
                    : t(
                        "Reporting updates work order totals and traceability records.",
                        "報工將即時更新工單累計完工數與追溯紀錄。"
                      )}{" "}
                  <a href="#workflow">{t("Go to production operations ↓", "前往生產作業區 ↓")}</a>
                </p>
              </form>
            </section>
            <section className={styles.panel} aria-label={t("Quality checks", "品管抽檢紀錄")}>
              {panelTitle(t("Quality checks", "品管抽檢紀錄"), quality.length)}
              <div className={styles.smallScroll}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t("Work order", "工單編號")}</th>
                      <th scope="col">{t("Sample / Defects", "抽檢 / 不合格")}</th>
                      <th scope="col">{t("Result", "判定結果")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quality.map((q: any) => (
                      <tr key={q.id}>
                        <td>{orders.find((w: any) => w.id === q.workOrderId)?.orderNo ?? "—"}</td>
                        <td className={styles.number}>
                          {q.sampleQuantity} / {q.failedQuantity}
                        </td>
                        <td>
                          <span className={q.status === "quarantined" ? styles.bad : styles.good}>
                            {q.status === "quarantined" ? t("Quarantined", "隔離") : t("Released", "放行")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!quality.length && (
                  <p className={styles.empty}>{t("No quality checks recorded.", "目前無品質抽檢紀錄。")}</p>
                )}
              </div>
            </section>
          </aside>
        </div>

        <div id="workflow" className={styles.operations}>
          {data && <MesOperations data={data} onSaved={fetchData} />}
        </div>
        <details className={styles.fixture}>
          <summary>
            {t(
              "OEE Calculation example · Fixed demo data, not live equipment efficiency",
              "OEE 設備綜合效率範例 · 示範基準數據（非即時設備）"
            )}
          </summary>
          <p>
            OEE {data?.oee?.oeePercent ?? "—"}% · {t("Availability", "稼動率")}{" "}
            {data?.oee?.availabilityPercent ?? "—"}% · {t("Performance", "性能率")}{" "}
            {data?.oee?.performancePercent ?? "—"}% · {t("Quality", "良率")}{" "}
            {data?.oee?.qualityPercent ?? "—"}%
          </p>
          <p>{t("Scheduled 480 min / Running 360 min / Total 300 units / Good 270 units.", "排程 480 分鐘 / 運轉 360 分鐘 / 總產量 300 件 / 良品 270 件。")}</p>
        </details>
        <footer className={styles.footer}>
          {t("ForgeFlow · Manufacturing executionWorkspace", "ForgeFlow · 製造執行系統工作區")}{" "}
          <span>
            {t(
              "Current organization · Quantities are cumulative per work order, not daily output",
              "目前組織 · 數量為各工單累計值，非單日產量"
            )}
          </span>
        </footer>
      </div>
    </main>
  );
}

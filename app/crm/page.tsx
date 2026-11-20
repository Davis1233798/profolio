"use client";

import { WorkspaceHeader, WorkspaceLinks, WorkspaceLoading } from "@/components/workspace-header";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import CrmOperations from "./operations";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import {
  Users,
  ArrowLeft,
  RotateCcw,
  UserPlus,
  TrendingUp,
  Calendar,
  CheckCircle2,
  LifeBuoy,
  Briefcase,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";

export default function CrmPage() {
  const { t } = usePortfolioLocale();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [convertingLead, setConvertingLead] = useState<string | null>(null);
  const [updatingStage, setUpdatingStage] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/crm/data");
      const json: any = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error?.message || t("Unable to load CRM data", "無法載入 CRM 資料"));
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

  const handleConvertLead = async (leadId: string) => {
    setConvertingLead(leadId);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/crm/lead/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          dealAmount: 80000,
        }),
      });

      const json: any = await res.json();
      if (json.success) {
        setSuccess(
          t(
            "Lead converted to account, contact and opportunity. (R02)",
            "潛客已一次轉換為客戶、聯絡人與業務商機。(R02)"
          )
        );
        fetchData();
      } else {
        setError(json.error?.message || t("Conversion failed", "轉換失敗"));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConvertingLead(null);
    }
  };

  const handleMoveStage = async (oppId: string, nextStageId: string, isWon: boolean, isLost: boolean) => {
    let wonReason = undefined;
    let lossReason = undefined;

    if (isWon) {
      wonReason =
        prompt(
          t("Enter a reason for winning:", "請輸入贏單成交原因："),
          t("Customer accepted the proposal and price", "客戶接受方案與報價")
        ) || undefined;
      if (!wonReason) return;
    } else if (isLost) {
      lossReason =
        prompt(
          t("Enter a reason for losing:", "請輸入失單原因："),
          t("Delayed due to customer budget", "因客戶年度預算調整而暫緩")
        ) || undefined;
      if (!lossReason) return;
    }

    setUpdatingStage(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/crm/opportunity/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: oppId,
          stageId: nextStageId,
          wonReason,
          lossReason,
        }),
      });

      const json: any = await res.json();
      if (json.success) {
        setSuccess(
          t(
            `Opportunity advanced. Amount: $${json.data.amount}, probability: ${json.data.probability}%, weighted amount: $${json.data.weightedAmount}`,
            `商機階段已推進。金額：$${json.data.amount}，成單機率：${json.data.probability}%，加權金額：$${json.data.weightedAmount}`
          )
        );
        fetchData();
      } else {
        setError(json.error?.message || t("Unable to advance", "無法推進商機階段"));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdatingStage(false);
    }
  };

  if (loading && !data) return <WorkspaceLoading name="RelationDesk" error={error} onRetry={fetchData} />;

  const funnel = data?.funnel;

  return (
    <main data-site="crm" className="suite-page suite-crm space-y-7">
      <WorkspaceHeader
        brand="RelationDesk"
        eyebrow="CRM / Customer workspace"
        title="Move every opportunity forward."
        description="Track the next step, from first contact through sales and support."
        onRefresh={fetchData}
        busy={loading}
      />
      <WorkspaceLinks
        links={[
          { href: "#pipeline-summary", label: "Performance summary" },
          { href: "#opportunities", label: "Opportunity board" },
          { href: "#crm-operations", label: "Accounts and activities" },
          { href: "#leads", label: "Leads and support" },
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
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Funnel Pipeline KPI Banner */}
      <section id="pipeline-summary" className="crm-summary bg-white rounded-xl border border-stone-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h2 className="text-sm font-bold text-stone-900">
              {t("Sales funnel and weighted opportunities", "銷售漏斗與加權商機預測")}
            </h2>
          </div>
          <span className="text-xs text-stone-500">
            {t("Win rate:", "成單率:")} {funnel?.winRatePercent}%
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div className="p-4 rounded-xl bg-[#f5e9d4] border border-stone-200">
            <div className="text-xs text-primary font-medium">
              {t("Weighted forecast (Weighted)", "加權預估值 (Weighted)")}
            </div>
            <div className="text-2xl font-black text-stone-900 mt-1">
              ${funnel?.totalWeightedAmount?.toLocaleString()}
            </div>
            <div className="text-[10px] text-stone-500 mt-0.5">
              {t("Amount x stage probability", "商機金額 × 階段成單機率")}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200">
            <div className="text-xs text-stone-600 font-medium">
              {t("Pipeline value (Pipeline)", "管線總金額 (Pipeline)")}
            </div>
            <div className="text-2xl font-black text-stone-900 mt-1">
              ${funnel?.totalPipelineAmount?.toLocaleString()}
            </div>
            <div className="text-[10px] text-stone-500 mt-0.5">
              {t("Total open opportunity value", "進行中商機總額")}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200">
            <div className="text-xs text-stone-600 font-medium">
              {t("Opportunity count", "進行中商機筆數")}
            </div>
            <div className="text-2xl font-black text-stone-900 mt-1">
              {funnel?.totalCount} {t("units", "筆")}
            </div>
            <div className="text-[10px] text-stone-500 mt-0.5">
              {t("Open opportunities by stage", "各階段進行中商機")}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200">
            <div className="text-xs text-stone-600 font-medium">
              {t("Win rate (Win Rate)", "成單率 (Win Rate)")}
            </div>
            <div className="text-2xl font-black text-emerald-700 mt-1">
              {funnel?.winRatePercent}%
            </div>
            <div className="text-[10px] text-stone-500 mt-0.5">
              {t("Won / total", "贏單數 / 總結案數")}
            </div>
          </div>
        </div>
      </section>

      {/* 6-Stage Pipeline Kanban Board */}
      <section id="opportunities" className="space-y-4">
        <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-stone-700" />
          <span>{t("Six-stage opportunity board (Opportunities Kanban)", "六階段商機看板 (Opportunities Kanban)")}</span>
        </h3>

        <div
          className="opportunity-board"
          role="region"
          aria-label={t("Six-stage opportunity board, horizontally scrollable", "六階段商機看板，可水平捲動")}
          tabIndex={0}
        >
          {data?.stages.map((stage: any, idx: number) => {
            const oppsInStage = data.opportunities.filter((o: any) => o.stageId === stage.id);
            const nextStage = data.stages[idx + 1];

            return (
              <div key={stage.id} className="opportunity-column">
                <div>
                  <div className="flex items-center justify-between pb-2 border-b border-stone-200 mb-3">
                    <span className="font-bold text-xs text-stone-900">{t(stage.name)}</span>
                    <span className="text-[10px] font-mono font-semibold bg-stone-200 text-stone-700 px-1.5 py-0.5 rounded">
                      {stage.probability}%
                    </span>
                  </div>

                  {/* Opportunities inside this stage */}
                  <div className="space-y-2.5">
                    {oppsInStage.length === 0 ? (
                      <div className="text-[11px] text-stone-400 text-center py-8">
                        {t("No opportunities", "目前無商機")}
                      </div>
                    ) : (
                      oppsInStage.map((opp: any) => (
                        <div
                          key={opp.id}
                          className="bg-white p-3 rounded-lg border border-stone-200 shadow-sm space-y-2 text-xs"
                        >
                          <div className="font-bold text-stone-900 leading-tight">{opp.name}</div>
                          <div className="text-[11px] text-stone-500">
                            {t("Value:", "金額:")} ${opp.amount?.toLocaleString()}
                          </div>
                          <div className="text-xs font-mono font-bold text-primary bg-purple-50 px-2 py-0.5 rounded border border-stone-200">
                            {t("Weighted:", "加權:")} ${opp.weightedAmount?.toLocaleString()}
                          </div>

                          {opp.status === "won" && (
                            <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">
                              {t("✓ Close won", "✓ 贏單結案")}
                            </span>
                          )}
                          {opp.status === "lost" && (
                            <span className="text-[10px] text-rose-700 font-bold bg-rose-50 px-1.5 py-0.5 rounded">
                              {t("✕ Close lost", "✕ 失單結案")}
                            </span>
                          )}

                          {nextStage && opp.status === "open" && (
                            <button
                              onClick={() => handleMoveStage(opp.id, nextStage.id, nextStage.isWon, nextStage.isLost)}
                              disabled={updatingStage}
                              className="w-full mt-1 py-1 rounded bg-stone-100 hover:bg-stone-200 text-stone-800 text-[10px] font-semibold flex items-center justify-center gap-1 transition"
                            >
                              <span>
                                {t("Advance to", "推進至")} {t(nextStage.name)}
                              </span>
                              <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {data && (
        <div id="crm-operations">
          <CrmOperations data={data} onRefresh={fetchData} onError={setError} onSuccess={setSuccess} />
        </div>
      )}

      {/* Bottom Grid: Leads Conversion & Tickets SLA */}
      <div id="leads" className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Leads Conversion */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            <span>{t("Convert a lead (Lead Conversion)", "潛客轉換作業 (Lead Conversion)")}</span>
          </h3>

          <div className="space-y-3 text-xs">
            {data?.leads.map((lead: any) => (
              <div
                key={lead.id}
                className="p-3 rounded-lg border border-stone-200 bg-stone-50/50 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="font-bold text-stone-900">
                    {lead.name} ({lead.company})
                  </div>
                  <div className="text-stone-500 font-mono text-[11px]">
                    {lead.email} | {lead.phone}
                  </div>
                </div>

                {lead.status === "converted" ? (
                  <span className="text-emerald-700 text-[11px] font-semibold bg-emerald-100 px-2 py-0.5 rounded">
                    {t("✓ Converted to account", "✓ 已轉為客戶帳戶")}
                  </span>
                ) : (
                  <button
                    onClick={() => handleConvertLead(lead.id)}
                    disabled={convertingLead === lead.id}
                    className="px-3 py-1.5 rounded-lg bg-primary hover:bg-[#0040b0] text-white font-medium text-xs transition"
                  >
                    {convertingLead === lead.id
                      ? t("Converting...", "轉換中…")
                      : t("Convert to opportunity", "轉換為商機")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Tickets SLA */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
            <LifeBuoy className="w-4 h-4 text-blue-600" />
            <span>{t("Support tickets and SLA", "客服工單與服務承諾 (SLA)")}</span>
          </h3>

          <div className="space-y-3 text-xs">
            {data?.tickets.map((tck: any) => (
              <div key={tck.id} className="p-3 rounded-lg border border-stone-200 bg-stone-50/50 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-stone-900">{tck.ticketNumber}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                    SLA {tck.slaHours} {t("hours (excluding weekends)", "小時 (跳過週末)")}
                  </span>
                </div>
                <div className="text-stone-700 font-medium">{tck.subject}</div>
                <div className="text-[11px] text-stone-500">
                  {t("Priority:", "優先級:")} {t(tck.priority)} | {t("Status:", "狀態:")} {t(tck.status)}
                  <p className={tck.isSlaBreached ? "text-red-700 font-semibold" : "text-stone-500"}>
                    {t("SLA Due:", "SLA 到期:")}{" "}
                    {tck.dueAt
                      ? new Date(tck.dueAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })
                      : t("No data", "無資料")}{" "}
                    {tck.isSlaBreached ? `(${t("overdue", "已逾時")})` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

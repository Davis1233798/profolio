"use client";
import { useState, FormEvent } from "react";
import { usePortfolioLocale } from "@/components/portfolio-experience";

const input = "w-full rounded-lg border border-stone-300 px-3 py-2 bg-white mt-1";
const button =
  "rounded-lg bg-purple-700 text-white px-4 py-2 disabled:opacity-40 hover:bg-purple-800 transition";
const panel = "rounded-xl border border-stone-200 bg-white p-5 space-y-4";

export default function CrmOperations({
  data,
  onRefresh,
  onError,
  onSuccess,
}: {
  data: any;
  onRefresh: () => void;
  onError: (v: string) => void;
  onSuccess: (v: string) => void;
}) {
  const { t } = usePortfolioLocale();
  const date = (v: string) =>
    new Date(v.includes("T") ? v : v.replace(" ", "T") + "Z").toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
    });

  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState({
    name: "",
    email: "",
    phone: "",
    title: "",
    accountId: "",
    marketingConsent: false,
  });
  const [ticket, setTicket] = useState({ subject: "", priority: "medium", slaHours: 24, customerId: "" });
  const [activity, setActivity] = useState({ subject: "", dueDate: "", activityType: "task" });
  const [quote, setQuote] = useState({ opportunityId: "", itemName: "", quantity: 1, unitPrice: 0 });

  async function action(body: Record<string, unknown>) {
    setBusy(true);
    onError("");
    onSuccess("");
    try {
      const r = await fetch("/api/crm/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j: any = await r.json();
      if (!j.success) throw new Error(j.error.message);
      onSuccess(t("Operation complete. Data saved.", "作業完成，資料已儲存。"));
      onRefresh();
      return true;
    } catch (e) {
      onError(e instanceof Error ? e.message : t("Operation failed", "操作失敗"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const submit = (fn: () => void) => (e: FormEvent) => {
    e.preventDefault();
    fn();
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6 text-sm">
      <section className={panel}>
        <h2 className="text-base font-bold">
          {t("Contacts and marketing consent", "聯絡人與行銷同意授權")}
        </h2>
        <form className="space-y-3" onSubmit={submit(() => void action({ action: "contact", ...contact }))}>
          <div className="grid sm:grid-cols-2 gap-3">
            <label>
              {t("Name", "姓名")}
              <input
                required
                maxLength={150}
                className={input}
                value={contact.name}
                onChange={e => setContact({ ...contact, name: e.target.value })}
              />
            </label>
            <label>
              {t("Email", "電子郵件")}
              <input
                type="email"
                required
                className={input}
                value={contact.email}
                onChange={e => setContact({ ...contact, email: e.target.value })}
              />
            </label>
            <label>
              {t("Phone", "電話")}
              <input
                className={input}
                value={contact.phone}
                onChange={e => setContact({ ...contact, phone: e.target.value })}
              />
            </label>
            <label>
              {t("Job title", "職稱")}
              <input
                className={input}
                value={contact.title}
                onChange={e => setContact({ ...contact, title: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            {t("Linked account", "關聯客戶帳戶")}
            <select
              className={input}
              value={contact.accountId}
              onChange={e => setContact({ ...contact, accountId: e.target.value })}
            >
              <option value="">{t("No linked account", "無關聯帳戶")}</option>
              {data.accounts.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex gap-2 items-center">
            <input
              type="checkbox"
              checked={contact.marketingConsent}
              onChange={e => setContact({ ...contact, marketingConsent: e.target.checked })}
            />
            {t(
              "Contact explicitly consents to marketing email",
              "聯絡人明確同意接收行銷電子郵件"
            )}
          </label>
          <button className={button} disabled={busy}>
            {t("Create contact", "建立聯絡人")}
          </button>
        </form>
        <div className="space-y-2 max-h-64 overflow-auto">
          {data.contacts.map((c: any) => {
            const allowed = data.consents?.some((s: any) => s.contactId === c.id && s.marketingEmailAllowed);
            return (
              <div key={c.id} className="border-t pt-3 flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-stone-500 break-all">{c.email}</p>
                  <p className="text-xs text-stone-500">
                    {allowed ? t("Marketing consent granted", "已授權行銷同意") : t("No marketing consent", "未授權行銷同意")}
                  </p>
                </div>
                {allowed && (
                  <button
                    className="text-red-700 underline"
                    disabled={busy}
                    onClick={() => void action({ action: "revokeConsent", contactId: c.id })}
                  >
                    {t("Withdraw consent", "撤銷行銷同意")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className={panel}>
        <h2 className="text-base font-bold">{t("Activities and tasks", "業務活動與跟進任務")}</h2>
        <form
          className="space-y-3"
          onSubmit={submit(() => {
            if (activity.dueDate)
              void action({
                action: "activity",
                ...activity,
                dueDate: new Date(activity.dueDate + "+08:00").toISOString(),
              });
          })}
        >
          <label className="block">
            {t("Activity subject", "活動主旨")}
            <input
              required
              maxLength={300}
              className={input}
              value={activity.subject}
              onChange={e => setActivity({ ...activity, subject: e.target.value })}
            />
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label>
              {t("Due time (Taipei)", "到期時間 (台北)")}
              <input
                type="datetime-local"
                required
                className={input}
                value={activity.dueDate}
                onChange={e => setActivity({ ...activity, dueDate: e.target.value })}
              />
            </label>
            <label>
              {t("Type", "活動類型")}
              <select
                className={input}
                value={activity.activityType}
                onChange={e => setActivity({ ...activity, activityType: e.target.value })}
              >
                {[
                  ["task", t("Task", "待辦任務")],
                  ["call", t("Phone", "電話拜訪")],
                  ["meeting", t("Meeting", "實體/線上會議")],
                  ["email", t("Email", "電子郵件")],
                ].map(([v, labelText]) => (
                  <option key={v} value={v}>
                    {labelText}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className={button} disabled={busy}>
            {t("Create activity", "建立跟進活動")}
          </button>
        </form>
        <div className="space-y-2 max-h-64 overflow-auto">
          {data.activities.map((a: any) => (
            <div key={a.id} className="border-t pt-3 flex flex-wrap justify-between gap-2">
              <div>
                <p>{a.subject}</p>
                <p
                  className={`text-xs ${
                    !a.completed && Date.parse(a.dueDate) < Date.now() ? "text-red-700 font-semibold" : "text-stone-500"
                  }`}
                >
                  {date(a.dueDate)} · {a.completed ? t("Completed", "已完成") : t("Task", "待辦")}
                </p>
              </div>
              {!a.completed && (
                <button
                  className="text-purple-700 underline"
                  disabled={busy}
                  onClick={() => void action({ action: "completeActivity", activityId: a.id })}
                >
                  {t("Mark complete", "標記為完成")}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className={panel}>
        <h2 className="text-base font-bold">
          {t("Quotes and approval snapshots", "報價單管理與核准快照")}
        </h2>
        <form className="space-y-3" onSubmit={submit(() => void action({ action: "quote", ...quote }))}>
          <label className="block">
            {t("Opportunity", "商機")}
            <select
              required
              className={input}
              value={quote.opportunityId}
              onChange={e => setQuote({ ...quote, opportunityId: e.target.value })}
            >
              <option value="">{t("Select opportunity", "請選擇商機")}</option>
              {data.opportunities.map((o: any) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {t("Quote item", "報價品項名稱")}
            <input
              required
              maxLength={200}
              className={input}
              value={quote.itemName}
              onChange={e => setQuote({ ...quote, itemName: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              {t("Quantity", "數量")}
              <input
                required
                type="number"
                min={1}
                step={1}
                className={input}
                value={quote.quantity}
                onChange={e => setQuote({ ...quote, quantity: Number(e.target.value) })}
              />
            </label>
            <label>
              {t("Unit price (TWD)", "單價 (新台幣 TWD)")}
              <input
                required
                type="number"
                min={0}
                step={1}
                className={input}
                value={quote.unitPrice}
                onChange={e => setQuote({ ...quote, unitPrice: Number(e.target.value) })}
              />
            </label>
          </div>
          <button className={button} disabled={busy}>
            {t("Create version and submit", "建立新版本並提交報價")}
          </button>
        </form>
        <div className="space-y-3 max-h-64 overflow-auto">
          {data.quotes?.map((q: any) => (
            <div key={q.id} className="border-t pt-3">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p>
                    {q.quoteNumber} · v{q.version}
                  </p>
                  <p className="text-xs text-stone-500">
                    NT${q.totalAmount.toLocaleString()} ·{" "}
                    {q.isLocked
                      ? t("Approved and locked", "已核准並鎖定")
                      : t("Awaiting approval", "待主管核准")}
                  </p>
                </div>
                {!q.isLocked && data.role === "admin" && (
                  <button
                    className="text-purple-700 underline"
                    disabled={busy}
                    onClick={() => void action({ action: "approveQuote", quoteId: q.id })}
                  >
                    {t("Approve and lock", "核准並鎖定報價")}
                  </button>
                )}
              </div>
              {data.quoteItems
                ?.filter((i: any) => i.quoteId === q.id)
                .map((i: any) => (
                  <p className="text-xs text-stone-500 mt-1" key={i.id}>
                    {i.itemName} × {i.quantity} @ NT${i.unitPrice}
                  </p>
                ))}
            </div>
          ))}
        </div>
      </section>

      <section className={panel}>
        <h2 className="text-base font-bold">{t("Create support ticket", "建立客服工單")}</h2>
        <p className="text-xs text-stone-500">
          {t(
            "SLA Counted Monday–Friday 09:00–18:00 Taipei time, excluding weekends. Public holidays are currently included.",
            "SLA 計算時間為台北時間週一至週五 09:00–18:00，週末不計入 SLA 時效。"
          )}
        </p>
        <form className="space-y-3" onSubmit={submit(() => void action({ action: "ticket", ...ticket }))}>
          <label className="block">
            {t("Ticket subject", "工單主旨")}
            <input
              required
              maxLength={300}
              className={input}
              value={ticket.subject}
              onChange={e => setTicket({ ...ticket, subject: e.target.value })}
            />
          </label>
          <label className="block">
            {t("Customer", "客戶")}
            <select
              className={input}
              value={ticket.customerId}
              onChange={e => setTicket({ ...ticket, customerId: e.target.value })}
            >
              <option value="">{t("No linked account", "無關聯客戶")}</option>
              {data.accounts.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              {t("Priority", "優先級")}
              <select
                className={input}
                value={ticket.priority}
                onChange={e => setTicket({ ...ticket, priority: e.target.value })}
              >
                {[
                  ["low", t("Low", "低")],
                  ["medium", t("Medium", "中")],
                  ["high", t("High", "高")],
                  ["urgent", t("Urgent", "緊急")],
                ].map(([v, labelText]) => (
                  <option key={v} value={v}>
                    {labelText}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("SLA Business hours", "SLA 服務時數 (營業時間)")}
              <input
                required
                type="number"
                min={1}
                max={720}
                className={input}
                value={ticket.slaHours}
                onChange={e => setTicket({ ...ticket, slaHours: Number(e.target.value) })}
              />
            </label>
          </div>
          <button className={button} disabled={busy}>
            {t("Create support ticket", "建立客服工單")}
          </button>
        </form>
      </section>
    </div>
  );
}

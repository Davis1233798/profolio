"use client";
import { useState } from "react";
import { usePortfolioLocale } from "@/components/portfolio-experience";
import registry from "@/infra/sites.json";
import { LockKeyhole, ShieldCheck, Terminal } from "lucide-react";
import s from "./platform-dashboard.module.css";

type Service = { service: string; state: string; health: string };
type Plan = { plan_id: string; site: string; service: string; action: string; steps: {service:string;action:string}[]; affected_sites: string[]; expires_at: number };
const actions: Record<string,string> = {start:"Start",stop:"Stop",restart:"Restart"};
const states: Record<string,string> = {running:"Running",exited:"Stopped",created:"Ready to start",restarting:"Restarting",missing:"Not deployed"};
const names = Object.fromEntries(registry.sites.map(site=>[site.id,site.name]));

export function PlatformControl() {
  const { t, locale } = usePortfolioLocale();
  const [token,setToken] = useState("");
  const [connected,setConnected] = useState(false);
  const [rows,setRows] = useState<Service[]>([]);
  const [site,setSite] = useState("mes");
  const [service,setService] = useState("collector");
  const [action,setAction] = useState("restart");
  const [plan,setPlan] = useState<Plan|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("Connect with a separate operations credential. Demo roles cannot control hosts.");
  const [error,setError] = useState(false);
  const declared = registry.sites.find(item=>item.id===site)!;
  const services = [...new Set([...declared.services,"web"])];

  async function request<T>(operation: string, body?: object): Promise<T> {
    const response = await fetch(`/api/platform/control/${operation}`, {method:body ? "POST" : "GET",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:body ? JSON.stringify(body) : undefined});
    const value = await response.json() as {error?:string} & T;
    if (!response.ok) {
      if (response.status===401) setConnected(false);
      throw new Error(response.status===401 ? "Invalid operations credential. Please reconnect." : response.status===410 ? "This plan expired or was executed. Create a new plan." : response.status===409 ? "Service state changed. Refresh and create a new plan." : "Control service temporarily unavailable. Refresh status and inspect the result.");
    }
    return value;
  }
  async function perform(task:()=>Promise<void>) {
    setBusy(true); setError(false);
    try { await task(); } catch (e) {setError(true);setMessage(e instanceof Error ? e.message : "Connection interrupted. Refresh service status.");}
    finally {setBusy(false);}
  }
  function refresh() {return perform(async()=>{const value=await request<{services:Service[]}>("status");setRows(value.services);setConnected(true);setPlan(null);setMessage(t(`Updated ${value.services.length} managed services.`, `已更新 ${value.services.length} 項受管服務。`));});}
  function createPlan() {return perform(async()=>{const value=await request<Plan>("plan",{site,service,action});setPlan(value);setMessage("Plan created. Review the action and affected workspaces. Service state has not changed.");});}
  function apply() {
    if (!plan) return;
    const current=plan; setPlan(null);
    return perform(async()=>{const value=await request<{services:Service[]}>("apply",{plan_id:current.plan_id});setRows(value.services);setMessage(t(`${actions[current.action]} operation complete. Service status refreshed.`, `${t(actions[current.action])}操作完成，已重新整理服務狀態。`));});
  }
  return <section className={s.control} aria-labelledby="platform-control-heading" aria-busy={busy}>
    <div className={s.controlBar}><Terminal size={15}/><h3 id="platform-control-heading">{t("Service control center")}</h3><span className={`${s.connection} ${connected?s.connected:""}`}>{t(connected?"Credential verified":"Disconnected")}</span></div>
    <div className={s.connectGrid}>
      <aside className={s.accessPanel}><p className={s.accessCaption}>{t("PLAN BEFORE YOU APPLY.")}</p><h4>{t("Review the impact,")}<br/>{t("then apply the change.")}</h4><ol className={s.accessSteps}><li><span>01</span>{t("Read service status")}</li><li><span>02</span>{t("Review affected workspaces")}</li><li><span>03</span>{t("Execute one-time plan")}</li></ol></aside>
      <div className={s.authPanel}>
        {!connected&&<><span className={s.lockIcon}><LockKeyhole size={18} strokeWidth={1.5}/></span><h4>{t("Connect to infrastructure.")}</h4><p>{t("Use the operations credential provided by your administrator to query live status and control services.")}</p></>}
        {connected&&<><h4>{t("Operations connection established.")}</h4><p>{t("Refresh status, then choose a workspace, service and action to create a plan.")}</p></>}
        <form onSubmit={event=>{event.preventDefault();void refresh();}} className={s.authForm}>
          <label className={`${s.field} ${s.tokenField}`}><span>{t("Operations credential")}</span><input type="password" autoComplete="off" value={token} onChange={event=>{setToken(event.target.value);setConnected(false);setRows([]);setPlan(null);setError(false);setMessage("Connect with a separate operations credential. Demo roles cannot control hosts.");}} className={s.input} placeholder={t("Enter platform operations credential")} required disabled={busy}/></label>
          <button disabled={busy||!token} className={s.primary}>{t(busy?"Processing…":connected?"Refresh status":"Connect")}</button>
          {connected&&<button type="button" disabled={busy} onClick={()=>{setToken("");setConnected(false);setRows([]);setPlan(null);setMessage("Operations connection closed.");}} className={s.secondary}>{t("Disconnect")}</button>}
        </form>
        <div className={s.authNote}><ShieldCheck size={12}/>{t("The credential is used only for this connection and is not persisted in the browser.")}</div>
        <p className={`${s.message} ${error?s.error:""}`} role={error?"alert":"status"}>{t(message)}</p>
      </div>
    </div>
    {connected&&<div className={s.operationBody}>
      <div className={s.tableWrap}><table className={s.table}><thead><tr><th scope="col">{t("SERVICE")}</th><th scope="col">{t("Current status")}</th><th scope="col">{t("Health check")}</th></tr></thead><tbody>{rows.map(row=><tr key={row.service}><td>{row.service}</td><td>{t(states[row.state]??row.state)}</td><td>{t(row.health==="healthy"?"Healthy":row.health==="unhealthy"?"Unhealthy":row.health==="starting"?"Checking":"Not configured")}</td></tr>)}</tbody></table>{!rows.length&&<p className={s.message}>{t("No managed services.")}</p>}</div>
      <form onSubmit={event=>{event.preventDefault();void createPlan();}} className={s.operationForm}>
        <label className={s.field}><span>{t("Workspace")}</span><select className={s.input} disabled={busy} value={site} onChange={event=>{const next=registry.sites.find(item=>item.id===event.target.value)!;setSite(next.id);setService(next.services[0]??"web");setPlan(null);}}>{registry.sites.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className={s.field}><span>{t("Service")}</span><select className={s.input} disabled={busy} value={service} onChange={event=>{setService(event.target.value);setPlan(null);}}>{services.map(name=><option key={name} value={name}>{name}{t(name==="web"?"(shared by all six workspaces)":"")}</option>)}</select></label>
        <label className={s.field}><span>{t("Action")}</span><select className={s.input} disabled={busy} value={action} onChange={event=>{setAction(event.target.value);setPlan(null);}}>{Object.entries(actions).map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>
        <button disabled={busy} className={s.secondary}>{t("Create operation plan")}</button>
      </form>
      {plan&&<div className={s.plan}><h3>{t("Pending plan:")} {t(actions[plan.action])} {plan.service}</h3><p>{t("Affected workspaces:")} {plan.affected_sites.map(id=>names[id]??id).join(", ")||t("No state change")}. {t("Valid until")} {new Date(plan.expires_at*1000).toLocaleTimeString(locale === "zh-TW" ? "zh-TW" : "en-US",{timeZone:"Asia/Taipei"})}(Taipei).</p>{plan.service==="web"&&plan.action==="stop"&&<p className={s.warning}>{t("Stopping the main gateway takes all website entry points offline. Restart it through SSH and the CLI.")}</p>}<ul>{plan.steps.map(step=><li key={step.service}>{t(actions[step.action])} {step.service}</li>)}</ul>{!plan.steps.length&&<p>{t("Service already matches the target state. No change required.")}</p>}<button type="button" disabled={busy} onClick={()=>void apply()} className={s.primary}>{t("Execute plan")}</button></div>}
    </div>}
  </section>;
}

import React from 'react';
import {tr} from './locale';

type Row = Record<string, any>;
export function CrmBoard({data}:{data:Record<string,Row[]>}) {
 const stages=(data.stages||[]).slice().sort((a,b)=>a.position-b.position);
 const opportunities=data.opportunities||[];
 const money=(value:number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:'TWD',maximumFractionDigits:0}).format(value);
 return <section className="crm-board panel" aria-labelledby="crm-board-title">
  <div className="crm-board-header"><div><p className="eyebrow">{tr('SALES PIPELINE')}</p><h2 id="crm-board-title">{tr('Opportunities by stage')}</h2><p>{tr('Showing up to 500 opportunities available to your role. Use Activities and opportunities to update a stage.')}</p></div></div>
  {stages.length===0?<p className="empty">{tr('No sales stages available')}</p>:<div className="crm-board-scroll"><div className="crm-board-columns">{stages.map(stage=>{const items=opportunities.filter(o=>o.stageId===stage.id);return <section key={stage.id} className="crm-board-column" aria-label={stage.name}><header><div><strong>{stage.name}</strong><span>{items.length}</span></div><small>{stage.probability}% · {money(items.reduce((total,o)=>total+(Number(o.amount)||0),0))}</small></header><div className="crm-board-cards">{items.length===0?<p className="crm-board-empty">{tr('No opportunities')}</p>:items.map(o=><article key={o.id}><h3>{o.name}</h3><strong>{money(Number(o.amount)||0)}</strong><small>{tr('Weighted value')}: {money(Number(o.weightedAmount)||0)}</small><small>{tr('Status')}: {tr(String(o.status||''))}</small></article>)}</div></section>})}</div></div>}
 </section>
}

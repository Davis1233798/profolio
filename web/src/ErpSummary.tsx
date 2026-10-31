import React from 'react';
import {tr} from './locale';

type Row = Record<string, any>;
export function ErpSummary({data}:{data:Record<string,Row[]>}) {
 const summary=data.erpSummary?.[0];
 const money=(value:number)=>new Intl.NumberFormat(undefined,{style:'currency',currency:'TWD',maximumFractionDigits:0}).format(value);
 return <section className="panel mes-actions"><p className="eyebrow">{tr('OPERATIONS OVERVIEW')}</p><h2>{tr('Purchasing, sales and outstanding balances')}</h2><p>{tr('Organization-wide totals from current records; invoice amounts are internal demo balances.')}</p><div className="load-metrics">{[[tr('Open purchase orders'),summary?.openPurchases],[tr('Open sales orders'),summary?.openSales],[tr('Receivable balance'),summary?money(summary.receivable):'—'],[tr('Payable balance'),summary?money(summary.payable):'—']].map(([label,value])=><div key={label}><small>{label}</small><strong>{value??'—'}</strong></div>)}</div></section>
}

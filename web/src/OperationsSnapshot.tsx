import React, {useEffect, useState} from 'react';
import {tr} from './locale';
import {startSnapshotPolling} from './snapshot-polling';

export function OperationsSnapshot({site}:{site:string}) {
 const [data,setData]=useState<Record<string,number>|null>(null),[error,setError]=useState(''),[updated,setUpdated]=useState('');
 useEffect(()=>startSnapshotPolling(site,data=>{setData(data);setUpdated(new Date().toLocaleTimeString());setError('')},setError),[site]);
 const entries=site==='shop'?[['pendingPayment','Pending payment'],['paidUnfulfilled','Paid, awaiting shipment'],['pendingOutbox','Pending dispatch events'],['retryingOutbox','Dispatch events retrying'],['paidRevenue','Paid demo revenue'],['refundedAmount','Demo refunds'],['netRevenue','Net demo revenue']]:[['runningOrders','Running work orders'],['waitingOrders','Waiting work orders'],['productionReports','Production reports'],['openDowntime','Open downtime events']];
 return <section className="panel mes-actions" aria-live="polite"><p className="eyebrow">{tr('LIVE OPERATIONS')}</p><h2>{tr('Current workspace activity')}</h2><p>{tr('Counts come from this workspace’s business records and refresh every 10 seconds. They are separate from the isolated load test.')}</p>{error&&<p role="alert" className="error">{error}</p>}<div className="load-metrics">{entries.map(([key,label])=><div key={key}><small>{tr(label)}</small><strong>{data?(key.endsWith('Revenue')||key==='refundedAmount'?new Intl.NumberFormat(undefined,{style:'currency',currency:'TWD',maximumFractionDigits:0}).format(data[key]):data[key]):'—'}</strong></div>)}</div>{site==='shop'&&<p>{tr('Demo revenue includes shipping and subtracts recorded demo refunds; no external payment is charged.')}</p>}{updated&&<small>{tr('Updated')} {updated}</small>}</section>
}

import React, {useMemo,useRef,useState} from 'react';
import {tr} from './locale';

type Row=Record<string,any>;
type Props={data:Record<string,Row[]>;scope:string;onSaved:()=>Promise<void>};
export function MesBusiness({data,scope,onSaved}:Props){
 const orders=data.workOrders||[],operations=data.operations||[];
 const [orderId,setOrderId]=useState(''),[operationId,setOperationId]=useState(''),[good,setGood]=useState(1),[scrap,setScrap]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const attempt=useRef({signature:'',key:''});
 const order=orders.find(o=>o.id===orderId);
 const remaining=order?Math.max(0,Number(order.targetQuantity)-Number(order.completedQuantity)-Number(order.scrappedQuantity)):0;
 const available=useMemo(()=>operations.filter(o=>o.workOrderId===orderId).sort((a,b)=>Number(a.sequence)-Number(b.sequence)),[operations,orderId]);
 async function send(action:'start'|'report'){
  setBusy(true);setError('');setMessage('');
  try{
   const selected=operationId||available[0]?.id||'';
   const signature=JSON.stringify([orderId,selected,good,scrap]);
   if(action==='report'&&attempt.current.signature!==signature)attempt.current={signature,key:crypto.randomUUID()};
   const value=action==='start'?{action,workOrderId:orderId}:{action,workOrderId:orderId,operationId:selected,goodQuantity:good,scrapQuantity:scrap,idempotencyKey:attempt.current.key};
   const response=await fetch('/api/stations/mes/business',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
   const result=await response.json() as {success:boolean;data?:{status:string;reportId?:string};error?:{message:string}};
   if(!response.ok||!result.success)throw new Error(result.error?.message||`HTTP ${response.status}`);
   if(action==='report')attempt.current={signature:'',key:''};
   setMessage(action==='start'?tr('Work order started.'):tr('Production report saved.'));await onSaved();
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <section className="panel mes-actions"><div><p className="eyebrow">{tr('LIVE PRODUCTION OPERATIONS')}</p><h2>{tr('Start work and report output')}</h2><p>{tr('These actions update this station’s production records. Reports use retry keys and cannot exceed the work order target.')}</p></div><div className="mes-action-fields"><label>{tr('Work order')}<select value={orderId} onChange={e=>{setOrderId(e.target.value);setOperationId('');setError('');setMessage('')}}><option value="">{tr('Select an item')}</option>{orders.map(o=><option key={o.id} value={o.id}>{o.orderNo} · {o.status} · {o.completedQuantity}/{o.targetQuantity}</option>)}</select></label><label>{tr('Operation')}<select value={operationId||available[0]?.id||''} onChange={e=>setOperationId(e.target.value)} disabled={!orderId}>{available.length===0&&<option value="">{tr('No operations')}</option>}{available.map(o=><option key={o.id} value={o.id}>{o.name} · {o.sequence}</option>)}</select></label><label>{tr('Good quantity')}<input type="number" min="0" max="1000000" value={good} onChange={e=>setGood(Number(e.target.value))}/></label><label>{tr('Scrap quantity')}<input type="number" min="0" max="1000000" value={scrap} onChange={e=>setScrap(Number(e.target.value))}/></label></div>{order&&<p>{tr('Remaining target')}: <strong>{remaining}</strong> · {tr('Includes good and scrap quantities; the server checks current totals again.')}</p>}{order&&good+scrap>remaining&&<p role="alert" className="error">{tr('Report quantity exceeds the displayed remaining target.')}</p>}<div className="mes-action-buttons">{scope==='back'&&<button type="button" disabled={busy||!order||order.status!=='released'||!order.materialsStaged} onClick={()=>void send('start')}>{tr('Start work order')}</button>}<button type="button" disabled={busy||!order||order.status!=='in_progress'||!available.length||!Number.isSafeInteger(good)||!Number.isSafeInteger(scrap)||good<0||scrap<0||good+scrap===0||good+scrap>remaining} onClick={()=>void send('report')}>{tr('Submit production report')}</button></div>{message&&<p role="status">{message}</p>}{error&&<p role="alert" className="error">{error}</p>}</section>;
}

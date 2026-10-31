import React,{useState} from 'react';
import {tr} from './locale';
type Row=Record<string,any>;
export function DiningKitchen({data,onSaved}:{data:Record<string,Row[]>;onSaved:()=>Promise<void>}) {
 const [busy,setBusy]=useState(''),[error,setError]=useState('');
 const next:Record<string,string>={received:'cooking',cooking:'done',done:'served'};
 async function advance(t:Row){setBusy(t.id);setError('');try{const response=await fetch('/api/stations/dining/business',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticketId:t.id,expected:t.status,next:next[t.status]})});const value=await response.json() as {success:boolean;error?:{message:string}};if(!response.ok||!value.success)throw new Error(value.error?.message||`HTTP ${response.status}`);await onSaved()}catch(e){setError((e as Error).message)}finally{setBusy('')}}
 return <section className="panel mes-actions"><p className="eyebrow">{tr('KITCHEN WORKSPACE')}</p><h2>{tr('Kitchen tickets')}</h2><p>{tr('Tickets move from received to cooking, ready and served. Refresh if another cook has updated a ticket.')}</p><div className="dataset-grid">{(data.kitchenTickets||[]).filter(t=>t.status!=='served').map(t=><article className="panel" key={t.id}><h3>{t.itemName} × {t.quantity}</h3><p>{tr('Station')}: {t.station} · {tr('Status')}: {tr(t.status)}</p>{t.modifiersText&&t.modifiersText!=='[]'&&<p>{t.modifiersText}</p>}<button disabled={!!busy||!next[t.status]} onClick={()=>void advance(t)}>{tr('Mark')} {tr(next[t.status]||'')}</button></article>)}</div>{!(data.kitchenTickets||[]).some(t=>t.status!=='served')&&<p>{tr('No active kitchen tickets')}</p>}{error&&<p className="error" role="alert">{error}</p>}</section>;
}

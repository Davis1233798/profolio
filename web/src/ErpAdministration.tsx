import React, {useRef, useState} from 'react';
import {tr} from './locale';

type Row = Record<string, any>;
export function ErpAdministration({data, role, onSaved}: {data: Record<string, Row[]>; role: string; onSaved: () => Promise<void>}) {
 const [kind, setKind] = useState('supplier'), [code, setCode] = useState(''), [name, setName] = useState(''), [email, setEmail] = useState(''), [periodId, setPeriod] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
 const attempt = useRef({signature: '', key: ''});
 async function send(payload: Record<string, unknown>) {
  setBusy(true); setMessage(''); setError('');
  try {
   const signature = JSON.stringify(payload);
   if (attempt.current.signature !== signature) attempt.current = {signature, key: crypto.randomUUID()};
   const response = await fetch('/api/stations/erp/administration', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...payload, idempotencyKey: attempt.current.key})});
   const value = await response.json() as {success: boolean; error?: {message: string}};
   if (!response.ok || !value.success) throw new Error(value.error?.message || `HTTP ${response.status}`);
   attempt.current = {signature: '', key: ''}; setMessage(tr(payload.action === 'partner' ? 'Partner created' : 'Fiscal period closed'));
   if (payload.action === 'partner') {setCode(''); setName(''); setEmail('')} else setPeriod('');
   await onSaved();
  } catch (e) {setError((e as Error).message)} finally {setBusy(false)}
 }
 return <section className="panel mes-actions"><p className="eyebrow">{tr('ERP ADMINISTRATION')}</p><h2>{tr('Partners and fiscal periods')}</h2>
  <form onSubmit={e => {e.preventDefault(); void send({action: 'partner', kind, code, name, email})}}><div className="mes-action-fields">
   <label>{tr('Partner type')}<select value={kind} onChange={e => setKind(e.target.value)}><option value="supplier">{tr('Supplier')}</option><option value="customer">{tr('Customer')}</option></select></label>
   <label>{tr('Code')}<input required maxLength={100} value={code} onChange={e => setCode(e.target.value)}/></label>
   <label>{tr('Name')}<input required maxLength={200} value={name} onChange={e => setName(e.target.value)}/></label>
   <label>{tr('Email')}<input type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/></label>
  </div><button disabled={busy || !code.trim() || !name.trim()}>{tr('Create partner')}</button></form>
  {role === 'admin' && <form onSubmit={e => {e.preventDefault(); void send({action: 'closePeriod', periodId})}}><div className="mes-action-fields"><label>{tr('Fiscal period')}<select required value={periodId} onChange={e => setPeriod(e.target.value)}><option value="">{tr('Select a fiscal period')}</option>{(data.fiscalPeriods || []).filter(p => !p.isClosed).map(p => <option key={p.id} value={p.id}>{p.periodCode} · {p.startDate} – {p.endDate}</option>)}</select></label></div><p>{tr('Closing prevents posting into the period and cannot be undone here.')}</p><button disabled={busy || !periodId}>{tr('Close fiscal period')}</button></form>}
  {message && <p role="status">{message}</p>}{error && <p role="alert" className="error">{error}</p>}
 </section>;
}

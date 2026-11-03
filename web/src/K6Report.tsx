import React, {useState} from 'react';
import {tr} from './locale';

type Metric = {count?:number; rate?:number; fails?:number; 'p(95)'?:number; thresholds?:Record<string,boolean>};
type Report = {suite_scenario?:{site?:string;kind?:string;scope?:string;k6_version?:string};metrics?:Record<string,Metric>};
export function K6Report({site}:{site:string}) {
  const [report,setReport]=useState<Report|null>(null),[error,setError]=useState('');
  async function load(file?:File) {
    setReport(null);setError('');if(!file)return;
    if(file.size>1_000_000){setError('Report must be smaller than 1 MB.');return}
    try {
      const data=JSON.parse(await file.text()) as Report;
      if(data.suite_scenario?.site!==site||!['business-race','station-business-race'].includes(data.suite_scenario.kind||'')||data.suite_scenario.scope!=='isolated-loopback'||!(data.metrics?.business_committed||data.metrics?.station_business_committed)||!(data.metrics?.business_rejected||data.metrics?.station_business_rejected)||!data.metrics?.checks) throw new Error('Choose the matching business-race or station-business-race summary produced by the isolated k6 runner.');
      setReport(data);
    } catch(e){setError((e as Error).message||'Invalid report')}
  }
  const m=report?.metrics;
  const commits=m?.business_committed||m?.station_business_committed;
  const conflicts=m?.business_rejected||m?.station_business_rejected;
  const failed=!!m && (Object.values(m).some(v=>Object.values(v.thresholds||{}).some(Boolean)) || (m.checks?.fails||0)>0);
  return <section className="k6-report" aria-label="Imported k6 business test report"><div><p className="eyebrow">{tr('K6 / REAL BUSINESS TRANSACTION TEST')}</p><h3>{tr('Inspect a test report')}</h3><p>{tr('Import the matching business-race or station-business-race JSON summary from CI or a local isolated run. The file stays in your browser; the imported report is not independently verified.')}</p><label>{tr('Choose k6 summary')}<input type="file" accept=".json,application/json" onChange={e=>void load(e.target.files?.[0])}/></label><p><a href="https://github.com/Davis1233798/profolio/actions" target="_blank" rel="noreferrer">{tr('Open GitHub Actions artifacts')} ↗</a></p></div>{error&&<p role="alert" className="error">{error}</p>}{m&&<div className="load-metrics" aria-live="polite"><div><small>{tr('Report status')}</small><strong>{failed?tr('Failed'):tr('Passed')}</strong></div><div><small>{tr('Requests')}</small><strong>{m.iterations?.count??'—'}</strong></div><div><small>{tr('Business commits')}</small><strong>{commits?.count??'—'}</strong></div><div><small>{tr('Expected conflicts')}</small><strong>{conflicts?.count??'—'}</strong></div><div><small>{tr('HTTP p95')}</small><strong>{m.http_req_duration?.['p(95)']?.toFixed(1)??'—'} ms</strong></div><div><small>{tr('Check failures')}</small><strong>{m.checks?.fails??'—'}</strong></div></div>}</section>;
}

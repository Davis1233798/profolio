import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
const base=__ENV.BASE_URL||'http://127.0.0.1:8097',site=__ENV.SITE||'shop';
const vus=Number(__ENV.VUS||16),iterations=Number(__ENV.ITERATIONS||64);
if(!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base))throw new Error('Use an isolated loopback service only');
if(!['shop','mes'].includes(site)||!Number.isInteger(vus)||vus<1||vus>64||!Number.isInteger(iterations)||iterations<2||iterations>1000)throw new Error('Invalid test parameters');
const committed=new Counter('station_business_committed'),rejected=new Counter('station_business_rejected');
export const options={scenarios:{race:{executor:'shared-iterations',vus,iterations,maxDuration:'2m'}},thresholds:{checks:['rate==1'],iterations:[`count==${iterations}`],station_business_committed:['count==1'],station_business_rejected:[`count==${iterations-1}`]}};
function json(response){try{return response.json()}catch{return null}}
function get(path,cookie){return http.get(base+path,{headers:cookie?{Cookie:cookie}:{},timeout:'20s'})}
function post(path,body,cookie,conflict=false){return http.post(base+path,JSON.stringify(body),{headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},timeout:'20s',...(conflict?{responseCallback:http.expectedStatuses(200,409)}:{})})}
function data(response,label){const value=json(response);if(response.status!==200||!value||!value.success)fail(`${label}: ${response.status} ${response.body}`);return value.data}
export function setup(){
 const login=post('/api/auth/login',{email:'admin@suite.test',password:'SuiteDemo!2026',site});data(login,'login');const key=`suite_session_${site}`;
 if(!login.cookies[key]?.[0])fail('Missing station session');const cookie=`${key}=${login.cookies[key][0].value}`;
 const current=data(get(`/api/stations/${site}/data?view=back`,cookie),'load station data');
 if(site==='shop'){const variant=current.variants.find(v=>v.stockQuantity===1&&v.reservedQuantity===0);if(!variant)fail('Missing single-stock variant');return{cookie,variantId:variant.id,baseline:current.orders.length}}
 const order=current.workOrders.find(w=>w.status==='released'&&w.materialsStaged&&w.completedQuantity===0&&w.scrappedQuantity===0);if(!order)fail('Missing staged work order');
 const op=current.operations.find(o=>o.workOrderId===order.id);if(!op)fail('Missing operation');
 data(post('/api/stations/mes/business',{action:'start',workOrderId:order.id},cookie),'start');return{cookie,workOrderId:order.id,operationId:op.id,target:order.targetQuantity,baseline:current.reports.length};
}
export default function(state){
 const i=exec.scenario.iterationInTest;const body=site==='shop'?{action:'checkout',variantId:state.variantId,quantity:1,idempotencyKey:`k6-checkout-${i}`}:{action:'report',workOrderId:state.workOrderId,operationId:state.operationId,goodQuantity:state.target,scrapQuantity:0,idempotencyKey:`k6-report-${i}`};
 const response=post(`/api/stations/${site}/business`,body,state.cookie,true),value=json(response);
 const expected=value&&((response.status===200&&value.success)||(response.status===409&&!value.success&&/stock|target|progress|changed/i.test(value.error?.message||'')));
 if(!expected)console.error(`Unexpected response: ${response.status} ${response.body}`);
 check(response,{'valid commit or capacity conflict':()=>!!expected});if(response.status===200&&value?.success)committed.add(1);else if(response.status===409&&expected)rejected.add(1);
}
export function teardown(state){
 if(!state)return;const final=data(get(`/api/stations/${site}/data?view=back`,state.cookie),'final state');
 if(site==='shop'){const variant=final.variants.find(v=>v.id===state.variantId);if(!variant||variant.stockQuantity!==0||final.orders.length!==state.baseline+1)fail('Station checkout invariant failed');console.log('station shop: one order, no oversell');}
 else{const order=final.workOrders.find(w=>w.id===state.workOrderId);if(!order||order.completedQuantity!==state.target||final.reports.length!==state.baseline+1)fail('Station production invariant failed');console.log('station mes: one report, no over-report');}
}

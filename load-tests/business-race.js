import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
const base=__ENV.BASE_URL||'http://127.0.0.1:8098';
const site=__ENV.SITE||'shop';
const vus=Number(__ENV.VUS||16), iterations=Number(__ENV.ITERATIONS||64);
if(!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('Business write tests require an isolated loopback service');
if(!['shop','mes'].includes(site)||!Number.isInteger(vus)||vus<1||vus>64||!Number.isInteger(iterations)||iterations<2||iterations>1000) throw new Error('Invalid test parameters');
const committed=new Counter('business_committed'),conflict=new Counter('business_rejected');
export const options={scenarios:{race:{executor:'shared-iterations',vus,iterations,maxDuration:'2m'}},thresholds:{checks:['rate==1'],iterations:[`count==${iterations}`],business_committed:['count==1'],business_rejected:[`count==${iterations-1}`]}};
const payload=(response)=>{try{return response.json()}catch{return null}};
const headers=(cookie)=>({'Content-Type':'application/json',Cookie:cookie});
function get(path,cookie){return http.get(base+path,{headers:cookie?{Cookie:cookie}:{},timeout:'20s'})}
function post(path,value,cookie,acceptConflict=false){return http.post(base+path,JSON.stringify(value),{headers:headers(cookie),timeout:'20s',...(acceptConflict?{responseCallback:http.expectedStatuses(200,400)}:{})})}
function requireData(response,label){const json=payload(response);if(response.status!==200||!json||!json.success)fail(`${label}: ${response.status} ${response.body}`);return json.data}
export function setup(){
 const first=get(`/api/${site}/data${site==='shop'?'?management=1':''}`);
 const data=requireData(first,'read isolated tenant');
 const session=first.cookies.demo_session_id;
 if(!session||!session[0])fail('Missing demo session');
 const cookie=`demo_session_id=${session[0].value}`;
 if(site==='shop'){
  const variant=data.products.flatMap(p=>p.variants).find(v=>v.stockQuantity===1&&v.reservedQuantity===0);
  if(!variant)fail('Expected seeded single remaining unit');
  return {cookie,variantId:variant.id,baseline:data.orders.length};
 }
 const wo=data.workOrders.find(w=>w.status==='released'&&w.materialsStaged&&w.completedQuantity===0&&w.scrappedQuantity===0);
 if(!wo)fail('Expected staged released work order');
 const operation=data.operations.find(o=>o.workOrderId===wo.id);
 if(!operation)fail('Missing operation');
 requireData(post('/api/operations/mes',{action:'status',workOrderId:wo.id,status:'in_progress'},cookie),'start work order');
 return {cookie,workOrderId:wo.id,operationId:operation.id,target:wo.targetQuantity,baseline:data.reports.length};
}
export default function(data){
 const i=exec.scenario.iterationInTest;
 const path=site==='shop'?'/api/shop/checkout':'/api/mes/report';
 const body=site==='shop'?{items:[{variantId:data.variantId,quantity:1}],idempotencyKey:`k6-shop-${i}`}:{workOrderId:data.workOrderId,operationId:data.operationId,goodQuantity:data.target,scrapQuantity:0,idempotencyKey:`k6-mes-${i}`};
 const response=post(path,body,data.cookie,true),value=payload(response);
 const msg=value?.error?.message || '';
 const expectedConflict = site==='shop' ? /庫存|S03|stock|inventory/i.test(msg) : /超量|M03|M04|work order|capacity/i.test(msg);
 const valid=value&&((response.status===200&&value.success===true)||(response.status===400&&value.success===false&&expectedConflict));
 if(!valid) console.error(`Unexpected response: ${response.status} ${response.body}`);
 check(response,{'expected commit or contention rejection':()=>!!valid});
 if(response.status===200&&value&&value.success)committed.add(1);
 else if(response.status===400&&value&&!value.success&&expectedConflict)conflict.add(1);
}
export function teardown(data){
 if(!data)return;
 const state=requireData(get(`/api/${site}/data${site==='shop'?'?management=1':''}`,data.cookie),'read final state');
 if(site==='shop'){
  const variant=state.products.flatMap(p=>p.variants).find(v=>v.id===data.variantId);
  if(!variant||variant.stockQuantity!==0||state.orders.length!==data.baseline+1)fail('Oversell/order invariant failed');
  console.log('commerce: one checkout committed, final stock 0, one new order');
 }else{
  const order=state.workOrders.find(w=>w.id===data.workOrderId);
  if(!order||order.completedQuantity!==data.target||order.scrappedQuantity!==0||state.reports.length!==data.baseline+1)fail('Production report invariant failed');
  console.log(`mes: one production report committed, ${order.completedQuantity}/${data.target} completed`);
 }
}

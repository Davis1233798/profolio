import assert from 'node:assert/strict';
const base=process.argv[2]??'http://127.0.0.1:8090';
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)) throw new Error('Use a local preview or SSH tunnel for isolated demo mutations');
function client() {
  let cookie='';
  return async(path,body)=>{
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    const session=response.headers.getSetCookie().find(s=>s.startsWith('demo_session_id='));if(session)cookie=session.split(';')[0];
    const result=await response.json();assert.equal(response.ok,true,JSON.stringify(result));return result.data??result;
  };
}
const request=client(), other=client();
const data=await request('/api/mes/data');
const order=data.workOrders.find(o=>o.status==='released'&&o.materialsStaged);
assert.ok(order);
await request('/api/operations/mes',{action:'status',workOrderId:order.id,status:'in_progress'});
const operation=data.operations.find(o=>o.workOrderId===order.id);
await request('/api/mes/report',{workOrderId:order.id,operationId:operation.id,goodQuantity:1,scrapQuantity:0,idempotencyKey:crypto.randomUUID()});
async function eventually(check) {
  for(let i=0;i<50;i++) {
    const value=await request('/api/mes/industrial');
    const found=check(value);if(found)return found;
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error('Timed out waiting for automatic MES projection');
}
const projected=await eventually(value=>value.workOrders.find(row=>row.order.id===order.id&&row.order.completedQuantity===order.completedQuantity+1));
assert.equal(projected.order.organizationId,order.organizationId);
const isolated=await other('/api/mes/industrial');assert.ok(!isolated.workOrders.some(row=>row.order.id===order.id));
await request('/api/seed/reset',{});
const reset=await eventually(value=>value.workOrders.find(row=>row.order.id===order.id&&row.order.completedQuantity===order.completedQuantity&&row.revision>projected.revision));
assert.ok(reset.revision>projected.revision);
console.log('PASS: MES start/report -> atomic Outbox -> automatic PostgreSQL projection, tenant isolation and reset revision fencing');

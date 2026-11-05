import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startSnapshotPolling, type SnapshotPollingRuntime} from '../../web/src/snapshot-polling';

test('snapshot polling aborts on hide, resumes once, and clears its timer on teardown', async () => {
  let hidden=false, calls=0, firstSignal:AbortSignal|undefined;
  const visibility:{listener:(()=>void)|null}={listener:null};
  let nextTimer=0;
  const timers=new Map<number,{callback:()=>void;delay:number}>();
  const values:Record<string,number>[]=[];
  const errors:string[]=[];
  const runtime:SnapshotPollingRuntime={
    fetch:((_input,init)=>{
      calls++;
      const signal=init?.signal as AbortSignal;
      if(calls===1){firstSignal=signal;return new Promise<Response>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))}
      return Promise.resolve({ok:true,status:200,json:async()=>({success:true,data:{runningOrders:3}})} as Response);
    }) as typeof fetch,
    isHidden:()=>hidden,
    onVisibilityChange:listener=>{visibility.listener=listener;return()=>{visibility.listener=null}},
    schedule:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id},
    cancel:timer=>{timers.delete(timer as unknown as number)},
  };

  const stop=startSnapshotPolling('mes',value=>values.push(value),message=>errors.push(message),runtime);
  assert.equal(calls,1);
  hidden=true;visibility.listener?.();
  assert.equal(firstSignal?.aborted,true);
  hidden=false;visibility.listener?.();
  for(let i=0;i<5;i++)await Promise.resolve();
  assert.equal(calls,2,'the aborted request must not start a duplicate refresh');
  assert.deepEqual(values,[{runningOrders:3}]);
  assert.deepEqual(errors,[]);
  assert.deepEqual([...timers.values()].map(timer=>timer.delay),[10_000]);
  stop();
  assert.equal(timers.size,0);
  assert.equal(visibility.listener,null);
});

test('a stalled snapshot is aborted before the next poll and teardown leaves no work', async () => {
  const timers=new Map<number,{callback:()=>void;delay:number}>();
  let sequence=0,calls=0;
  const signals:AbortSignal[]=[];
  const runtime:SnapshotPollingRuntime={
    fetch:((_input,init)=>{
      calls++;const signal=init?.signal as AbortSignal;signals.push(signal);
      return new Promise<Response>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
    }) as typeof fetch,
    isHidden:()=>false,onVisibilityChange:()=>()=>{},
    schedule:(callback,delay)=>{const id=++sequence;timers.set(id,{callback,delay});return id},
    cancel:id=>{timers.delete(id)},
  };
  const stop=startSnapshotPolling('shop',()=>assert.fail('an aborted response must not update the UI'),()=>assert.fail('cancellation must not surface as a network error'),runtime);
  assert.equal(calls,1);
  assert.deepEqual([...timers.values()].map(timer=>timer.delay),[15_000],'a pending request has a deadline, never a concurrent poll');
  const [deadlineId,deadline]=[...timers.entries()][0];timers.delete(deadlineId);deadline.callback();
  for(let i=0;i<5;i++)await Promise.resolve();
  assert.equal(signals[0].aborted,true);assert.equal(calls,1);
  const [pollId,poll]=[...timers.entries()][0];assert.equal(poll.delay,10_000);timers.delete(pollId);poll.callback();
  assert.equal(calls,2);
  stop();for(let i=0;i<5;i++)await Promise.resolve();
  assert.equal(signals[1].aborted,true);assert.equal(timers.size,0);
});

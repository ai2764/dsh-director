import test from 'node:test';
import assert from 'node:assert/strict';

async function guard(){const mod=await import('../src/client/send-protection.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});assert.equal(typeof mod.protectSend,'function','draft-preserving send guard must exist');return mod.protectSend;}
const flush=()=>new Promise(r=>setImmediate(r));
test('blocked send leaves draft and attachments intact; fresh ready check submits once',async()=>{
  const protect=await guard();let calls=0,blocked=true;const shell={draft:'next shot',attachments:['ref'],submit(mode){calls++;assert.equal(mode,'queue');this.draft='';this.attachments=[];}};
  const dispose=protect(shell,{check:async()=>({blocked,phase:blocked?'generating':'ready'}),onBlocked(){}});
  shell.submit('queue');await flush();assert.equal(calls,0);assert.equal(shell.draft,'next shot');assert.deepEqual(shell.attachments,['ref']);
  blocked=false;shell.submit('queue');await flush();assert.equal(calls,1);assert.equal(shell.draft,'');dispose();
});
test('rapid clicks share one fresh check, unknown status fails closed, disposal restores native submit',async()=>{
  const protect=await guard();let calls=0,checks=0,finish;const native=function(){calls++;};const shell={submit:native};
  const dispose=protect(shell,{check:()=>{checks++;return new Promise(r=>{finish=r;});},onBlocked(){}});
  shell.submit();shell.submit();assert.equal(checks,1);finish({blocked:false,phase:'ready'});await flush();assert.equal(calls,1);
  dispose();assert.equal(shell.submit,native);
  const remove=protect(shell,{check:async()=>{throw Error('offline');},onBlocked(){}});shell.submit();await flush();assert.equal(calls,1);remove();
});
test('disposing a pending check or receiving malformed readiness never sends',async()=>{
  const protect=await guard();let calls=0,finish;const shell={submit(){calls++;}};
  const dispose=protect(shell,{check:()=>new Promise(r=>{finish=r;}),onBlocked(){}});shell.submit();dispose();finish({blocked:false});await flush();assert.equal(calls,0);
  const remove=protect(shell,{check:async()=>({}),onBlocked(){}});shell.submit();await flush();assert.equal(calls,0);remove();
});
test('two mounted views share protection and either disposal order restores native submission',async()=>{
  const protect=await guard();
  for(const reverse of [false,true]){
    let calls=0;const native=function(){calls++;},shell={submit:native};
    const a=protect(shell,{check:async()=>({phase:'ready',blocked:false}),onBlocked(){}}),b=protect(shell,{check:async()=>({phase:'ready',blocked:false}),onBlocked(){}});
    (reverse?b:a)();shell.submit();await flush();assert.equal(calls,1);
    (reverse?a:b)();assert.equal(shell.submit,native);shell.submit();assert.equal(calls,2);
  }
});

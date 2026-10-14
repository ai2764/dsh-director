import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';

const GiB=1024**3;
async function fixture(){
  const mod=await import('../src/gpu-status.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
  assert.equal(typeof mod.createGpuStatus,'function','live GPU status must exist');
  const remote={queue:{queue_running:[],queue_pending:[]},running:{running:[]},stats:{devices:[{type:'cuda',vram_total:24*GiB,vram_free:23*GiB,torch_vram_total:0,torch_vram_free:0}]}},calls=[];
  const status=mod.createGpuStatus({fetchImpl:async url=>{const path=new URL(url).pathname;calls.push(path);return Response.json(path==='/queue'?remote.queue:path==='/running'?remote.running:remote.stats);}});
  return {mod,status,remote,calls};
}
test('live queue blocks sending and reports actual unloaded LLM without model calls',async()=>{
  const f=await fixture();f.remote.queue.queue_running=[[0,'p']];
  const s=await f.status.snapshot();assert.equal(s.blocked,true);assert.equal(s.phase,'generating');assert.equal(s.llm,'unloaded');
  assert.deepEqual(f.calls.sort(),['/queue','/running','/system_stats']);
});
test('managed GPU handoff remains blocked until verified release, including failed video runs',async()=>{
  const f=await fixture();f.status.update({prompt_id:'p',phase:'waiting_for_vram',execution_status:'failed'});
  assert.equal((await f.status.snapshot()).phase,'releasing_vram');
  f.status.update({prompt_id:'p',phase:'ready_for_review',execution_status:'failed',comfy_release:{verified:true}});
  const s=await f.status.snapshot();assert.equal(s.blocked,false);assert.equal(s.phase,'ready');assert.match(s.warning,/failed/i);
});
test('loaded LLM during rendering is a conflict, not a falsely reassuring unloaded status',async()=>{
  const f=await fixture();f.remote.queue.queue_running=[[0,'p']];f.remote.running={running:[{model:'qwen'}]};
  const s=await f.status.snapshot();assert.equal(s.blocked,true);assert.equal(s.llm,'loaded');assert.match(s.warning,/LLM.*loaded/i);
});
test('unknown transport, malformed queue and cancelled monitors cannot unlock sending',async()=>{
  const f=await fixture();f.remote.queue={};assert.equal((await f.status.snapshot()).blocked,true);
  f.remote.queue={queue_running:[],queue_pending:[]};f.status.update({prompt_id:'p',phase:'cancelled'});
  f.remote.stats.devices[0].torch_vram_total=10*GiB;
  assert.equal((await f.status.snapshot()).blocked,true);
  f.remote.stats.devices[0].torch_vram_total=0;assert.equal((await f.status.snapshot()).blocked,false,'cancelled monitoring requires fresh physical release proof');
  const offline=f.mod.createGpuStatus({fetchImpl:async()=>{throw Error('offline');}});
  assert.equal((await offline.snapshot()).phase,'unknown');
});
test('idle LLM occupancy is allowed but leftover Comfy cache is not',async()=>{
  const f=await fixture();f.remote.running={running:[{model:'qwen'}]};f.remote.stats.devices[0].vram_free=GiB;
  assert.equal((await f.status.snapshot()).blocked,false);
  f.remote.stats.devices[0].torch_vram_total=10*GiB;assert.equal((await f.status.snapshot()).phase,'releasing_vram');
});
test('cached Torch reservation and invalid memory measurements never count as release',async()=>{
  const f=await fixture(),d=f.remote.stats.devices[0];f.status.update({prompt_id:'p',phase:'cancelled'});
  d.torch_vram_total=10*GiB;d.torch_vram_free=10*GiB;assert.equal((await f.status.snapshot()).blocked,true);
  d.torch_vram_total=32*1024**2;d.torch_vram_free=32*1024**2;d.vram_free=d.vram_total*.9+16*1024**2;assert.equal((await f.status.snapshot()).blocked,true);
  d.torch_vram_total=-1;assert.equal((await f.status.snapshot()).phase,'unknown');
  d.torch_vram_total=0;d.torch_vram_free=0;d.vram_free=d.vram_total+1;assert.equal((await f.status.snapshot()).phase,'unknown');
});
test('status HTTP route authenticates before querying, never returns paths or prompt content',async t=>{
  const f=await fixture();const handler=f.mod.createGpuStatusHandler({status:f.status,requestRejection:req=>req.headers['x-deny']?403:undefined});
  const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const url=`http://127.0.0.1:${server.address().port}/director-gpu-status`;
  assert.equal((await fetch(url,{headers:{'x-deny':'1'}})).status,403);assert.equal(f.calls.length,0);
  const response=await fetch(url);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await response.json()).phase,'ready');
  assert.equal((await fetch(url,{method:'POST'})).status,405);
});
test('a send check cannot join a poll started before a new ComfyUI prompt',async()=>{
  const f=await fixture();let busy=false,first=true,finishStats;const wait=new Promise(r=>{finishStats=r;});
  const status=f.mod.createGpuStatus({fetchImpl:async url=>{
    const path=new URL(url).pathname;
    if(path==='/queue')return Response.json({queue_running:busy?[[0,'new']]:[],queue_pending:[]});
    if(path==='/running')return Response.json({running:[]});
    if(first){first=false;await wait;}return Response.json(f.remote.stats);
  }});
  const poll=status.snapshot();busy=true;
  const send=await status.snapshot();assert.equal(send.blocked,true);assert.equal(send.phase,'generating');
  finishStats();assert.equal((await poll).blocked,true,'readiness must recheck the queue after slow memory statistics');
});

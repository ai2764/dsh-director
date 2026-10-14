const MiB=1024**2;
function models(value){
  const items=Array.isArray(value)?value:value?.running??value?.models;
  if(!Array.isArray(items))throw Error('Invalid llama-swap running status');
  if(items.some(v=>typeof v!=='string'&&(!v||typeof(v.model??v.name)!=='string')))throw Error('Invalid running model entry');
  return items.length;
}
const unknown=()=>({phase:'unknown',blocked:true,llm:'unknown',warning:'GPU status unavailable. Sending is paused; your draft is safe. Check ComfyUI and llama-swap.'});
export function createGpuStatus({comfyBaseUrl='http://127.0.0.1:8188',llamaSwapBaseUrl='http://127.0.0.1:11435',fetchImpl=globalThis.fetch}={}){
  const tasks=new Map();
  function update(value){
    if(!value?.prompt_id)return;
    if(['ready_for_review','submission_failed'].includes(value.phase))tasks.delete(value.prompt_id);
    else tasks.set(value.prompt_id,{phase:value.phase});
    if(value.execution_status==='failed')lastWarning='Video generation failed. Check the job error before retrying.';
  }
  let lastWarning;
  async function sample(){
    try{
      const get=async(base,path)=>{const r=await fetchImpl(new URL(path,base),{redirect:'error',signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('Service unavailable');return r.json();};
      const [queue,running,stats]=await Promise.all([get(comfyBaseUrl,'/queue'),get(llamaSwapBaseUrl,'/running'),get(comfyBaseUrl,'/system_stats')]);
      const queueCounts=q=>{if(!Array.isArray(q?.queue_running)||!Array.isArray(q?.queue_pending))throw Error('Invalid queue');return {running:q.queue_running.length,queued:q.queue_pending.length};};
      const llm=models(running)?'loaded':'unloaded';
      const devices=stats?.devices?.filter(d=>d.type==='cuda');
      if(!devices?.length||devices.some(d=>![d.vram_total,d.vram_free,d.torch_vram_total,d.torch_vram_free].every(v=>Number.isFinite(v)&&v>=0)||d.vram_total===0||d.vram_free>d.vram_total||d.torch_vram_free>d.torch_vram_total||d.torch_vram_total>d.vram_total))throw Error('Invalid GPU evidence');
      const cacheFree=devices.every(d=>d.torch_vram_total<=64*MiB);
      const physicalFree=cacheFree&&devices.every(d=>(d.vram_free-d.torch_vram_free)/d.vram_total>=0.9);
      const counts=queueCounts(queue),busy=counts.running+counts.queued;
      const generating=c=>({phase:'generating',blocked:true,llm,...c,...(llm==='loaded'?{warning:'LLM is loaded while ComfyUI is running. Sending is paused to avoid a VRAM conflict.'}:{})});
      if(busy)return generating(counts);
      // Cancelling a monitor is not release evidence. Recover only from fresh GPU evidence.
      if(physicalFree)for(const [id,t] of tasks)if(['cancelled','unmonitored'].includes(t.phase))tasks.delete(id);
      const active=[...tasks.values()];
      if(active.length)return {phase:active.some(t=>['queued','unloading_llm','generating'].includes(t.phase))?'generating':'releasing_vram',blocked:true,llm,...(active.some(t=>['monitor_error','waiting_for_history','unmonitored'].includes(t.phase))?{warning:'GPU handoff is not verified. Check the job monitor; do not resubmit the video.'}:{})};
      if(!cacheFree||(llm==='unloaded'&&!physicalFree))return {phase:'releasing_vram',blocked:true,llm,warning:'ComfyUI memory is not released yet. Sending stays paused until GPU release is verified.'};
      // Statistics may be slow. Do not publish old idle evidence after a new prompt.
      const finalQueue=queueCounts(await get(comfyBaseUrl,'/queue'));
      if(finalQueue.running+finalQueue.queued)return generating(finalQueue);
      if(tasks.size)return {phase:'releasing_vram',blocked:true,llm};
      return {phase:'ready',blocked:false,llm,...(lastWarning?{warning:lastWarning}:{})};
    }catch{return unknown();}
  }
  // Every request starts its own evidence sample, including an explicit Send.
  return {update,snapshot:sample};
}
export function createGpuStatusHandler({status,requestRejection}){
  return async(req,res)=>{
    const rejection=requestRejection(req);if(rejection!==undefined){res.writeHead(rejection);res.end();return;}
    if(req.method!=='GET'){res.writeHead(405,{Allow:'GET'});res.end();return;}
    const value=await status.snapshot();if(res.destroyed)return;
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));
  };
}
export function registerGpuStatusRoute(ctx,status){return ctx.webServer.register({kind:'exact',path:'/director-gpu-status',handler:createGpuStatusHandler({status,requestRejection:req=>ctx.connection.requestRejection(req)})});}

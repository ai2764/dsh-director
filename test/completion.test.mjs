import test from 'node:test';import assert from 'node:assert/strict';
import {createSubmitComfyVideo} from '../src/submit-comfy-video.mjs';
test('configured background completion supplies real output URLs and presentation handoff',async()=>{
  let spec;const urls=[];
  const submit=createSubmitComfyVideo({comfyBaseUrl:'http://comfy.example:8000',llamaSwapBaseUrl:'http://swap.example:9000',startJob:s=>{spec=s;return 'j';},sleep:async()=>{},fetchImpl:async u=>{
    urls.push(String(u));
    if(String(u).endsWith('/prompt'))return Response.json({prompt_id:'p'});
    if(String(u).endsWith('/history/p'))return Response.json({p:{status:{completed:true,status_str:'success'},outputs:{'1':{gifs:[{filename:'clip.mp4',subfolder:'test',type:'output'}]}}}});
    if(String(u).endsWith('/queue'))return Response.json({queue_running:[],queue_pending:[]});
    if(String(u).endsWith('/system_stats'))return Response.json({devices:[{type:'cuda',index:0,vram_total:24*1024**3,vram_free:23*1024**3,torch_vram_total:0,torch_vram_free:0}]});
    return Response.json({});
  }});
  await submit({workflow:{1:{class_type:'Test',inputs:{}}}},{agent:{id:'s'},concludeTurn(){}});
  const result=await spec.run().done;assert.equal(result.status,'completed');
  const output=JSON.parse(result.output);
  assert.equal(output.comfy_release.verified,true);
  assert.equal(output.output_artifacts[0].view_url,'http://comfy.example:8000/view?filename=clip.mp4&subfolder=test&type=output');
  assert.match(output.review_instruction,/director_show_media/);
  assert.ok(urls.every(u=>u.startsWith('http://comfy.example:8000/')||u.startsWith('http://swap.example:9000/')));
});

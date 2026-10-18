import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubmitComfyVideo} from '../src/submit-comfy-video.mjs';

function interfaceResponse(url){
  if(String(url).endsWith('/object_info/MiniMaxH3MotionContext'))return Response.json({MiniMaxH3MotionContext:{input:{required:{conditioning:['CONDITIONING'],latent:['LATENT']},optional:{context_frames:['IMAGE'],context_latent:['LATENT']}}}});
  if(String(url).endsWith('/object_info/VHS_LoadVideo'))return Response.json({VHS_LoadVideo:{input:{required:{video:[['previous_00001_.mp4']]}}}});
  if(String(url).includes('/view?'))return new Response(null,{status:200});
  if(String(url).includes('/object_info/')){
    const type=String(url).split('/').at(-1);
    return Response.json({[type]:{input:{required:type==='SyntheticOutput'?{conditioning:['CONDITIONING']}:{ }},output_node:type==='SyntheticOutput'}});
  }
}

test('independent I2V and FLF workflow validation remains available',async()=>{
  const submit=createSubmitComfyVideo({fetchImpl:async()=>{throw Error('offline validation');}});
  for(const class_type of ['MiniMaxH3ImageToVideo','MiniMaxH3FirstLastFrameToVideo']){
    const result=await submit({workflow:{'1':{class_type,inputs:{image:'standalone.png'}}},intent:'generic',validate_only:true},{});
    assert.equal(result.submission_ready,true,class_type);
    assert.equal(result.continuity.mode,'none',class_type);
  }
});

test('multi-frame video Motion Context validates and reaches the normal Comfy submission boundary',async()=>{
  let posted=false;
  const submit=createSubmitComfyVideo({fetchImpl:async(url)=>{
    const schema=interfaceResponse(url);if(schema)return schema;
    assert.match(String(url),/\/prompt$/);posted=true;
    return new Response(JSON.stringify({error:'queue-boundary-sentinel'}),{status:400});
  }});
  const workflow={
    '1':{class_type:'SyntheticConditioning',inputs:{}},
    '2':{class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['1',0],latent:['1',1],context_frames:['4',2],context_length:'22'}},
    '3':{class_type:'SyntheticOutput',inputs:{conditioning:['2',0]}},
    '4':{class_type:'VHS_LoadVideo',inputs:{video:'previous_00001_.mp4'}},
  };
  const checked=await submit({workflow,continuity_requirement:'video_frames',validate_only:true},{});
  assert.equal(checked.submission_ready,true);
  assert.equal(checked.continuity.mode,'video_frames');
  assert.equal(posted,false);
  await assert.rejects(submit({workflow,continuity_requirement:'video_frames'},{}),/queue-boundary-sentinel/);
  assert.equal(posted,true);
});

test('latent requirement blocks decoded-video context before queueing',async()=>{
  let posted=false;
  const submit=createSubmitComfyVideo({fetchImpl:async()=>{posted=true;throw Error('unexpected queue');}});
  const workflow={
    '1':{class_type:'SyntheticConditioning',inputs:{}},
    '2':{class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['1',0],context_frames:['4',2]}},
    '3':{class_type:'SyntheticOutput',inputs:{conditioning:['2',0]}},
    '4':{class_type:'VHS_LoadVideo',inputs:{video:'C2.mp4'}},
  };
  const checked=await submit({workflow,continuity_requirement:'sampler_latent',validate_only:true},{concludeTurn(){}});
  assert.equal(checked.submission_ready,false);
  assert.equal(checked.continuity.mode,'video_frames');
  assert.match(checked.submission_blockers.join(' '),/sampler.latent|context_latent/i);
  await assert.rejects(submit({workflow,continuity_requirement:'sampler_latent'},{concludeTurn(){}}),/sampler.latent|context_latent/i);
  assert.equal(posted,false);
});

test('a dependent H3 graph requires an explicit route even when its wiring is recognizable',async()=>{
  let posted=false;
  const submit=createSubmitComfyVideo({fetchImpl:async()=>{posted=true;throw Error('unexpected network');}});
  const workflow={
    '6':{class_type:'MiniMaxH3ReferenceToVideo',inputs:{prompt:'template prompt'}},
    '26':{class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['6',0],context_frames:['30',0]}},
    '30':{class_type:'VHS_LoadVideo',inputs:{video:'C3.mp4'}},
  };
  const checked=await submit({workflow,validate_only:true},{});
  assert.equal(checked.submission_ready,false);
  assert.match(checked.submission_blockers.join(' '),/continuity_requirement.*video_frames/i);
  await assert.rejects(submit({workflow},{}),/continuity_requirement.*video_frames/i);
  assert.equal(posted,false);
});

test('H3 continuity mismatch is reported before reference inspection in read-only validation',async()=>{
  const submit=createSubmitComfyVideo({fetchImpl:async()=>{throw Error('no network needed for wrong context route');}});
  const workflow={
    '6':{class_type:'MiniMaxH3ReferenceToVideo',inputs:{prompt:'template prompt'}},
    '26':{class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['6',0],context_frames:['31',2]}},
    '30':{class_type:'VHS_LoadVideo',inputs:{video:'C2.mp4'}},
    '31':{class_type:'VHS_SplitImages',inputs:{images:['30',0]}},
  };
  const result=await submit({workflow,validate_only:true,continuity_requirement:'sampler_latent'},{});
  assert.equal(result.submission_ready,false);
  assert.equal(result.continuity.mode,'video_frames');
  assert.match(result.submission_blockers.join(' '),/sampler_latent/);
});

test('saved sampler latent must exist before a dependent graph can queue',async()=>{
  const requests=[];
  let exists=false;
  const submit=createSubmitComfyVideo({fetchImpl:async(input,init)=>{
    const schema=interfaceResponse(input);if(schema)return schema;
    requests.push({input,init});
    if(String(input).endsWith('/h3_motion_context/slot_exists'))return {ok:true,json:async()=>({exists})};
    throw Error('unexpected Comfy request');
  }});
  const workflow={
    '1':{class_type:'SyntheticConditioning',inputs:{}},
    '2':{class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['1',0],latent:['1',1],context_latent:['3',0]}},
    '3':{class_type:'MiniMaxH3MotionContextLoadLatent',inputs:{latent_path:'chain',clip_index:1}},
    '4':{class_type:'SyntheticOutput',inputs:{conditioning:['2',0]}},
  };
  const args={workflow,continuity_requirement:'sampler_latent',validate_only:true};
  const checked=await submit(args,{});
  assert.equal(checked.submission_ready,false);
  assert.match(checked.submission_blockers.join(' '),/not available yet.*chain.*clip 1/);
  assert.deepEqual(JSON.parse(requests[0].init.body),{latent_path:'chain',clip_index:1});
  assert.equal(requests[0].init.headers.origin,'http://127.0.0.1:8188');
  await assert.rejects(submit({...args,validate_only:false},{}),/not available yet/);
  assert.equal(requests.some(r=>String(r.input).endsWith('/prompt')),false);
  exists=true;
  const ready=await submit(args,{});
  assert.equal(ready.submission_ready,true);
});

test('broken H3 core links are rejected locally before ComfyUI receives a prompt',async()=>{
  let requested=false;
  const submit=createSubmitComfyVideo({fetchImpl:async()=>{requested=true;throw Error('unexpected network')}});
  const base={
    '5':{class_type:'VAELoader',inputs:{vae_name:'audio.safetensors'}},
    '6':{class_type:'MiniMaxH3ReferenceToVideo',inputs:{audio_vae:['5',2]}},
    '12':{class_type:'VAEDecode',inputs:{}},
    '14':{class_type:'SaveVideo',inputs:{video:['12',0]}},
  };
  for(const [graph,pattern] of [
    [base,/node 6 input audio_vae.*output 2.*only 1 output/s],
    [{...base,'6':{...base['6'],inputs:{audio_vae:['5',0]}},'14':{...base['14'],inputs:{video:['28',0]}}},/node 14 input video links to missing node 28/s],
    [{...base,'6':{...base['6'],inputs:{audio_vae:['5',0]}}},/node 14 input video expects VIDEO.*is IMAGE/s],
  ])await assert.rejects(submit({workflow:graph,validate_only:true},{}),pattern);
  assert.equal(requested,false);
});

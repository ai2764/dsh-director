import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectComfyGraph} from '../src/workflow-discovery.mjs';
import {createSubmitComfyVideo} from '../src/submit-comfy-video.mjs';

const graph=()=>({
  '6':{class_type:'MiniMaxH3ImageToVideo',inputs:{}},
  '8':{class_type:'BasicGuider',inputs:{conditioning:['23',0]}},
  '11':{class_type:'SamplerCustomAdvanced',inputs:{guider:['8',0],latent_image:['6',1]}},
  '12':{class_type:'VAEDecode',inputs:{samples:['11',0]}},
  '17':{class_type:'VAEDecodeAudio',inputs:{samples:['11',0]}},
  '13':{class_type:'CreateVideo',inputs:{images:['24',0],audio:['24',1]}},
  '14':{class_type:'SaveVideo',inputs:{video:['13',0],filename_prefix:'new/shot'}},
  '22':{class_type:'MiniMaxH3MotionContextLoadLatent',inputs:{latent_path:'chain/clip_00001.safetensors',clip_index:1}},
  '23':{class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['6',0],latent:['6',1],context_latent:['22',0],context_length:'22'}},
  '24':{class_type:'MiniMaxH3MotionContextTrim',inputs:{images:['12',0],audio:['17',0],trim_frames:['23',1],fps:24}},
  '25':{class_type:'MiniMaxH3MotionContextSaveLatent',inputs:{latent:['11',0],filename_prefix:'chain/clip',clip_index:2}},
});

test('a complete known H3 continuation proves sampler, synchronized trim and saved video paths',()=>{
  const g=graph(),continuity=inspectComfyGraph(g).continuity;
  assert.equal(continuity.wiring_verified,true);
  assert.deepEqual(continuity.wiring_issues,[]);
  delete g['25'];
  assert.equal(inspectComfyGraph(g).continuity.wiring_verified,true,'a terminal clip is allowed to omit saving its next latent');
  assert.equal(inspectComfyGraph(g).continuity.latent_saved_for_next,false);
});

for(const [name,breakGraph,pattern] of [
  ['disconnected conditioning',g=>g['8'].inputs.conditioning=['6',0],/conditioning.*sampler/i],
  ['untrimmed images',g=>g['13'].inputs.images=['12',0],/trim.*output/i],
  ['untrimmed audio',g=>g['13'].inputs.audio=['17',0],/audio.*trim|trim.*audio/i],
  ['wrong trim source',g=>g['24'].inputs.trim_frames=['23',0],/trim/i],
])test(`known H3 ${name} is rejected before latent lookup or queueing`,async()=>{
  const g=graph();breakGraph(g);
  const continuity=inspectComfyGraph(g).continuity;
  assert.equal(continuity.wiring_verified,false);
  assert.match(continuity.wiring_issues.join(' '),pattern);
  assert.match(continuity.explanation,/unverified/i);
  let calls=0;
  const submit=createSubmitComfyVideo({fetchImpl:async()=>{calls++;throw Error('unexpected network');}});
  const result=await submit({workflow:g,continuity_requirement:'sampler_latent',validate_only:true},{});
  assert.equal(result.submission_ready,false);
  assert.match(result.submission_blockers.join(' '),pattern);
  await assert.rejects(submit({workflow:g,continuity_requirement:'sampler_latent'},{}),pattern);
  assert.equal(calls,0);
});

test('independent coding graphs are not subject to an H3 continuation wiring contract',async()=>{
  const submit=createSubmitComfyVideo({fetchImpl:async()=>{throw Error('offline');}});
  for(const workflow of [{'1':{class_type:'ArbitraryCodingNode',inputs:{}}},{'6':graph()['6']}]){
    const result=await submit({workflow,intent:'generic',validate_only:true},{});
    assert.equal(result.submission_ready,true);
  }
});

test('an inactive first-clip context does not gate an independent output path',async()=>{
  const g=graph();g['22'].inputs.clip_index=0;g['8'].inputs.conditioning=['6',0];
  g['13'].inputs.images=['12',0];g['13'].inputs.audio=['17',0];delete g['24'];
  const submit=createSubmitComfyVideo({fetchImpl:async()=>{throw Error('unexpected network');}});
  const result=await submit({workflow:g,validate_only:true},{});
  assert.equal(result.continuity.mode,'none');
  assert.equal(result.submission_ready,true);
});

test('an unrelated sampler save is not reported as the current conditioned clip latent',()=>{
  const g=graph();g['50']={class_type:'SamplerCustomAdvanced',inputs:{latent_image:['6',1]}};
  g['25'].inputs.latent=['50',0];
  const continuity=inspectComfyGraph(g).continuity;
  assert.equal(continuity.wiring_verified,true,'terminal clips need not save a next slot');
  assert.equal(continuity.latent_saved_for_next,false);
  assert.equal(continuity.latent_slots.save_clip_index,null);
});

test('a parallel sampler sharing context but not producing the saved video cannot supply its next latent',()=>{
  const g=graph();
  g['50']={class_type:'SamplerCustomAdvanced',inputs:{...g['11'].inputs,noise:['51',0]}};
  g['51']={class_type:'RandomNoise',inputs:{noise_seed:987654}};
  g['25'].inputs.latent=['50',0];
  const continuity=inspectComfyGraph(g).continuity;
  assert.equal(continuity.wiring_verified,true);
  assert.equal(continuity.latent_saved_for_next,false);
  assert.equal(continuity.latent_slots.save_clip_index,null);
});

test('an idle first MotionContext cannot conceal the active saved video continuation',()=>{
  const g=graph();g['2']={class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['6',0],latent:['6',1]}};
  const continuity=inspectComfyGraph(g).continuity;
  assert.equal(continuity.mode,'sampler_latent');
  assert.equal(continuity.source,'chain/clip_00001.safetensors (clip 1)');
  assert.equal(continuity.wiring.context_input.node,'23');
  assert.equal(continuity.wiring_verified,true);
});

test('an independent saved video ignores residual context, but cannot satisfy an explicit latent requirement',async()=>{
  const g=graph();
  g['8'].inputs.conditioning=['6',0];
  g['13'].inputs.images=['12',0];g['13'].inputs.audio=['17',0];
  const continuity=inspectComfyGraph(g).continuity;
  assert.equal(continuity.mode,'none');
  assert.notEqual(continuity.wiring_verified,true);
  let calls=0;
  const submit=createSubmitComfyVideo({fetchImpl:async url=>{assert.match(String(url),/\/object_info\//);calls++;throw Error('schema unavailable');}});
  assert.equal((await submit({workflow:g,intent:'generic',validate_only:true},{})).submission_ready,true);
  const requested=await submit({workflow:g,intent:'generic',continuity_requirement:'sampler_latent',validate_only:true},{});
  assert.equal(requested.submission_ready,false);
  assert.match(requested.submission_blockers.join(' '),/sampler_latent.*not met.*none/i);
  assert.ok(calls>0,'interface lookup can be attempted without queueing an unused context');
});

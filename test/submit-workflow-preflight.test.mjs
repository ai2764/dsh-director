import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubmitComfyVideo} from '../src/submit-comfy-video.mjs';

const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const schemas={
  MiniMaxH3MotionContext:{input:{required:{conditioning:['CONDITIONING'],latent:['LATENT']},optional:{context_frames:['IMAGE']}}},
  VHS_LoadVideo:{input:{required:{video:[['input.mp4'],{video_upload:true}]}}},
  Conditioning:{input:{required:{}},output_node:false},
  BasicGuider:{input:{required:{conditioning:['CONDITIONING']}}},
  SamplerCustomAdvanced:{input:{required:{guider:['GUIDER']}}},
  TestOutput:{input:{required:{value:['ANY']}},output_node:true},
};
const withOutput=(workflow,node)=>({...workflow,out:{class_type:'TestOutput',inputs:{value:[node,0]}}});
function harness({status=200,offline=false}={}){
  const calls=[];
  return {calls,submit:createSubmitComfyVideo({fetchImpl:async(url,init)=>{
    const u=new URL(url);calls.push({url:u,init});
    if(u.pathname.startsWith('/object_info/')){
      if(offline)throw Error('schema unavailable');
      const type=decodeURIComponent(u.pathname.split('/').at(-1));return json({[type]:schemas[type]});
    }
    if(u.pathname==='/view')return new Response(null,{status});
    throw Error(`Unexpected request ${url}`);
  }})};
}

test('active cycle is blocked in both validation and submission before queueing',async()=>{
  const {submit,calls}=harness();
  const workflow=withOutput({
    '30':{class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['1',0],latent:['11',0]}},
    '1':{class_type:'Conditioning',inputs:{}},
    '11':{class_type:'SamplerCustomAdvanced',inputs:{guider:['8',0]}},
    '8':{class_type:'BasicGuider',inputs:{conditioning:['30',0]}},
  },'11');
  const checked=await submit({workflow,validate_only:true},{});
  assert.equal(checked.submission_ready,false);
  assert.match(checked.submission_blockers.join(' '),/cycle.*(?:30|11|8)/i);
  await assert.rejects(submit({workflow},{}),/cycle/i);
  assert.ok(calls.every(c=>c.url.pathname.startsWith('/object_info/')));
});

test('required installed MotionContext latent input cannot be removed to repair a cycle',async()=>{
  const {submit,calls}=harness();
  const workflow=withOutput({'1':{class_type:'Conditioning',inputs:{}},'30':{class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['1',0]}}},'30');
  const checked=await submit({workflow,validate_only:true},{});
  assert.equal(checked.submission_ready,false);
  assert.match(checked.submission_blockers.join(' '),/30.*required input latent/i);
  await assert.rejects(submit({workflow},{}),/latent/);
  assert.ok(calls.every(c=>c.url.pathname.startsWith('/object_info/')));
});

test('VHS video existence is checked before queueing with an actionable input/output path',async()=>{
  const {submit,calls}=harness({status:404});
  const workflow=withOutput({'40':{class_type:'VHS_LoadVideo',inputs:{video:'minimax_h3/previous.mp4'}}},'40');
  const checked=await submit({workflow,validate_only:true},{});
  assert.equal(checked.submission_ready,false);
  assert.match(checked.submission_blockers.join(' '),/40.*video.*input.*minimax_h3\/previous\.mp4/i);
  assert.match(checked.submission_blockers.join(' '),/\[output\]|upload/i);
  await assert.rejects(submit({workflow},{}),/video/);
  assert.equal(calls.some(c=>c.url.pathname==='/prompt'),false);
  const view=calls.find(c=>c.url.pathname==='/view');
  assert.equal(view.init.method,'HEAD');assert.equal(view.url.searchParams.get('type'),'input');
});

test('existing annotated output video is accepted even absent from input dropdown',async()=>{
  const {submit,calls}=harness();
  const checked=await submit({workflow:withOutput({'40':{class_type:'VHS_LoadVideo',inputs:{video:'minimax_h3/previous.mp4 [output]'}}},'40'),validate_only:true},{});
  assert.equal(checked.submission_ready,true);
  const view=calls.find(c=>c.url.pathname==='/view');
  assert.equal(view.url.searchParams.get('type'),'output');
  assert.equal(view.url.searchParams.get('subfolder'),'minimax_h3');
  assert.equal(view.url.searchParams.get('filename'),'previous.mp4');
  assert.match(checked.workflow_preflight.limitations.join(' '),/decod|runtime/i);
});

test('unavailable interfaces report incomplete checks without blocking unknown custom behavior',async()=>{
  const {submit}=harness({offline:true});
  const checked=await submit({workflow:{'40':{class_type:'VHS_LoadVideo',inputs:{video:'input.mp4'}}},validate_only:true},{});
  assert.equal(checked.workflow_preflight.complete,false);
  assert.match(checked.workflow_preflight.warnings.join(' '),/schema|interface/i);
});

test('disconnected bad context, video and cycle do not block the active output',async()=>{
  const {submit,calls}=harness({status:404});
  const workflow=withOutput({
    '1':{class_type:'Conditioning',inputs:{}},
    '30':{class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['8',0]}},
    '8':{class_type:'BasicGuider',inputs:{conditioning:['30',0]}},
    '40':{class_type:'VHS_LoadVideo',inputs:{video:'missing.mp4'}},
  },'1');
  const checked=await submit({workflow,validate_only:true},{});
  assert.equal(checked.submission_ready,true);
  assert.equal(calls.some(c=>c.url.pathname==='/view'),false);
});

test('view policy restrictions do not reject files accepted by VHS',async()=>{
  for(const [video,status] of [['take..mp4',400],['input.mp4',405],['input.mp4',403]]){
    const {submit}=harness({status});
    const checked=await submit({workflow:withOutput({'40':{class_type:'VHS_LoadVideo',inputs:{video}}},'40'),validate_only:true},{});
    assert.equal(checked.submission_ready,true);
    assert.equal(checked.workflow_preflight.complete,false);
  }
});

test('custom workflows remain available and expose the validation boundary',async()=>{
  const {submit,calls}=harness();
  const checked=await submit({workflow:{'x':{class_type:'MyCustomImageNode',inputs:{}}},validate_only:true},{});
  assert.equal(checked.submission_ready,true);assert.equal(calls.length,0);
  assert.match(checked.workflow_preflight.limitations.join(' '),/custom|runtime/i);
});

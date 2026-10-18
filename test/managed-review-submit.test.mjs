import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {apply} from '../src/submit-comfy-video.mjs';

const bytes=Buffer.from('synthetic reviewed image');
const source=join(tmpdir(),'director-reviewed-image.png');
const sections={subject_definitions:'<Picture 1> defines the cat.',summary:'The cat waves.',retention_analysis:'Retain <Picture 1> identity.',detailed_description:'The cat from <Picture 1> waves once, without dialogue.',overall_soundscape:'Room tone.',non_diegetic_music:'None.'};
const graph=()=>({'1':{class_type:'LoadImage',inputs:{image:'cat.png'}},'6':{class_type:'MiniMaxH3ReferenceToVideo',inputs:{prompt:Object.entries(sections).map(([k,v])=>`${k}: ${v}`).join('\n'),'ref_images.ref_image_0':['1',0],width:704,height:1280,length:56}}});
const review=()=>({references:[{picture_index:1,image:'cat.png',source_path:source,observation:'One illustrated cat.',responsibility:'Cat identity.'}],dialogue:[]});
function harness({approved=true,withCard=true,rejectComfy=false,onLatentCheck,workflowPath,workflow}={}){
  const card={kind:'director-media',version:1,card_id:'card-current',session_id:'test-session',items:[{type:'image',sha256:createHash('sha256').update(bytes).digest('hex')}],proposal:{version:'shot-v1',clip_dimensions:[{clip_id:'c1',width:704,height:1280}],clip_references:[{clip_id:'c1',reference_numbers:[1]}],shots:[{clip_id:'c1',shot_id:'s1',reference_numbers:[1],content:'The cat waves.',duration_seconds:56/24,dialogue:''}]}};
  if(workflowPath)card.proposal.clip_workflows=[{clip_id:'c1',workflow_path:workflowPath,continuity_mode:'sampler_latent',continuity_source:'chain (clip 1)'}];
  // Actual Harness 0.2 tool/message shape. Old nested-only extraction fails this lifecycle.
  const events=[
    {seq:0,type:'tool/call',data:{callId:'read',name:'read_image',arguments:JSON.stringify({file_path:source})}},
    {seq:1,type:'tool/result',data:{message:{role:'tool',toolCallId:'read',isError:false,content:[{type:'text',text:`<path>${source}</path>`},{type:'image',attachment:{attachmentId:'image-1'}}]}}},
    {seq:2,type:'assistant/message',data:{message:{source:{kind:'model'},content:[{type:'text',text:'A cat is visible.'}]}}},
    ...(withCard?[
      {seq:3,type:'tool/call',data:{callId:'card',name:'director_show_media',arguments:'{}'}},
      {seq:4,type:'tool/result',data:{message:{role:'tool',toolCallId:'card',isError:false,content:[{type:'text',text:JSON.stringify(card)}]},meta:card}},
      ...(approved?[{seq:5,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'ok'}]}}]:[]),
    ]:[]),
  ];
  const requests=[],definitions=[];let concluded=0;
  apply({tools:{register(d){definitions.push(d);}},effect:f=>f(),jobs:{start(){return 'managed-test-job';}}},{readFileImpl:async path=>workflowPath&&path===workflowPath?JSON.stringify(workflow):bytes,sleep:async()=>{},fetchImpl:async(url,init={})=>{
    requests.push({url:String(url),init});
    if(String(url).includes('/object_info/')){
      const type=String(url).split('/').at(-1),node=Object.values(workflow??graph()).find(n=>n.class_type===type);
      return Response.json({[type]:{input:{required:Object.fromEntries(Object.keys(node?.inputs??{}).map(key=>[key,['ANY']]))},output_node:type==='SaveVideo'}});
    }
    if(String(url).includes('/view?'))return new Response(bytes);
    if(String(url).endsWith('/h3_motion_context/slot_exists')){onLatentCheck?.(events);return Response.json({exists:true});}
    if(String(url).endsWith('/prompt'))return rejectComfy?Response.json({error:'synthetic schema rejection'},{status:400}):Response.json({prompt_id:'queued-test-prompt'});
    if(String(url).endsWith('/api/models/unload')||String(url).endsWith('/running'))return Response.json({running:[]});
    throw Error(`Unexpected request ${url}`);
  }});
  return {tool:definitions.find(t=>t.name==='submit_comfy_job'),events,requests,exec:{agent:{id:'test-session',session:{snapshotEvents:()=>events,surface:{nodes:[1,2,4,5]}}},concludeTurn(){concluded++;}},get concluded(){return concluded;}};
}
const boundArgs=()=>({workflow:graph(),card_id:'card-current',clip_id:'c1',h3_review:review()});

test('managed H3 reports missing review before requiring a final prompt or visual preflight',async()=>{
  const h=harness({withCard:false}),workflow=graph();workflow['6'].inputs.prompt='';
  const result=await h.tool.execute({workflow,validate_only:true},h.exec);
  assert.equal(result.status,'blocked');assert.equal(result.submission_ready,false);
  assert.equal(result.issues[0].code,'REVIEW_REQUIRED');
  assert.equal(result.retry_identical,false);assert.equal(h.requests.length,0);
  assert.match(h.tool.output.render({},result)[0].text,/director_workflows|confirmation|confirm/i);
});

test('managed H3 waits for current card approval without classifying it as execution failure',async()=>{
  const h=harness({approved:false});
  const result=await h.tool.execute({...boundArgs(),validate_only:true},h.exec);
  assert.equal(result.status,'blocked');assert.equal(result.issues[0].code,'REVIEW_REQUIRED');
  assert.equal(h.requests.length,0);assert.equal(h.concluded,0);
});

test('actual flat card plus user approval validates and submits its precise clip',async()=>{
  const h=harness();
  const checked=await h.tool.execute({...boundArgs(),validate_only:true},h.exec);
  assert.equal(checked.submission_ready,true);assert.equal(checked.review_binding.card_id,'card-current');assert.equal(checked.review_binding.clip_id,'c1');
  assert.equal(h.requests.some(r=>r.url.endsWith('/prompt')),false);
  const result=await h.tool.execute(boundArgs(),h.exec);
  assert.equal(result.prompt_id,'queued-test-prompt');assert.equal(result.review_binding.card_id,'card-current');assert.equal(h.concluded,1);
  const actual=JSON.parse(h.requests.find(r=>r.url.endsWith('/prompt')).init.body).prompt;
  assert.equal(actual['6'].inputs.width,704);assert.equal(actual['6'].inputs.length,56);
});

test('stale explicit card binding cannot borrow approval from the latest proposal',async()=>{
  const h=harness();const result=await h.tool.execute({...boundArgs(),card_id:'card-old'},h.exec);
  assert.equal(result.status,'blocked');assert.equal(result.submission_ready,false);assert.equal(h.requests.length,0);
});

test('changed spoken words cannot be approved by matching model-written review and prompt',async()=>{
  const h=harness(),args=boundArgs();
  args.workflow['6'].inputs.prompt=args.workflow['6'].inputs.prompt.replace(sections.detailed_description,'Cat from <Picture 1> says <d>[English] Hello.</d>');
  args.h3_review.dialogue=[{speaker:'Cat',language:'English',text:'Hello.'}];
  const result=await h.tool.execute({...args,validate_only:true},h.exec);
  assert.equal(result.submission_ready,false);assert.match(result.submission_blockers.join(' '),/dialogue|spoken/i);
  assert.equal(h.requests.some(r=>r.url.endsWith('/prompt')),false);
});

test('public preflight returns actionable graph diagnostics without queueing',async()=>{
  const h=harness();const result=await h.tool.execute({workflow:{'1':{class_type:'A',inputs:{}},'2':{class_type:'B',inputs:{image:['1','0']}}},validate_only:true},h.exec);
  assert.equal(result.status,'blocked');assert.equal(result.issues[0].code,'WORKFLOW_INVALID');assert.equal(result.retry_identical,false);
  assert.match(result.submission_blockers.join(' '),/numeric|integer/);assert.equal(h.requests.length,0);
});

test('Comfy schema rejection is distinguished from an accepted job and has no unload',async()=>{
  const h=harness({rejectComfy:true});const result=await h.tool.execute(boundArgs(),h.exec);
  assert.equal(result.status,'blocked');assert.equal(result.issues[0].code,'COMFY_REJECTED');
  assert.equal(result.retry_identical,false);assert.equal(result.prompt_id,undefined);assert.equal(h.concluded,0);
  assert.equal(h.requests.some(r=>r.url.endsWith('/api/models/unload')),false);
});

test('standalone generic workflows keep native coding submission without a Director proposal',async()=>{
  const h=harness({withCard:false});
  const result=await h.tool.execute({workflow:{'1':{class_type:'StandaloneImageNode',inputs:{}}},validate_only:true},h.exec);
  assert.equal(result.submission_ready,true);assert.equal(h.requests.length,0);
  const text=h.tool.output.render({},result)[0].text;
  assert.match(text,/partial|limited|runtime/i);
});

test('validation renders incomplete interface coverage to the model',()=>{
  const h=harness({withCard:false});
  const text=h.tool.output.render({}, {validated:true,submission_ready:true,submission_blockers:[],continuity:{mode:'none',explanation:'Independent.'},workflow_preflight:{complete:false,warnings:['Installed interface unavailable for custom node'],limitations:['Runtime not checked']}})[0].text;
  assert.match(text,/incomplete/i);assert.match(text,/Installed interface unavailable/);assert.match(text,/Runtime not checked/);
});

test('user revision during latent verification prevents queueing the previously approved clip',async()=>{
  const workflow=graph(),workflowPath=join(tmpdir(),'director-race-workflow.json');
  workflow['6'].inputs.length=73; // 73 raw - 17 context = the approved 56 delivered frames.
  workflow['26']={class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['6',0],latent:['6',1],context_latent:['27',0],context_length:'17'}};
  workflow['27']={class_type:'MiniMaxH3MotionContextLoadLatent',inputs:{latent_path:'chain',clip_index:1}};
  workflow['8']={class_type:'BasicGuider',inputs:{conditioning:['26',0]}};
  workflow['11']={class_type:'SamplerCustomAdvanced',inputs:{guider:['8',0],latent_image:['6',1]}};
  workflow['12']={class_type:'VAEDecode',inputs:{samples:['11',0]}};
  workflow['28']={class_type:'MiniMaxH3MotionContextTrim',inputs:{images:['12',0],trim_frames:['26',1],fps:24}};
  workflow['13']={class_type:'CreateVideo',inputs:{images:['28',0]}};
  workflow['14']={class_type:'SaveVideo',inputs:{video:['13',0],filename_prefix:'chain/revised'}};
  const h=harness({workflowPath,workflow,onLatentCheck:events=>events.push({seq:6,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'把镜头改成近景'}]}})});
  const args=boundArgs();delete args.workflow;args.workflow_path=workflowPath;
  args.continuity_requirement='sampler_latent';
  const result=await h.tool.execute(args,h.exec);
  assert.equal(h.requests.some(r=>r.url.endsWith('/h3_motion_context/slot_exists')),true,JSON.stringify(result));
  assert.equal(h.requests.some(r=>r.url.endsWith('/prompt')),false);
  assert.equal(result.status,'blocked');assert.equal(result.issues[0].code,'REVIEW_REQUIRED');assert.equal(h.concluded,0);
});

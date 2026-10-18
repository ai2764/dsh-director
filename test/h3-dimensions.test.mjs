import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {apply,createSubmitComfyVideo} from '../src/submit-comfy-video.mjs';

const source=join(tmpdir(),'dsh-director-synthetic','actor.png').replaceAll('\\','/'),bytes=Buffer.from('controlled reference bytes');
const prompt={subject_definitions:'<Picture 1> defines Alex identity and cardigan.',summary:'Alex waves.',retention_analysis:'Preserve the identity and cardigan of <Picture 1>.',detailed_description:'[Shot 1] Alex from <Picture 1> gives one small wave, without speech.',overall_soundscape:'Quiet room tone.',non_diegetic_music:'N/A'};
const review={references:[{picture_index:1,image:'actor.png',source_path:source,observation:'One woman with long dark hair in a cream cardigan.',responsibility:'Identity and visible wardrobe.'}],dialogue:[]};
// Synthetic API graph, not a runnable bundled production workflow.
function makeGraph(dimensions={}) {
  return {
    '1': {class_type:'LoadImage',inputs:{image:'actor.png'}},
    '6': {class_type:'MiniMaxH3ReferenceToVideo',inputs:{prompt:Object.entries(prompt).map(([k,v])=>`${k}: ${v}`).join('\n'),'ref_images.ref_image_0':['1',0],width:1280,height:704,length:217,...dimensions}},
    '10': {class_type:'BasicScheduler',inputs:{steps:3,scheduler:'synthetic'}},
  };
}
function harness(){
  const requests=[];let concluded=0;
  const events=[
    {seq:0,type:'tool/call',data:{callId:'read-1',name:'read_image',arguments:JSON.stringify({file_path:source})}},
    {seq:1,type:'tool/result',data:{message:{content:[{type:'tool-result',toolCallId:'read-1',content:[{type:'text',text:`<path>${source}</path>`},{type:'image',attachment:{attachmentId:'image-1'}}]}]}}},
    {seq:2,type:'assistant/message',data:{message:{source:{kind:'model'},content:[]}}},
  ];
  const submit=createSubmitComfyVideo({readFileImpl:(path,...args)=>path===source?bytes:readFile(path,...args),sleep:async()=>{},fetchImpl:async(url,init={})=>{
    requests.push({url:String(url),init});
    if(String(url).endsWith('/object_info/LoadImage'))return Response.json({LoadImage:{input:{required:{image:[['actor.png']]}}}});
    if(String(url).includes('/view?'))return new Response(bytes);
    if(String(url).endsWith('/prompt'))return Response.json({prompt_id:'portrait-job'});
    if(String(url).endsWith('/api/models/unload')||String(url).endsWith('/running'))return Response.json({});
    throw Error(`Unexpected request ${url}`);
  }});
  return {submit,requests,exec:{agent:{session:{snapshotEvents:()=>events,surface:{nodes:[1,2]}}},concludeTurn(){concluded++;}},get concluded(){return concluded;}};
}
function tools(){const definitions=[];apply({tools:{register(d){definitions.push(d);}},jobs:{start(){}},effect:f=>f()});return definitions;}

test('real terminal submit rejects an unmet costume-reference request before POST or unload',async()=>{
  const h=harness(),events=h.exec.agent.session.snapshotEvents();
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const card=version=>({kind:'director-media',proposal:{version,shots:[{clip_id:'c1',reference_numbers:[1]}]},items:[{sha256,type:'image'}]});
  const show=(seq,version)=>[{seq,type:'tool/call',data:{callId:'card-'+seq,name:'director_show_media',arguments:'{}'}},{seq:seq+1,type:'tool/result',data:{message:{role:'tool',toolCallId:'card-'+seq,isError:false,content:[{type:'text',text:JSON.stringify(card(version))}]}}}];
  events.push(...show(3,'old'),{seq:5,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'白色紧身衣加入ref'}]}},...show(6,'white'),{seq:8,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'ok'}]}});
  await assert.rejects(h.submit({workflow:makeGraph(),h3_review:review},h.exec),/reference.*pending/i);
  assert.equal(h.requests.some(r=>/\/prompt$|\/api\/models\/unload$/.test(r.url)),false);
  assert.equal(h.concluded,0);
});

test('submission rechecks a user revision arriving while async visual preflight runs',async()=>{
  const h=harness(),events=h.exec.agent.session.snapshotEvents(),sha256=createHash('sha256').update(bytes).digest('hex');
  const value={kind:'director-media',card_id:'async-card',proposal:{version:'v1',clip_dimensions:[{clip_id:'c1',width:1280,height:704}],shots:[{clip_id:'c1',reference_numbers:[1]}]},items:[{sha256,type:'image'}]};
  events.push({seq:3,type:'tool/call',data:{callId:'async-card',name:'director_show_media',arguments:'{}'}},{seq:4,type:'tool/result',data:{message:{role:'tool',toolCallId:'async-card',isError:false,content:[{type:'text',text:JSON.stringify(value)}]}}},{seq:5,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'ok'}]}});
  let reads=0;h.exec.agent.session.snapshotEvents=()=>{if(++reads===2)events.push({seq:6,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'Change the outfit to red'}]}});return events;};
  await assert.rejects(h.submit({workflow:makeGraph(),h3_review:review},h.exec),/confirm/);
  assert.equal(h.requests.some(r=>/\/prompt$|\/api\/models\/unload$/.test(r.url)),false);
});

test('approved output size blocks an H3 graph with a different canvas before ComfyUI POST',async()=>{
  const h=harness(),events=h.exec.agent.session.snapshotEvents(),sha256=createHash('sha256').update(bytes).digest('hex');
  const card={kind:'director-media',proposal:{version:'size-v1',clip_dimensions:[{clip_id:'c1',width:1344,height:768}],shots:[{clip_id:'c1',reference_numbers:[1]}]},items:[{sha256,type:'image'}]};
  events.push({seq:3,type:'tool/call',data:{callId:'size-card',name:'director_show_media',arguments:'{}'}},{seq:4,type:'tool/result',data:{message:{role:'tool',toolCallId:'size-card',isError:false,content:[{type:'text',text:JSON.stringify(card)}]}}},{seq:5,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'Confirm size-v1'}]}});
  const checked=await h.submit({workflow:makeGraph(),h3_review:review,validate_only:true},h.exec);
  assert.equal(checked.submission_ready,false);
  assert.match(checked.submission_blockers.join(' '),/1344.*768|dimension|size/i);
  const matching=await h.submit({workflow:makeGraph({width:1344,height:768}),h3_review:review,validate_only:true},h.exec);
  assert.equal(matching.submission_ready,true);
  await assert.rejects(h.submit({workflow:makeGraph(),h3_review:review},h.exec),/1344.*768|dimension|size/i);
  assert.equal(h.requests.some(r=>/\/prompt$|\/api\/models\/unload$/.test(r.url)),false);
});

test('caller-selected portrait graph is posted without replacing its sampler settings',async()=>{
  const h=harness(),result=await h.submit({workflow:makeGraph({width:704,height:1280}),h3_review:review},h.exec);
  const graph=JSON.parse(h.requests.find(r=>r.url.endsWith('/prompt')).init.body).prompt;
  assert.equal(graph['6'].inputs.width,704);assert.equal(graph['6'].inputs.height,1280);
  assert.equal(graph['10'].inputs.steps,3);assert.equal(graph['6'].inputs.length,217);
  assert.deepEqual(result.h3_generation,{width:704,height:1280,orientation:'portrait',length:217});
  assert.equal(result.llm_unloaded,true);assert.equal(h.concluded,1);
  assert.match(tools()[0].output.render({},result)[0].text,/704.*1280.*portrait/);
});

test('preflight reports effective default and square canvas without queueing or unloading',async()=>{
  for(const [dimensions,want] of [[{}, {width:1280,height:704,orientation:'landscape',length:217}],[{width:768,height:768},{width:768,height:768,orientation:'square',length:217}]]){
    const h=harness(),result=await h.submit({workflow:makeGraph(dimensions),h3_review:review,validate_only:true},h.exec);
    assert.deepEqual(result.h3_generation,want);
    assert.equal(h.requests.some(r=>/\/prompt$|\/api\/models\/unload$/.test(r.url)),false);assert.equal(h.concluded,0);
    assert.match(tools()[0].output.render({},result)[0].text,new RegExp(`${want.width}.*${want.height}.*${want.orientation}`));
  }
});

test('existing H3 graph reports its own portrait settings without rewriting the workflow',async()=>{
  const g={'1':{class_type:'LoadImage',inputs:{image:'actor.png'}},'6':{class_type:'MiniMaxH3ReferenceToVideo',inputs:{prompt:Object.entries(prompt).map(([k,v])=>`${k}: ${v}`).join('\n'),'ref_images.ref_image_0':['1',0],width:768,height:1344,length:124}}};
  const h=harness(),before=structuredClone(g),result=await h.submit({workflow:g,h3_review:review},h.exec);
  assert.deepEqual(JSON.parse(h.requests.find(r=>r.url.endsWith('/prompt')).init.body).prompt,before);
  assert.deepEqual(result.h3_generation,{width:768,height:1344,orientation:'portrait',length:124});
});

test('linked canvas sizes remain explicit unresolved links rather than falsely reported dimensions',async()=>{
  const g={'1':{class_type:'LoadImage',inputs:{image:'actor.png'}},'6':{class_type:'MiniMaxH3ReferenceToVideo',inputs:{prompt:Object.entries(prompt).map(([k,v])=>`${k}: ${v}`).join('\n'),'ref_images.ref_image_0':['1',0],width:['9',0],height:['9',1],length:124}},'9':{class_type:'ResolutionSelector',inputs:{}}};
  const h=harness(),result=await h.submit({workflow:g,h3_review:review,validate_only:true},h.exec);
  assert.deepEqual(result.h3_generation,{width:['9',0],height:['9',1],orientation:'dynamic',length:124});
  assert.match(tools()[0].output.render({},result)[0].text,/dynamic|linked|unresolved/i);
});

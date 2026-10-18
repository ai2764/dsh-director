import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkflowTool,inspectComfyGraph} from '../src/workflow-discovery.mjs';

const videoGraph={
  '6':{class_type:'MiniMaxH3ReferenceToVideo',inputs:{prompt:'C3',length:217}},
  '8':{class_type:'BasicGuider',inputs:{conditioning:['26',0]}},
  '11':{class_type:'SamplerCustomAdvanced',inputs:{guider:['8',0],latent_image:['6',1]}},
  '26':{class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['6',0],latent:['6',1],context_length:'22',context_frames:['31',2],context_audio:['30',2]}},
  '30':{class_type:'VHS_LoadVideo',inputs:{video:'C2.mp4'}},
  '31':{class_type:'VHS_SplitImages',inputs:{images:['30',0],split_index:-22}},
  '27':{class_type:'MiniMaxH3MotionContextTrim',inputs:{trim_frames:['26',1]}},
};

test('C3 style graph reports decoded video context and rejects a latent continuation claim',()=>{
  const result=inspectComfyGraph(videoGraph);
  assert.equal(result.continuity.mode,'video_frames');
  assert.equal(result.continuity.source,'C2.mp4');
  assert.equal(result.continuity.latent_saved_for_next,false);
  assert.deepEqual(result.generation_timing,{requested_frames:217,aligned_frames:226,pinned_frames:22,delivered_frames:204,fps:24,delivered_seconds:8.5});
  assert.equal(result.continuity.seam_anchor,undefined);
  assert.match(result.continuity.explanation,/not.*latent|decoded.*video/i);
  assert.match(result.continuity.explanation,/sampler.*context_latent|context_latent.*sampler/i);
  assert.deepEqual(result.continuity.wiring,{
    context_input:{node:'26',port:'context_frames',from:{node:'31',output:2,type:'VHS_SplitImages'}},
    source_input:{node:'31',port:'images',from:{node:'30',output:0,type:'VHS_LoadVideo'}},
    conditioning_consumers:[{node:'8',port:'conditioning',type:'BasicGuider'}],
    trim_consumers:[{node:'27',port:'trim_frames',type:'MiniMaxH3MotionContextTrim'}],
  });
});

test('legacy last-frame guide graphs remain inspectable without advertising a seam-anchor technique',()=>{
  const graph={...videoGraph,
    '26':{...videoGraph['26'],inputs:{...videoGraph['26'].inputs,conditioning:['33',0]}},
    '32':{class_type:'VHS_SplitImages',inputs:{images:['30',0],split_index:-1}},
    '33':{class_type:'MiniMaxH3AddGuide',inputs:{positive:['6',0],latent:['6',1],vae:['5',0],image:['32',2],frame_idx:22}},
  };
  assert.equal(inspectComfyGraph(graph).continuity.seam_anchor,undefined);
  assert.match(inspectComfyGraph(graph).continuity.explanation,/multi-frame/);
  assert.doesNotMatch(inspectComfyGraph(graph).continuity.explanation,/no longer supported/);
  graph['33'].inputs.frame_idx=0;
  assert.equal(inspectComfyGraph(graph).continuity.seam_anchor,undefined);
});

test('saved prior sampler latent is distinguished from first clip no load',()=>{
  const graph={...videoGraph,
    '26':{class_type:'MiniMaxH3MotionContext',inputs:{conditioning:['6',0],latent:['6',1],context_latent:['40',0]}},
    '40':{class_type:'MiniMaxH3MotionContextLoadLatent',inputs:{latent_path:'chain',clip_index:2}},
    '41':{class_type:'MiniMaxH3MotionContextSaveLatent',inputs:{latent:['11',0],filename_prefix:'chain/clip',clip_index:3}},
  };
  const checked=inspectComfyGraph(graph).continuity;
  assert.equal(checked.mode,'sampler_latent');
  assert.equal(checked.source,'chain (clip 2)');
  assert.equal(checked.latent_saved_for_next,true);
  assert.deepEqual(checked.latent_slots,{load_clip_index:2,save_clip_index:3,save_slot_stable:true,sequential:true});
  assert.deepEqual(checked.wiring.context_input,{node:'26',port:'context_latent',from:{node:'40',output:0,type:'MiniMaxH3MotionContextLoadLatent'}});
  graph['40'].inputs.clip_index=0;
  assert.equal(inspectComfyGraph(graph).continuity.mode,'none');
});

test('a fresh H3 clip can save its sampler output without a MotionContext node',()=>{
  const graph={
    '6':{class_type:'MiniMaxH3ReferenceToVideo',inputs:{length:192}},
    '11':{class_type:'SamplerCustomAdvanced',inputs:{latent_image:['6',1]}},
    '41':{class_type:'MiniMaxH3MotionContextSaveLatent',inputs:{latent:['11',0],filename_prefix:'test/clip',clip_index:1}},
  };
  const checked=inspectComfyGraph(graph).continuity;
  assert.equal(checked.mode,'none');
  assert.equal(checked.latent_saved_for_next,true);
  assert.deepEqual(checked.latent_slots,{load_clip_index:null,save_clip_index:1,save_slot_stable:true,sequential:null});
});

test('custom context and loader are reported as unverified latent with traceable sockets',()=>{
  const graph={
    '1':{class_type:'CustomContext',inputs:{conditioning:['2',0],context_latent:['3',0]}},
    '2':{class_type:'Prompt',inputs:{}},
    '3':{class_type:'CustomSavedLatentLoader',inputs:{path:'C:/film/C4.safetensors'}},
  };
  const result=inspectComfyGraph(graph).continuity;
  assert.equal(result.mode,'unverified_latent');
  assert.deepEqual(result.wiring.context_input.from,{node:'3',output:0,type:'CustomSavedLatentLoader'});
  assert.match(result.explanation,/schema|verify|inspect/i);
});

test('workflow tool lists ComfyUI UI workflows, inspects API graph, and fetches one node schema',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'director-workflow-'));
  const path=join(folder,'C3.json');
  await writeFile(path,JSON.stringify({prompt:videoGraph}));
  const seen=[];
  const tool=createWorkflowTool({workspaceRoot:folder,fetchImpl:async url=>{
    seen.push(url);
    if(url.endsWith('/userdata?dir=workflows&recurse=true'))return {ok:true,json:async()=>['H3 Context.json','Qwen Layout.json']};
    if(url.endsWith('/object_info/MiniMaxH3MotionContext'))return {ok:true,json:async()=>({MiniMaxH3MotionContext:{input:{required:{conditioning:['CONDITIONING']},optional:{context_latent:['LATENT'],context_frames:['IMAGE']}}}})};
    throw new Error(`unexpected URL ${url}`);
  }});
  const listed=await tool.execute({action:'list'});
  assert.deepEqual(listed.workflows,['H3 Context.json','Qwen Layout.json']);
  assert.deepEqual(listed.workspace_candidates,[{name:'C3.json',workflow_path:path,format:'api',node_count:7,continuity_mode:'video_frames'}]);
  assert.match(listed.next_step,/inspect.*workflow_path/i);
  assert.match(listed.next_step,/shot3|clip3/i);
  assert.match(listed.next_step,/rg --files/i);
  const inspected=await tool.execute({action:'inspect',workflow_path:path});
  assert.equal(inspected.continuity.mode,'video_frames');
  assert.equal(inspected.format,'api');
  const schema=await tool.execute({action:'schema',node_type:'MiniMaxH3MotionContext'});
  assert.deepEqual(schema.optional,{context_latent:'LATENT',context_frames:'IMAGE'});
  assert.equal(seen.length,2);
});

test('saved UI inspection gives the coding agent an exact local download URL',async()=>{
  const name='desktop-migrated/camera-lab/app/wan22_bernini_i2v.ui.json';
  const expected=`http://127.0.0.1:8188/userdata/${encodeURIComponent(`workflows/${name}`)}`;
  const seen=[];
  const tool=createWorkflowTool({fetchImpl:async url=>{
    seen.push(url);
    if(url.endsWith('/userdata?dir=workflows&recurse=true'))return {ok:true,json:async()=>[name]};
    if(url===expected)return {ok:true,json:async()=>({nodes:[{type:'LoadImage',id:1}],links:[]})};
    throw Error(`unexpected URL ${url}`);
  }});
  const inspected=await tool.execute({action:'inspect',workflow_name:name});
  assert.equal(inspected.format,'ui');
  assert.equal(inspected.download_url,expected);
  assert.match(inspected.next_step,/download.*native.*coding.*API/i);
  assert.deepEqual(seen.slice(0,2),[`http://127.0.0.1:8188/userdata?dir=workflows&recurse=true`,expected]);
});

test('installed node schema preserves latent slot semantics and socket tooltips',async()=>{
  const info={MiniMaxH3MotionContextLoadLatent:{
    description:'Load a saved sampler latent for context_latent only.',
    input:{required:{latent_path:['STRING',{tooltip:'Saved file or output folder.'}],clip_index:['INT',{default:0,min:0,tooltip:'0 never reads a file. Clip 2 loads saved clip 1 with index 1.'}]}},
    output:['LATENT'],output_name:['LATENT'],
  }};
  const tool=createWorkflowTool({fetchImpl:async()=>({ok:true,json:async()=>info})});
  const schema=await tool.execute({action:'schema',node_type:'MiniMaxH3MotionContextLoadLatent'});
  assert.equal(schema.required.clip_index,'INT');
  assert.deepEqual(schema.required_details.clip_index,{type:'INT',default:0,min:0,tooltip:'0 never reads a file. Clip 2 loads saved clip 1 with index 1.'});
  assert.equal(schema.description,info.MiniMaxH3MotionContextLoadLatent.description);
  assert.deepEqual(schema.output_names,['LATENT']);
  assert.equal(schema.file_input_guidance,undefined);
});

test('VHS video schema explains annotated output paths and API staging without guessing server directories',async()=>{
  const choices=['staged-clip.mp4'];
  const seen=[];
  const tool=createWorkflowTool({comfyBaseUrl:'http://comfy.example:8188',fetchImpl:async url=>{
    seen.push(url);
    return {ok:true,json:async()=>({VHS_LoadVideo:{input:{required:{video:[choices]}}}})};
  }});
  const schema=await tool.execute({action:'schema',node_type:'VHS_LoadVideo'});
  assert.deepEqual(schema.required.video,choices);
  assert.deepEqual(schema.required_details.video,{type:choices});
  const guidance=schema.file_input_guidance;
  assert.equal(guidance.input,'video');
  assert.match(guidance.schema_format,/input\.required\.video\[0\]/);
  assert.match(guidance.schema_format,/required\.video/);
  assert.match(guidance.schema_format,/\.value.*does not exist/);
  assert.equal(guidance.dropdown_exhaustive,false);
  assert.match(guidance.path_resolution,/\[output\]/);
  assert.match(guidance.path_resolution,/default.*input/i);
  assert.deepEqual(guidance.verify,{method:'HEAD',url:'http://comfy.example:8188/view',query_fields:['filename','subfolder','type'],note:'Split the relative video path into filename and subfolder; type is input by default, or output/temp from the annotation. HTTP 200 verifies file availability, not successful video decoding.'});
  assert.equal(guidance.stage.method,'POST');
  assert.equal(guidance.stage.url,'http://comfy.example:8188/upload/image');
  assert.equal(guidance.stage.file_field,'image');
  assert.equal(guidance.stage.type,'input');
  assert.match(guidance.stage.source,/exact.*source.*path/i);
  assert.match(guidance.stage.result,/name.*subfolder.*type/);
  assert.match(guidance.directory_guidance,/Do not infer.*Python.*environment/i);
  assert.deepEqual(seen,['http://comfy.example:8188/object_info/VHS_LoadVideo']);
});

test('list recovers submitted workflow paths from this session after context compaction',async()=>{
  const tool=createWorkflowTool({fetchImpl:async()=>({ok:true,json:async()=>['Saved UI.json']})});
  const events=[
    {type:'tool/call',data:{name:'submit_comfy_job',arguments:JSON.stringify({workflow_path:'C:/film/C2.json'})}},
    {type:'tool/call',data:{name:'submit_comfy_job',arguments:JSON.stringify({workflow_path:'C:/film/C3.json',h3_prompt:{summary:'new'}})}},
  ];
  const listed=await tool.execute({action:'list'},{agent:{session:{snapshotEvents:()=>events}}});
  assert.deepEqual(listed.recent_workflows,['C:/film/C3.json','C:/film/C2.json']);
  assert.match(listed.next_step,/recent_workflows/);
});

test('list also recovers inspected workflow paths before a first submission',async()=>{
  const tool=createWorkflowTool({fetchImpl:async()=>({ok:true,json:async()=>[]})});
  const events=[
    {type:'tool/call',data:{name:'director_workflows',arguments:JSON.stringify({action:'inspect',workflow_path:'C:/film/C4.json'})}},
    {type:'tool/call',data:{name:'director_workflows',arguments:JSON.stringify({action:'schema',node_type:'MiniMaxH3MotionContext'})}},
    {type:'tool/call',data:{name:'director_workflows',arguments:JSON.stringify({action:'inspect',workflow_path:'C:/film/C5.json'})}},
  ];
  const listed=await tool.execute({action:'list'},{agent:{session:{snapshotEvents:()=>events}}});
  assert.deepEqual(listed.recent_inspections,['C:/film/C5.json','C:/film/C4.json']);
});

test('ComfyUI list outage leaves local workflow candidates available',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'director-offline-workflow-'));
  const path=join(folder,'shot3.json');
  await writeFile(path,JSON.stringify(videoGraph));
  const tool=createWorkflowTool({workspaceRoot:folder,fetchImpl:async()=>{throw Error('ComfyUI offline');}});
  const listed=await tool.execute({action:'list'});
  assert.deepEqual(listed.workflows,[]);
  assert.match(listed.comfy_error,/offline/);
  assert.deepEqual(listed.workspace_candidates,[{name:'shot3.json',workflow_path:path,format:'api',node_count:7,continuity_mode:'video_frames'}]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkflowPreflight} from '../src/workflow-preflight.mjs';

// The shape of the installed /object_info responses. Defaults describe UI
// widgets; Comfy still requires their values in the submitted API graph.
const schemas={
  MiniMaxH3MotionContext:{input:{required:{conditioning:['CONDITIONING'],vae:['VAE'],latent:['LATENT'],context_length:[['22','5','39','56'],{default:'22'}],audio_context_length:['INT',{default:24}]},optional:{context_frames:['IMAGE'],context_latent:['LATENT']}}},
  VHS_LoadVideo:{input:{required:{video:[['previous.mp4','another.mp4']],force_rate:['FLOAT',{default:0}],custom_width:['INT',{default:0}],custom_height:['INT',{default:0}],frame_load_cap:['INT',{default:0}],skip_first_frames:['INT',{default:0}],select_every_nth:['INT',{default:1}]}}},
};
const motionInputs=()=>({conditioning:['6',0],vae:['5',0],latent:['6',1],context_length:'22',audio_context_length:24});
const videoInputs=()=>({video:'previous.mp4',force_rate:0,custom_width:0,custom_height:0,frame_load_cap:0,skip_first_frames:0,select_every_nth:1});
const workflow=()=>({
  '5':{class_type:'VAELoader',inputs:{vae_name:'h3.safetensors'}},
  '6':{class_type:'MiniMaxH3ReferenceToVideo',inputs:{}},
  '8':{class_type:'BasicGuider',inputs:{conditioning:['30',0]}},
  '11':{class_type:'SamplerCustomAdvanced',inputs:{guider:['8',0],latent_image:['30',1]}},
  '30':{class_type:'MiniMaxH3MotionContext',inputs:motionInputs()},
});

test('blocks the observed MotionContext -> sampler -> guider dependency cycle',()=>{
  const graph=workflow();graph['30'].inputs.latent=['11',0];
  const result=validateWorkflowPreflight(graph,schemas);
  assert.equal(result.valid,false);
  assert.equal(result.issues.filter(x=>/dependency cycle/i.test(x)).length,1);
  const issue=result.issues.join('\n');
  for(const expected of ['30','11','8','MiniMaxH3MotionContext','SamplerCustomAdvanced','BasicGuider']) assert.ok(issue.includes(expected),expected);
});

test('blocks the attempted repair that deletes the required initial latent',()=>{
  const graph=workflow();delete graph['30'].inputs.latent;
  const result=validateWorkflowPreflight(graph,schemas);
  assert.equal(result.valid,false);
  assert.match(result.issues.join('\n'),/node 30.*MiniMaxH3MotionContext.*required input.*latent/i);
});

test('restoring upstream initial latent validates without creating a sampler loop',()=>{
  const graph=workflow(),before=structuredClone(graph);
  const result=validateWorkflowPreflight(graph,schemas);
  assert.equal(result.valid,true);assert.deepEqual(result.issues,[]);
  assert.deepEqual(graph,before);
  assert.deepEqual(result.coverage.checked_node_types,['MiniMaxH3MotionContext']);
  assert.ok(result.coverage.unavailable_node_types.includes('BasicGuider'));
});

test('missing required widget remains an issue despite a schema default; optional inputs remain optional',()=>{
  const graph=workflow();delete graph['30'].inputs.audio_context_length;
  const result=validateWorkflowPreflight(graph,schemas);
  assert.equal(result.issues.length,1);
  assert.match(result.issues[0],/audio_context_length/);
});

test('reports absent VHS dropdown value without pretending custom file validation has failed',()=>{
  const graph={'40':{class_type:'VHS_LoadVideo',inputs:{...videoInputs(),video:'minimax_h3/se_guniang_s5_beach_run_720p_00001_.mp4'}}};
  const result=validateWorkflowPreflight(graph,schemas);
  assert.equal(result.valid,true);assert.equal(result.issues.length,0);
  assert.match(result.warnings.join('\n'),/node 40.*video.*minimax_h3/);
  assert.match(result.warnings.join('\n'),/not.*advertised.*choice/i);
  assert.ok(result.coverage.limitations.some(x=>/custom.*validat/i.test(x)));
});

test('valid VHS choice has no dropdown warning and linked dynamic video is not compared to filenames',()=>{
  for(const video of ['previous.mp4',['path-source',0]]){
    const graph={'40':{class_type:'VHS_LoadVideo',inputs:{...videoInputs(),video}},'path-source':{class_type:'RuntimeString',inputs:{}}};
    const result=validateWorkflowPreflight(graph,schemas);
    assert.equal(result.valid,true);assert.deepEqual(result.warnings,[]);
  }
});

test('unknown custom schema does not invent required inputs or reject its interface',()=>{
  const result=validateWorkflowPreflight({'custom-id':{class_type:'UserDefinedWorkflow',inputs:{settings:{nested:['custom-id',0]},numbers:[0,1],literal:{__value__:['custom-id',0]}}}});
  assert.equal(result.valid,true);assert.deepEqual(result.issues,[]);
  assert.deepEqual(result.coverage.unavailable_node_types,['UserDefinedWorkflow']);
});

test('only direct string node ID and numeric output index arrays create dependency edges',()=>{
  const graph={'30':{class_type:'Custom',inputs:{numeric:[30,0],strings:['30','0'],nested:[['30',0]],wrapped:{__value__:['30',0]},many:['30',0,1]}}};
  assert.equal(validateWorkflowPreflight(graph).valid,true);
  graph['30'].inputs.real=['30',0];
  assert.match(validateWorkflowPreflight(graph).issues.join('\n'),/dependency cycle/);
});

test('rawLink inputs do not create evaluation dependencies',()=>{
  const graph={a:{class_type:'FlowControl',inputs:{raw:['b',0]}},b:{class_type:'FlowControl',inputs:{raw:['a',0]}}};
  const rawSchemas={FlowControl:{input:{required:{raw:['FLOW_CONTROL',{rawLink:true}]}}}};
  assert.equal(validateWorkflowPreflight(graph,rawSchemas).valid,true);
});

test('dynamic schema groups are reported as unverified instead of missing named sockets',()=>{
  const graph={'dynamic-node':{class_type:'Dynamic',inputs:{'refs.image_0':['source',0]}}};
  const result=validateWorkflowPreflight(graph,{Dynamic:{input:{required:{refs:['COMFY_AUTOGROW_V3',{template:{min:0,max:4}}],choice:['COMFY_DYNAMICCOMBO_V3',{options:[]}]}}}});
  assert.equal(result.valid,true);assert.equal(result.issues.length,0);
  assert.equal(result.coverage.skipped_inputs.length,2);
});

test('COMBO schemas and wrapped multiselect values are checked as literals without false cycles',()=>{
  const graph={'pick':{class_type:'Select',inputs:{choice:{__value__:['a','c']}}}};
  const result=validateWorkflowPreflight(graph,{Select:{input:{required:{choice:['COMBO',{options:['a','b'],multiselect:true}]}}}});
  assert.equal(result.valid,true);assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/"c"/);
});

test('multiple disjoint cycles are reported deterministically',()=>{
  const graph={a:{class_type:'X',inputs:{x:['b',0]}},b:{class_type:'X',inputs:{x:['a',0]}},c:{class_type:'X',inputs:{x:['c',0]}}};
  const first=validateWorkflowPreflight(graph),second=validateWorkflowPreflight(graph);
  assert.equal(first.valid,false);assert.equal(first.issues.length,2);
  assert.deepEqual(first,second);
});

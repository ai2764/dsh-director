import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProposal} from '../src/shot-proposal.mjs';
import {assertProposalSubmission} from '../src/proposal-state.mjs';

const source='C:/film/C4_latent.safetensors (clip 1)';
const path='C:/film/C5.json';
const shot={shot_id:'S5',clip_id:'C5',duration_seconds:5,content:'Continue from C4.',dialogue:'',reference_numbers:[1]};
const item={id:'a'.repeat(43),type:'image',sha256:'a'.repeat(64),mime:'image/png',filename:'actor.png',url:'/director-media/actor?session=s'};
const proposal={version:'v1',shots:[shot],clip_references:[{clip_id:'C5',reference_numbers:[1]}],clip_dimensions:[{clip_id:'C5',width:1280,height:704}],clip_workflows:[{clip_id:'C5',workflow_path:path,continuity_mode:'sampler_latent',continuity_source:source}]};
const card=p=>({seq:1,kind:'proposal',value:{kind:'director-media',version:1,session_id:'s',items:[item],proposal:p}});
const approved={seq:2,kind:'user',text:'Confirm v1'};
const generation={width:1280,height:704,timing:{delivered_frames:120,fps:24}};
const workflow={path,continuity:{mode:'sampler_latent',source}};

test('review card preserves one verified workflow handoff per clip',()=>{
  assert.deepEqual(validateProposal(proposal,1,[item]).clip_workflows,proposal.clip_workflows);
  for(const clip_workflows of [[],[{...proposal.clip_workflows[0],clip_id:'C4'}],[...proposal.clip_workflows,...proposal.clip_workflows],[{...proposal.clip_workflows[0],continuity_mode:'unknown'}],[{...proposal.clip_workflows[0],workflow_path:'relative.json'}]]){
    assert.throws(()=>validateProposal({...proposal,clip_workflows},1,[item]),/workflow|continuity|clip/i);
  }
});

test('dependent H3 submission records template and execution paths while enforcing approved route and source',()=>{
  const entries=[card(proposal),approved],refs=[{sha256:item.sha256}];
  assert.doesNotThrow(()=>assertProposalSubmission(entries,refs,generation,workflow));
  assert.throws(()=>assertProposalSubmission([card({...proposal,clip_workflows:undefined}),approved],refs,generation,workflow),/workflow|continuity.*card/i);
  const copy=assertProposalSubmission(entries,refs,generation,{...workflow,path:'C:/film/other.json'});
  assert.equal(copy.reviewed_workflow_path,path);
  assert.equal(copy.submitted_workflow_path,'C:/film/other.json');
  assert.throws(()=>assertProposalSubmission(entries,refs,generation,{...workflow,continuity:{...workflow.continuity,mode:'video_frames'}}),/continuity.*mode|sampler_latent/i);
  assert.throws(()=>assertProposalSubmission(entries,refs,generation,{...workflow,continuity:{...workflow.continuity,source:'C:/film/other.safetensors (clip 1)'}}),/continuity.*source|source.*match/i);
});

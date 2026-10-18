import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as state from '../src/proposal-state.mjs';
import {createMediaTool,createEditReviewTool} from '../src/media-tool.mjs';
import {createMediaStore} from '../src/media-store.mjs';
import {localFs} from './harness.mjs';

const sha='a'.repeat(64);
const card=()=>({kind:'director-media',version:1,card_id:'card-1',session_id:'s',title:'Review',items:[{type:'image',sha256:sha}],proposal:{version:'v1',shots:[{shot_id:'s1',clip_id:'c1',duration_seconds:5,content:'Cat waves.',dialogue:'Cat [English]: Hello.',reference_numbers:[1]}],clip_dimensions:[{clip_id:'c1',width:1280,height:704}],clip_workflows:[{clip_id:'c1',workflow_path:'C:/film/c1.json',continuity_mode:'sampler_latent',continuity_source:'C:/film/c0.safetensors'}]}});
const user=(seq,text)=>({seq,kind:'user',text});
const call=(seq,callId,name='director_show_media')=>({seq,type:'tool/call',data:{callId,name,arguments:{}}});
const result=(seq,callId,value)=>({seq,type:'tool/result',data:{message:{role:'tool',toolCallId:callId,source:{kind:'tool',callId},isError:false,content:[{type:'text',text:JSON.stringify(value)}]}}});
const userEvent=(seq,text)=>({seq,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text}]}});
const reviewed=value=>[{seq:1,kind:'proposal',value},user(2,'ok')];
const generation={width:1280,height:704,timing:{delivered_frames:120,fps:24}};
const workflow={path:'C:/film/c1.json',continuity:{mode:'sampler_latent',source:'C:/film/c0.safetensors'}};

test('synthetic Harness 0.2 approval envelope recognizes the displayed card and human ok',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/harness02-review-envelope.json',import.meta.url),'utf8'));
  const entries=state.entriesFromEvents([fixture.call,fixture.result,fixture.user]);
  assert.equal(entries.filter(entry=>entry.kind==='proposal').length,1);
  const review=state.proposalState(entries,'v3');
  assert.equal(review.status,'confirmed');
  assert.equal(review.approvedSeq,3);
  assert.deepEqual(review.pending,[]);
});

test('Harness 0.2 direct results and legacy wrappers recover the same approval without counting pruning replacements',()=>{
  const value=card(),events=[call(1,'show'),result(2,'show',value),userEvent(3,'ok'),result(9,'show',value)];
  const entries=state.entriesFromEvents(events);
  assert.equal(entries.filter(e=>e.kind==='proposal').length,1);
  assert.equal(state.proposalState(entries,'v1').status,'confirmed');
  const legacy=[call(1,'show'),{seq:2,type:'tool/result',data:{message:{content:[{type:'tool-result',toolCallId:'show',content:[{type:'text',text:JSON.stringify(value)}]}]}}},userEvent(3,'ok')];
  assert.deepEqual(state.entriesFromEvents(legacy),entries);
  const block={kind:'tool-result',seq:2,callId:'show',call:{name:'director_show_media'},content:events[1].data.message.content};
  const nodes=new Map([['show',{kind:'tool-call',data:{root:block}}],['user',{kind:'user',data:events[2].data}]]);
  nodes.get('user').data={...nodes.get('user').data,seq:3};
  assert.deepEqual(state.entriesFromChat({order:['show','user'],nodes}),entries);
});

test('card-shaped tool output requires a successful real director call in both event formats',()=>{
  const value=card();
  for(const format of ['direct','legacy'])for(const name of ['pwsh',undefined]){
    const output=result(2,'show',value);
    if(format==='legacy')output.data.message={content:[{type:'tool-result',toolCallId:'show',content:output.data.message.content}]};
    assert.equal(state.entriesFromEvents([...(name?[call(1,'show',name)]:[]),output]).length,0);
  }
  const failed=result(2,'show',value);failed.data.message.isError=true;
  assert.equal(state.entriesFromEvents([call(1,'show'),failed]).length,0);
});

test('natural confirmation and edit questions share clear host and card state semantics',()=>{
  for(const text of ['好，开始吧','确认，按这个生成','可以，按这个做','继续'])assert.equal(state.proposalState([...reviewed(card()),user(3,text)],'v1').status,'confirmed',text);
  for(const text of ['台词改成“快跑”，可以吗？','把镜头改成近景可以吗？','Can you change the dialogue to Run?'])assert.equal(state.proposalState([...reviewed(card()),user(3,text)],'v1').status,'changes_requested',text);
  const text=state.proposalConfirmationText(card());
  assert.equal(state.proposalState([{seq:1,kind:'proposal',value:card()},user(2,text)],'v1').status,'confirmed');
  const newer={...card(),card_id:'card-2',proposal:{...card().proposal,version:'v2'}};
  assert.notEqual(state.proposalState([{seq:1,kind:'proposal',value:newer},user(2,text)],'v2').status,'confirmed');
});

test('replaying an old or current card never changes the active approval',()=>{
  const value=card(),next={...card(),card_id:'card-2',proposal:{...card().proposal,version:'v2',shots:[{...card().proposal.shots[0],dialogue:'Bye.'}]}};
  const entries=[{seq:1,kind:'proposal',value},user(2,'ok'),{seq:3,kind:'proposal',value:{...value,replay:true}}];
  assert.equal(state.proposalState(entries,'v1',{seq:1,callId:'show'}).status,'confirmed');
  entries.push({seq:4,kind:'proposal',value:next},user(5,'ok'),{seq:6,kind:'proposal',value:{...value,replay:true}});
  assert.equal(state.proposalState(entries,'v2').status,'confirmed');
  assert.equal(state.proposalState(entries,'v1',{card_id:value.card_id}).status,'superseded');
});

test('bare confirmation after an old-card replay cannot approve a different current card',()=>{
  const value=card(),next={...card(),card_id:'card-2',proposal:{...card().proposal,version:'v2',shots:[{...card().proposal.shots[0],dialogue:'Bye.'}]}};
  const entries=[{seq:1,kind:'proposal',value},user(2,'ok'),{seq:3,kind:'proposal',value:next},{seq:4,kind:'proposal',value:{...value,replay:true}},user(5,'ok')];
  assert.equal(state.proposalState(entries,'v2').status,'awaiting_confirmation');
  entries.push(user(6,state.proposalConfirmationText(next)));
  assert.equal(state.proposalState(entries,'v2').status,'confirmed');
});

test('legacy repeated complete cards preserve their approved semantic identity across different card IDs',()=>{
  const original=card(),duplicate={...structuredClone(original),card_id:'old-duplicate-1'},again={...structuredClone(original),card_id:'old-duplicate-2'};
  const entries=[{seq:1,kind:'proposal',value:original},user(2,'ok'),{seq:3,kind:'proposal',value:duplicate},{seq:4,kind:'proposal',value:again}];
  for(const entry of entries.filter(entry=>entry.kind==='proposal')){
    const review=state.proposalState(entries,'v1',{seq:entry.seq,card_id:entry.value.card_id});
    assert.equal(review.status,'confirmed');
    assert.equal(review.approvedSeq,2);
  }
  assert.equal(state.latestProposal(entries).value.card_id,again.card_id);
  assert.doesNotThrow(()=>state.assertProposalSubmission(entries,[{sha256:sha}],generation,workflow,{card_id:again.card_id,clip_id:'c1',dialogue:[{speaker:'Cat',language:'English',text:'Hello.'}]}));
  const changed={...structuredClone(original),card_id:'real-change',proposal:{...original.proposal,shots:[{...original.proposal.shots[0],dialogue:'Bye.'}]}};
  entries.push({seq:5,kind:'proposal',value:changed});
  assert.equal(state.proposalState(entries,'v1',{card_id:original.card_id}).status,'superseded');
  assert.equal(state.proposalState(entries,'v1',{card_id:changed.card_id}).status,'awaiting_confirmation');
  entries.push({seq:6,kind:'proposal',value:{...structuredClone(original),card_id:'returned-plan'}});
  assert.equal(state.proposalState(entries,'v1').status,'awaiting_confirmation','returning to an earlier plan after a real edit requires fresh approval');
});

test('legacy path-only card revisions preserve creative approval but route and source changes require approval',()=>{
  const original=card(),copy=structuredClone(original);
  copy.card_id='compiled-card';copy.proposal.version='v2';copy.proposal.clip_workflows[0].workflow_path='C:/film/run/prepared.json';
  const entries=[{seq:1,kind:'proposal',value:original},user(2,'ok'),{seq:3,kind:'proposal',value:copy}];
  assert.equal(state.proposalState(entries,'v2').status,'confirmed');
  assert.equal(state.proposalState(entries,'v1',{card_id:original.card_id}).status,'confirmed');
  for(const change of [{continuity_mode:'video_frames'},{continuity_source:'C:/film/another.safetensors'}]){
    const revised=structuredClone(copy);revised.card_id='changed-card';Object.assign(revised.proposal.clip_workflows[0],change);
    assert.equal(state.proposalState([...entries,{seq:4,kind:'proposal',value:revised}],'v2').status,'awaiting_confirmation');
  }
});

test('submission binds one approved card and one clip including dialogue and continuity removal',()=>{
  const entries=reviewed(card()),refs=[{sha256:sha}],selection={card_id:'card-1',clip_id:'c1',dialogue:'Cat [English]: Hello.'};
  assert.doesNotThrow(()=>state.assertProposalSubmission(entries,refs,generation,workflow,selection));
  assert.throws(()=>state.assertProposalSubmission(entries,refs,generation,{...workflow,continuity:{mode:'none'}},selection),/continuity.*mode/i);
  for(const patch of [{card_id:'old-card'},{clip_id:'missing'},{dialogue:'Cat [English]: Run.'},{card_id:undefined}])assert.throws(()=>state.assertProposalSubmission(entries,refs,generation,workflow,{...selection,...patch}),/card|clip|dialogue/i);
  const mixed=card();delete mixed.proposal.clip_workflows;
  mixed.proposal.shots.push({...mixed.proposal.shots[0],shot_id:'s2',clip_id:'c2',duration_seconds:10});
  mixed.proposal.clip_dimensions.push({clip_id:'c2',width:704,height:1280});
  assert.throws(()=>state.assertProposalSubmission(reviewed(mixed),refs,{...generation,timing:{delivered_frames:240,fps:24}}),/duration|clip/i);
});

test('compiling a reviewed template to an execution copy preserves approval and records both paths',()=>{
  const value=card(),entries=reviewed(value),refs=[{sha256:sha}],selection={card_id:value.card_id,clip_id:'c1',dialogue:[{speaker:'Cat',language:'English',text:'Hello.'}]};
  const execution={...workflow,path:'C:/film/new-run/prepared-c1.json'};
  const binding=state.assertProposalSubmission(entries,refs,generation,execution,selection);
  assert.equal(binding.reviewed_workflow_path,'C:/film/c1.json');
  assert.equal(binding.submitted_workflow_path,execution.path);
  assert.equal(binding.approval_seq,2);
  for(const continuity of [{mode:'none'},{mode:'video_frames',source:workflow.continuity.source},{mode:'sampler_latent',source:'C:/film/unapproved.safetensors'}])assert.throws(()=>state.assertProposalSubmission(entries,refs,generation,{...execution,continuity},selection),/continuity.*mode|continuity.*source/);
  assert.throws(()=>state.assertProposalSubmission(entries,[{sha256:'b'.repeat(64)}],generation,execution,selection),/bytes\/order/);
  assert.throws(()=>state.assertProposalSubmission(entries,refs,{...generation,width:704,height:1280},execution,selection),/size/);
  assert.throws(()=>state.assertProposalSubmission(entries,refs,{...generation,timing:{delivered_frames:240,fps:24}},execution,selection),/duration/);
  assert.throws(()=>state.assertProposalSubmission(entries,refs,generation,execution,{...selection,dialogue:[{speaker:'Cat',language:'English',text:'Changed line.'}]}),/dialogue/);
});

test('early card selection admits unresolved dialogue, final structured H3 dialogue must match exact reviewed utterances',()=>{
  const value=card(),entries=reviewed(value),refs=[{sha256:sha}],selection={card_id:value.card_id,clip_id:'c1'};
  assert.doesNotThrow(()=>state.assertProposalSubmission(entries,refs,generation,workflow,selection));
  const dialogue=[{speaker:'Cat',language:'English',text:'Hello.'}];
  assert.doesNotThrow(()=>state.assertProposalSubmission(entries,refs,generation,workflow,{...selection,dialogue}));
  for(const patch of [{text:'Run.'},{speaker:'Dog'},{language:'French'}])assert.throws(()=>state.assertProposalSubmission(entries,refs,generation,workflow,{...selection,dialogue:[{...dialogue[0],...patch}]}),/dialogue/);
  assert.throws(()=>state.assertProposalSubmission(entries,refs,generation,workflow,{...selection,dialogue:[...dialogue,...dialogue]}),/dialogue/);
  value.proposal.shots[0].dialogue='';
  assert.doesNotThrow(()=>state.assertProposalSubmission(reviewed(value),refs,generation,workflow,{...selection,dialogue:[]}));
  assert.throws(()=>state.assertProposalSubmission(reviewed(value),refs,generation,workflow,{...selection,dialogue}),/dialogue/);
});

test('explicit silence labels match empty H3 dialogue without accepting unexpected spoken words',()=>{
  const value=card(),refs=[{sha256:sha}],selection={card_id:value.card_id,clip_id:'c1'};
  for(const label of ['', '无', '无台词', '无对白。', 'No dialogue', 'No speech.', 'Silent', 'None']){
    value.proposal.shots[0].dialogue=label;
    assert.doesNotThrow(()=>state.assertProposalSubmission(reviewed(value),refs,generation,workflow,{...selection,dialogue:[]}),label);
    assert.throws(()=>state.assertProposalSubmission(reviewed(value),refs,generation,workflow,{...selection,dialogue:[{speaker:'Cat',language:'English',text:'Hello.'}]}),/dialogue/,label);
  }
  value.proposal.shots[0].dialogue='“无”';
  assert.throws(()=>state.assertProposalSubmission(reviewed(value),refs,generation,workflow,{...selection,dialogue:[]}),/dialogue/,'a quoted word is speech, not a silence label');
});

test('paired display quotes preserve spoken-word comparison and still reject changed speech or speaker',()=>{
  const value=card(),refs=[{sha256:sha}],selection={card_id:value.card_id,clip_id:'c1'},line={speaker:'Cat',language:'English',text:'Hello.'};
  for(const [open,close] of [['“','”'],['"','"'],["'","'"],['‘','’'],['「','」'],['『','』']]){
    for(const prefix of ['', 'Cat [English]: ']){
      value.proposal.shots[0].dialogue=prefix+open+'Hello.'+close;
      assert.doesNotThrow(()=>state.assertProposalSubmission(reviewed(value),refs,generation,workflow,{...selection,dialogue:[line]}));
      assert.throws(()=>state.assertProposalSubmission(reviewed(value),refs,generation,workflow,{...selection,dialogue:[{...line,text:'Bye.'}]}),/dialogue/);
      if(prefix)assert.throws(()=>state.assertProposalSubmission(reviewed(value),refs,generation,workflow,{...selection,dialogue:[{...line,speaker:'Dog'}]}),/dialogue/);
    }
  }
  value.proposal.shots[0].dialogue='Cat [English]: Hello.';
  assert.doesNotThrow(()=>state.assertProposalSubmission(reviewed(value),refs,generation,workflow,{...selection,dialogue:[{...line,text:'“Hello.”'}]}));
});

test('full-card redisplay reuses identity and approval; changed content gets a unique version; card_id replay is read-only',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'review-contract-')),events=[];
  await writeFile(join(cwd,'actor.png'),Buffer.from('89504e470d0a1a0a0000000000000000','hex'));
  const store=createMediaStore({root:join(cwd,'store')}),tool=createMediaTool({store,fs:localFs()});
  const session={id:'s',header:{cwd},snapshotEvents:()=>events},exec={agent:{session}};
  const record=value=>{const id='show-'+events.length;events.push(call(events.length+1,id),result(events.length+2,id,value));};
  const args={title:'Review',items:[{path:'actor.png'}],proposal:card().proposal};
  const first=await tool.execute(args,exec);record(first);events.push(userEvent(events.length+1,'ok'));
  assert.equal(first.review_status,'awaiting_confirmation');
  assert.equal(first.approval_message,state.proposalConfirmationText(first));
  const latest=await tool.execute({card_id:'latest'},exec);record(latest);
  assert.equal(latest.card_id,first.card_id);
  assert.equal(latest.review_status,'confirmed');
  assert.equal(latest.approval_seq,3);
  const editMetadata=createEditReviewTool(tool);
  const newPath='C:/film/run/prepared-c1.json';
  const relocated=await editMetadata.execute({base_card_id:first.card_id,operation:'shots',clip_workflows:[{...first.proposal.clip_workflows[0],workflow_path:newPath}]},exec);record(relocated);
  assert.equal(relocated.card_id,first.card_id);
  assert.equal(relocated.proposal.version,first.proposal.version);
  assert.equal(relocated.proposal.clip_workflows[0].workflow_path,newPath);
  assert.equal(relocated.review_status,'confirmed');
  assert.equal(state.latestProposal(state.entriesFromEvents(events)).value.proposal.clip_workflows[0].workflow_path,newPath);
  assert.equal((await tool.execute({card_id:first.card_id},exec)).proposal.clip_workflows[0].workflow_path,newPath,'replaying a stable card ID returns its newest technical metadata');
  const duplicate=await tool.execute({...args,proposal:{...args.proposal,version:'same-again'}},exec);record(duplicate);
  assert.equal(duplicate.card_id,first.card_id);
  assert.equal(duplicate.proposal.version,first.proposal.version);
  assert.equal(state.proposalState(state.entriesFromEvents(events),first.proposal.version).status,'confirmed');
  const changed=await tool.execute({...args,proposal:{...args.proposal,shots:[{...args.proposal.shots[0],dialogue:'Cat [English]: Bye.'}]}},exec);record(changed);
  assert.notEqual(changed.card_id,first.card_id);
  assert.notEqual(changed.proposal.version,first.proposal.version);
  const replay=await tool.execute({card_id:first.card_id},exec);record(replay);
  assert.equal(replay.card_id,first.card_id);
  assert.equal(replay.review_status,'superseded');
  assert.equal(state.proposalState(state.entriesFromEvents(events),changed.proposal.version).status,'awaiting_confirmation');
  await assert.rejects(tool.execute({card_id:first.card_id,items:args.items},exec),/either|mix/i);
  const edit=createEditReviewTool(tool);
  const edited=await edit.execute({base_card_id:changed.card_id,operation:'shots',shot_changes:[{shot_id:'s1',dialogue:''}]},exec);
  assert.equal(edited.proposal.shots[0].dialogue,'');
});

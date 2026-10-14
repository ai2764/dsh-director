import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localFs} from './harness.mjs';
import {createMediaStore} from '../src/media-store.mjs';
import {createMediaTool} from '../src/media-tool.mjs';
import * as mediaTools from '../src/media-tool.mjs';
import {entriesFromEvents,proposalState,assertProposalSubmission} from '../src/proposal-state.mjs';

async function fixture(t){
  const cwd=await mkdtemp(join(tmpdir(),'dsh-revision-')),events=[];
  for(const [i,name] of ['actor','room','teal','red'].entries())await writeFile(join(cwd,name+'.png'),Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(8,i)]));
  const session={id:'test-revision',header:{cwd},snapshotEvents:()=>events};
  const tool=createMediaTool({store:createMediaStore({root:join(cwd,'store')}),fs:localFs()});
  const add=value=>events.push({seq:events.length+1,type:'tool/result',data:{message:{content:[{type:'tool-result',toolCallId:'c'+events.length,content:[{type:'text',text:JSON.stringify(value)}]}]}}});
  const user=text=>events.push({seq:events.length+1,type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text}]}});
  const run=async args=>{const value=await tool.execute(args,{agent:{session}});add(value);return value};
  const base=await run({items:[{path:'actor.png',responsibility:'Actor identity'},{path:'room.png',responsibility:'Scene'}],proposal:{version:'v1',shots:[{shot_id:'S1',clip_id:'C1',duration_seconds:6,content:'Alex addresses an empty sofa.',dialogue:'The sample is ready.',reference_numbers:[1,2]},{shot_id:'S2',clip_id:'C2',duration_seconds:4,content:'The empty room.',reference_numbers:[2]}]}});
  const revise=(card,change,extra={})=>run({revision:{base_card_id:card.card_id,version:'v'+(events.length+1),change,...extra}});
  return {cwd,events,base,run,revise,user,tool,session,add};
}

test('add appends a real image without renumbering old references or rewriting shots',async t=>{
  const f=await fixture(t);f.user('Add this costume reference to S1.');
  const next=await f.revise(f.base,{op:'add',item:{path:'teal.png',responsibility:'Costume'},shot_ids:['S1']});
  assert.deepEqual(next.items.map(x=>x.filename),['actor.png','room.png','teal.png']);
  assert.deepEqual(next.proposal.shots[0],{...f.base.proposal.shots[0],reference_numbers:[1,2,3]});
  assert.deepEqual(next.proposal.shots[1],f.base.proposal.shots[1]);
  assert.notEqual(next.card_id,f.base.card_id);
  assert.equal(proposalState(entriesFromEvents(f.events),next.proposal.version).status,'awaiting_confirmation');
});

test('replace changes only the numbered position and never inherits approval',async t=>{
  const f=await fixture(t),added=await f.revise(f.base,{op:'add',item:{path:'teal.png'},shot_ids:['S1']});
  f.user('Confirm '+added.proposal.version);f.user('Replace reference 3 with this red costume.');
  const next=await f.revise(added,{op:'replace',reference_number:3,item:{path:'red.png',responsibility:'Costume'}});
  assert.deepEqual(next.items.map(x=>x.filename),['actor.png','room.png','red.png']);
  assert.deepEqual(next.items.slice(0,2).map(x=>x.sha256),added.items.slice(0,2).map(x=>x.sha256));
  assert.deepEqual(next.proposal.shots,added.proposal.shots);
  assert.equal(proposalState(entriesFromEvents(f.events),next.proposal.version).status,'awaiting_confirmation');
});

test('remove unbinds the selected image and renumbers later bindings in every shot',async t=>{
  const f=await fixture(t),added=await f.revise(f.base,{op:'add',item:{path:'teal.png'},shot_ids:['S1']});
  f.user('Remove reference 1.');
  const next=await f.revise(added,{op:'remove',reference_number:1});
  assert.deepEqual(next.items.map(x=>x.filename),['room.png','teal.png']);
  assert.deepEqual(next.proposal.shots.map(s=>s.reference_numbers),[[1,2],[1]]);
  assert.equal(next.proposal.shots[0].dialogue,'The sample is ready.');
  assert.equal(proposalState(entriesFromEvents(f.events),next.proposal.version).status,'awaiting_confirmation');
});

test('revision rejects stale cards, mixed input, wrong indices and unknown shot targets',async t=>{
  const f=await fixture(t);
  const next=await f.revise(f.base,{op:'add',item:{path:'teal.png'},shot_ids:['S1']});
  await assert.rejects(f.revise(f.base,{op:'remove',reference_number:1}),/latest|stale/i);
  await assert.rejects(f.revise(next,{op:'remove',reference_number:0}),/reference_number/i);
  await assert.rejects(f.revise(next,{op:'add',item:{path:'red.png'},shot_ids:['typo']}),/shot/i);
  await assert.rejects(f.run({items:[{path:'red.png'}],revision:{base_card_id:next.card_id,version:'mixed',change:{op:'remove',reference_number:3}}}),/mix|either/i);
});

test('revision verifies unchanged source bytes, not merely old captions or ids',async t=>{
  const f=await fixture(t);await writeFile(join(f.cwd,'actor.png'),Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(8,99)]));
  await assert.rejects(f.revise(f.base,{op:'add',item:{path:'teal.png'},shot_ids:['S1']}),/changed/i);
});

test('shot patches preserve omitted fields and require repair of deleted Picture mentions',async t=>{
  const f=await fixture(t);
  const marked=await f.run({items:[{path:'actor.png'},{path:'room.png'}],proposal:{...f.base.proposal,version:'marked',shots:[{...f.base.proposal.shots[0],content:'Alex from Picture 1 sits in Picture 2.'}]}});
  await assert.rejects(f.revise(marked,{op:'remove',reference_number:1}),/Picture 1|shot_changes/i);
  const next=await f.revise(marked,{op:'remove',reference_number:1},{shot_changes:[{shot_id:'S1',content:'Alex sits in the living room.'}]});
  assert.equal(next.proposal.shots[0].content,'Alex sits in the living room.');
  assert.equal(next.proposal.shots[0].dialogue,'The sample is ready.');
  assert.deepEqual(next.proposal.shots[0].reference_numbers,[1]);
});

test('removal renumbers retained Picture mentions without mutating durable older cards',async t=>{
  const f=await fixture(t);
  const marked=await f.run({items:[{path:'actor.png'},{path:'room.png',caption:'Picture 2: room'}],proposal:{...f.base.proposal,version:'marked',shots:[{...f.base.proposal.shots[0],content:'Alex sits in <Picture 2>.',ending_state:'Hold on Picture #2.',dialogue:'Picture 2 is hilarious.'}]}});
  const next=await f.revise(marked,{op:'remove',reference_number:1});
  assert.equal(next.items[0].caption,'Picture 1: room');
  assert.equal(next.proposal.shots[0].content,'Alex sits in <Picture 1>.');
  assert.equal(next.proposal.shots[0].ending_state,'Hold on Picture #1.');
  assert.equal(marked.items[1].caption,'Picture 2: room');
  assert.equal(next.proposal.shots[0].dialogue,'Picture 2 is hilarious.');
});

test('shot-only revisions preserve media and unrelated fields',async t=>{
  const f=await fixture(t);
  const next=await f.run({revision:{base_card_id:f.base.card_id,version:'dialogue-v2',shot_changes:[{shot_id:'S1',dialogue:'This meeting could have been an email.'}]}});
  assert.deepEqual(next.items.map(x=>x.sha256),f.base.items.map(x=>x.sha256));
  assert.deepEqual(next.proposal.shots[0],{...f.base.proposal.shots[0],dialogue:'This meeting could have been an email.'});
  assert.deepEqual(next.proposal.shots[1],f.base.proposal.shots[1]);
});

test('Picture tags follow per-clip binding order, not global card numbers',async t=>{
  const f=await fixture(t);
  const marked=await f.run({items:[{path:'actor.png'},{path:'room.png'},{path:'teal.png'}],proposal:{version:'multi',shots:[{...f.base.proposal.shots[0],reference_numbers:[1,2]},{...f.base.proposal.shots[1],content:'Room from <Picture 1> and costume from <Picture 2>.',reference_numbers:[2,3]}]}});
  const next=await f.revise(marked,{op:'remove',reference_number:1});
  assert.deepEqual(next.proposal.shots[1].reference_numbers,[1,2]);
  assert.equal(next.proposal.shots[1].content,'Room from <Picture 1> and costume from <Picture 2>.');
});

test('revision refuses a newer card published while source verification is pending',async t=>{
  const f=await fixture(t),store=createMediaStore({root:join(f.cwd,'store')}),openVerified=store.openVerified;
  let inserted=false;
  store.openVerified=async(...args)=>{
    if(!inserted){inserted=true;await f.run({items:[{path:'red.png'}],proposal:{version:'concurrent',shots:[{...f.base.proposal.shots[0],reference_numbers:[1]}]}});}
    return openVerified(...args);
  };
  const tool=createMediaTool({store,fs:localFs()});
  await assert.rejects(tool.execute({revision:{base_card_id:f.base.card_id,version:'late',shot_changes:[{shot_id:'S1',dialogue:'Late edit.'}]}},{agent:{session:{id:'test-revision',header:{cwd:f.cwd},snapshotEvents:()=>f.events}}}),/stale|latest|newer/i);
});

test('flat edit tool adds, replaces and removes actual images using the same approval guard',async t=>{
  const f=await fixture(t),edit=mediaTools.createEditReviewTool(f.tool);
  const run=async args=>{const value=await edit.execute(args,{agent:{session:f.session}});f.add(value);return value};
  const added=await run({base_card_id:f.base.card_id,version:'flat2',operation:'add',path:'teal.png',responsibility:'Costume',shot_ids:['S1']});
  assert.deepEqual(added.items.map(x=>x.filename),['actor.png','room.png','teal.png']);
  const replaced=await run({base_card_id:added.card_id,version:'flat3',operation:'replace',reference_number:3,path:'red.png',responsibility:'Costume'});
  assert.deepEqual(replaced.items.map(x=>x.filename),['actor.png','room.png','red.png']);
  const removed=await run({base_card_id:replaced.card_id,version:'flat4',operation:'remove',reference_number:3});
  assert.deepEqual(removed.proposal.shots,f.base.proposal.shots);
  assert.equal(proposalState(entriesFromEvents(f.events),removed.proposal.version).status,'awaiting_confirmation');
});

test('flat shot edit preserves references and rejects conflicting image arguments',async t=>{
  const f=await fixture(t),edit=mediaTools.createEditReviewTool(f.tool);
  const args={base_card_id:f.base.card_id,version:'flat2',operation:'shots',shot_changes:[{shot_id:'S1',dialogue:'New line.'}]};
  const next=await edit.execute(args,{agent:{session:f.session}});
  assert.equal(next.proposal.shots[0].dialogue,'New line.');
  assert.deepEqual(next.items.map(x=>x.sha256),f.base.items.map(x=>x.sha256));
  await assert.rejects(edit.execute({...args,path:'red.png'},{agent:{session:f.session}}),/shots|path/i);
});

test('adding to an early shot remaps later clip-local Picture tags without changing dialogue',async t=>{
  const f=await fixture(t);
  const marked=await f.run({items:[{path:'actor.png'},{path:'room.png',caption:'Room from Picture 2.'}],proposal:{version:'shared-clip',shots:[{...f.base.proposal.shots[0],reference_numbers:[1]},{...f.base.proposal.shots[1],clip_id:'C1',content:'Room from <Picture 2>.',dialogue:'Picture 2 is hilarious.',reference_numbers:[2]}]}});
  const next=await f.revise(marked,{op:'add',item:{path:'teal.png'},shot_ids:['S1']});
  assert.deepEqual(next.proposal.shots.map(s=>s.reference_numbers),[[1,3],[2]]);
  assert.equal(next.proposal.shots[1].content,'Room from <Picture 3>.');
  assert.equal(next.items[1].caption,'Room from Picture 3.');
  assert.equal(next.proposal.shots[1].dialogue,'Picture 2 is hilarious.');
});

test('one flat edit can add a costume, narrow old reference responsibility and repair only wardrobe text',async t=>{
  const f=await fixture(t);
  const base=await f.run({items:[{path:'actor.png',responsibility:'Actor identity + Costume: cream shirt'},{path:'room.png',responsibility:'Scene'}],proposal:{...f.base.proposal,version:'costume-base',shots:[{...f.base.proposal.shots[0],content:'Alex wears a cream shirt and addresses an empty sofa.'}]}});
  f.user('Confirm costume-base');
  f.user('Add this costume, keep action and dialogue unchanged.');
  const edit=mediaTools.createEditReviewTool(f.tool);
  const next=await edit.execute({base_card_id:base.card_id,version:'costume-edit',operation:'add',path:'teal.png',responsibility:'Costume for Alex: teal suit',shot_ids:['S1'],reference_changes:[{reference_number:1,responsibility:'Actor identity only'}],shot_changes:[{shot_id:'S1',content:'Alex wears a teal suit and addresses an empty sofa.'}]},{agent:{session:f.session}});
  f.add(next);
  assert.deepEqual(next.items.map(x=>x.responsibility),['Actor identity only','Scene','Costume for Alex: teal suit']);
  assert.deepEqual(next.items.slice(0,2).map(x=>x.sha256),base.items.map(x=>x.sha256));
  assert.deepEqual(next.proposal.shots[0],{...base.proposal.shots[0],content:'Alex wears a teal suit and addresses an empty sofa.',reference_numbers:[1,2,3]});
  assert.equal(base.items[0].responsibility,'Actor identity + Costume: cream shirt');
  assert.equal(proposalState(entriesFromEvents(f.events),next.proposal.version).status,'awaiting_confirmation');
});

test('reference responsibility patches reject invalid targets and cannot change files',async t=>{
  const f=await fixture(t),edit=mediaTools.createEditReviewTool(f.tool);
  for(const reference_changes of [
    [{reference_number:0,responsibility:'Actor'}],
    [{reference_number:3,responsibility:'Actor'}],
    [{reference_number:1,responsibility:' '}],
    [{reference_number:1,responsibility:'Actor'},{reference_number:1,responsibility:'Costume'}],
    [{reference_number:1,responsibility:'Actor',path:'red.png'}]
  ])await assert.rejects(edit.execute({base_card_id:f.base.card_id,version:'invalid',operation:'shots',reference_changes,shot_changes:[{shot_id:'S1',dialogue:'Updated.'}]},{agent:{session:f.session}}),/reference_changes/i);
});

test('role patch targets base-card numbering on removal, and explicit new Picture prose stays unchanged',async t=>{
  const f=await fixture(t);
  const marked=await f.run({items:[{path:'actor.png'},{path:'room.png',responsibility:'Scene from Picture 2'}],proposal:{...f.base.proposal,version:'role-base'}});
  const next=await f.revise(marked,{op:'remove',reference_number:1},{reference_changes:[{reference_number:2,responsibility:'Scene from Picture 1'}]});
  assert.equal(next.items[0].responsibility,'Scene from Picture 1');
  await assert.rejects(f.revise(next,{op:'replace',reference_number:1,item:{path:'red.png'}},{reference_changes:[{reference_number:1,responsibility:'Costume'}]}),/reference_changes/i);
});

test('early-shot append preserves explicitly patched new role numbering while remapping old shot prose',async t=>{
  const f=await fixture(t);
  const base=await f.run({items:[{path:'actor.png'},{path:'room.png',responsibility:'Scene from Picture 2'}],proposal:{version:'append-role-base',shots:[{...f.base.proposal.shots[0],reference_numbers:[1]},{...f.base.proposal.shots[1],clip_id:'C1',content:'The room from Picture 2.',reference_numbers:[2]}]}});
  const next=await f.revise(base,{op:'add',item:{path:'teal.png',responsibility:'Costume'},shot_ids:['S1']},{reference_changes:[{reference_number:2,responsibility:'Scene from Picture 3'}]});
  assert.equal(next.items[1].responsibility,'Scene from Picture 3');
  assert.equal(next.proposal.shots[1].content,'The room from Picture 3.');
  assert.equal(base.items[1].responsibility,'Scene from Picture 2');
});

async function explicitCard(f){
  return f.run({items:[{path:'actor.png'},{path:'room.png',caption:'Room from Picture 1.'},{path:'teal.png',responsibility:'Clip-wide Costume'}],proposal:{version:'explicit',clip_references:[{clip_id:'C1',reference_numbers:[2,1,3]}],shots:[{...f.base.proposal.shots[0],reference_numbers:[1]},{...f.base.proposal.shots[1],clip_id:'C1',content:'Room from <Picture 1>.',dialogue:'Picture 1 is hilarious.',reference_numbers:[2]}]}});
}

// Explicit append must not reproduce the legacy early-shot insertion/remap.
test('explicit clip append preserves existing Picture slots and only marks selected shots relevant',async t=>{
  const f=await fixture(t),base=await explicitCard(f);
  const next=await f.revise(base,{op:'add',item:{path:'red.png'},shot_ids:['S1','S2']});
  assert.deepEqual(next.proposal.clip_references,[{clip_id:'C1',reference_numbers:[2,1,3,4]}]);
  assert.deepEqual(next.proposal.shots.map(s=>s.reference_numbers),[[1,4],[2,4]]);
  assert.equal(next.proposal.shots[1].content,'Room from <Picture 1>.');
  assert.equal(next.items[1].caption,'Room from Picture 1.');
  assert.deepEqual(base.proposal.clip_references,[{clip_id:'C1',reference_numbers:[2,1,3]}]);
});

test('explicit clip removal renumbers both binding layers and preserves clip-local prose and exact dialogue',async t=>{
  const f=await fixture(t),base=await explicitCard(f);
  const next=await f.revise(base,{op:'remove',reference_number:1});
  assert.deepEqual(next.proposal.clip_references,[{clip_id:'C1',reference_numbers:[1,2]}]);
  assert.deepEqual(next.proposal.shots.map(s=>s.reference_numbers),[[],[1]]);
  assert.equal(next.proposal.shots[1].content,'Room from <Picture 1>.');
  assert.equal(next.proposal.shots[1].dialogue,'Picture 1 is hilarious.');
});

test('replacing a clip-wide-only reference changes actual binding and still requires new confirmation',async t=>{
  const f=await fixture(t),base=await explicitCard(f);
  f.user('Confirm explicit');f.user('Replace reference #3 with the red costume.');
  const next=await f.revise(base,{op:'replace',reference_number:3,item:{path:'red.png',responsibility:'Clip-wide Costume'}});
  assert.deepEqual(next.proposal.clip_references,[{clip_id:'C1',reference_numbers:[2,1,3]}]);
  assert.deepEqual(next.proposal.shots,base.proposal.shots);
  assert.notEqual(next.items[2].sha256,base.items[2].sha256);
  assert.equal(proposalState(entriesFromEvents(f.events),next.proposal.version).status,'awaiting_confirmation');
  f.user('Confirm '+next.proposal.version);
  assert.equal(proposalState(entriesFromEvents(f.events),next.proposal.version).status,'confirmed');
});

test('a malformed historic clip map does not prevent publishing a new full review card',async t=>{
  const f=await fixture(t);
  f.add({...f.base,card_id:'malformed',proposal:{...f.base.proposal,version:'bad',clip_references:null}});
  const restored=await f.run({items:[{path:'actor.png'},{path:'room.png'}],proposal:{...f.base.proposal,version:'restored',clip_references:[{clip_id:'C1',reference_numbers:[1,2]},{clip_id:'C2',reference_numbers:[2]}]}});
  assert.equal(restored.proposal.version,'restored');
  assert.equal(proposalState(entriesFromEvents(f.events),'restored').status,'awaiting_confirmation');
});

test('flat edits allocate fresh versions across add replace remove and dialogue without carrying approval',async t=>{
  const f=await fixture(t),edit=mediaTools.createEditReviewTool(f.tool),versions=new Set(['v1']);
  f.user('Confirm v1');
  assert.equal(proposalState(entriesFromEvents(f.events),'v1').status,'confirmed');
  let base=f.base;
  for(const patch of [
    {operation:'add',path:'teal.png',responsibility:'Costume',shot_ids:['S1']},
    {operation:'replace',reference_number:3,path:'red.png',responsibility:'Costume'},
    {operation:'remove',reference_number:3},
    {operation:'shots',shot_changes:[{shot_id:'S1',dialogue:'A shorter line.'}]}
  ]){
    const next=await edit.execute({base_card_id:base.card_id,...patch},{agent:{session:f.session}});
    f.add(next);
    assert.equal(versions.has(next.proposal.version.toLowerCase()),false);
    assert.notEqual(next.card_id,base.card_id);
    versions.add(next.proposal.version.toLowerCase());
    assert.equal(proposalState(entriesFromEvents(f.events),next.proposal.version).status,'awaiting_confirmation');
    assert.throws(()=>assertProposalSubmission(entriesFromEvents(f.events),next.items),/confirm/i);
    f.user('Confirm '+next.proposal.version);
    assert.equal(assertProposalSubmission(entriesFromEvents(f.events),next.items).version,next.proposal.version);
    base=next;
  }
  assert.deepEqual(base.items.map(x=>x.sha256),f.base.items.map(x=>x.sha256));
  assert.deepEqual(base.proposal.shots[0],{...f.base.proposal.shots[0],dialogue:'A shorter line.'});
  assert.equal(f.base.proposal.shots[0].dialogue,'The sample is ready.');
  assert.equal(edit.parameters.required.includes('version'),false,'Harness must admit the omitted-version call');
});

test('reused current and historic version labels allocate fresh labels instead of another model retry',async t=>{
  const f=await fixture(t),edit=mediaTools.createEditReviewTool(f.tool);
  const next=await edit.execute({base_card_id:f.base.card_id,version:'v1',operation:'shots',shot_changes:[{shot_id:'S1',dialogue:'First revision.'}]},{agent:{session:f.session}});f.add(next);
  assert.notEqual(next.proposal.version,'v1');
  const again=await edit.execute({base_card_id:next.card_id,version:'  V1  ',operation:'shots',shot_changes:[{shot_id:'S1',dialogue:'Second revision.'}]},{agent:{session:f.session}});f.add(again);
  assert.equal(['v1',next.proposal.version.toLowerCase()].includes(again.proposal.version.trim().toLowerCase()),false);
  assert.equal(again.proposal.shots[0].dialogue,'Second revision.');
  assert.equal(proposalState(entriesFromEvents(f.events),again.proposal.version).status,'awaiting_confirmation');
});

test('automatic versions skip historic label collisions even with case and surrounding spaces',async t=>{
  const f=await fixture(t);
  const occupied=await f.run({items:[{path:'actor.png'},{path:'room.png'}],proposal:{...f.base.proposal,version:'  V3  '}});
  const next=await f.run({revision:{base_card_id:occupied.card_id,shot_changes:[{shot_id:'S1',dialogue:'Collision-free.'}]}});
  assert.notEqual(next.proposal.version.trim().toLowerCase(),'v3');
  assert.equal(next.proposal.shots[0].dialogue,'Collision-free.');
});

test('a new explicit version is preserved while invalid versions and stale bases still fail without publishing',async t=>{
  const f=await fixture(t),edit=mediaTools.createEditReviewTool(f.tool);
  const patch={operation:'shots',shot_changes:[{shot_id:'S1',dialogue:'A named edit.'}]};
  const next=await edit.execute({base_card_id:f.base.card_id,version:'costume-review-B',...patch},{agent:{session:f.session}});f.add(next);
  assert.equal(next.proposal.version,'costume-review-B');
  const count=f.events.length;
  await assert.rejects(edit.execute({base_card_id:f.base.card_id,...patch},{agent:{session:f.session}}),/stale|latest/i);
  for(const version of [null,42,'','   ','x'.repeat(81)])await assert.rejects(edit.execute({base_card_id:next.card_id,version,...patch},{agent:{session:f.session}}),/version/i);
  assert.equal(f.events.length,count);
  assert.equal(proposalState(entriesFromEvents(f.events),next.proposal.version).status,'awaiting_confirmation');
});

test('automatic labels do not clear declared missing assets or accept an old version confirmation',async t=>{
  const f=await fixture(t);
  const pending=await f.run({items:[{path:'actor.png'},{path:'room.png'}],proposal:{...f.base.proposal,version:'missing-mother',pending_references:['Mother dragon scale reference']}});
  const next=await f.run({revision:{base_card_id:pending.card_id,shot_changes:[{shot_id:'S1',dialogue:'Still waiting.'}]}});
  assert.deepEqual(next.proposal.pending_references,['Mother dragon scale reference']);
  f.user('Confirm '+next.proposal.version);
  assert.throws(()=>assertProposalSubmission(entriesFromEvents(f.events),next.items),/pending/i);
  const ready=await f.run({items:[{path:'actor.png'},{path:'room.png'}],proposal:{...f.base.proposal,version:'ready'}});
  const updated=await f.run({revision:{base_card_id:ready.card_id,shot_changes:[{shot_id:'S1',dialogue:'Current version.'}]}});
  f.user('Confirm ready');
  assert.notEqual(proposalState(entriesFromEvents(f.events),updated.proposal.version).status,'confirmed');
  assert.throws(()=>assertProposalSubmission(entriesFromEvents(f.events),updated.items),/confirm/i);
  f.user('Confirm '+updated.proposal.version);
  assert.equal(assertProposalSubmission(entriesFromEvents(f.events),updated.items).version,updated.proposal.version);
  assert.throws(()=>assertProposalSubmission(entriesFromEvents(f.events),[...updated.items].reverse()),/bytes\/order/i);
});

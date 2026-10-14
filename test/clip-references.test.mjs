import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProposal} from '../src/shot-proposal.mjs';
import {assertProposalSubmission,proposalState} from '../src/proposal-state.mjs';
import {parseMediaResult} from '../src/client/media-result.mjs';

const shot=(shot_id,reference_numbers,clip_id='C5')=>({shot_id,clip_id,duration_seconds:4,content:'Reviewed action.',dialogue:'',reference_numbers});
const items=['a','b','c','d','e'].map((letter,i)=>({id:letter.repeat(43),type:'image',sha256:letter.repeat(64),mime:'image/png',filename:`ref${i+1}.png`,url:`/director-media/${letter.repeat(43)}?session=test`}));
const plan=()=>({version:'v1',clip_references:[{clip_id:'C5',reference_numbers:[1,2,3,4,5]}],shots:[shot('S9',[1,3,5]),shot('S10',[1,2,3,4,5])]});
const card=p=>({seq:1,kind:'proposal',value:{kind:'director-media',version:1,session_id:'test',items,proposal:p}});
const approve={seq:2,kind:'user',text:'Confirm v1'};
const submitted=indices=>indices.map(n=>({sha256:items[n-1].sha256}));

// Dropping the explicit clip order, sorting it, or reverting to the first-shot
// union would either lose approved meaning or repeat the real C5 failure.
test('C5 shot relevance survives host and durable browser validation without changing clip connection order',()=>{
  const p=plan(),before=structuredClone(p),normalized=validateProposal(p,5,items);
  assert.deepEqual(normalized,p);
  const parsed=parseMediaResult({kind:'tool-result',content:[{type:'text',text:JSON.stringify(card(p).value)}]},'test');
  assert.equal(parsed.kind,'ready');assert.deepEqual(parsed.proposal.clip_references,[{clip_id:'C5',reference_numbers:[1,2,3,4,5]}]);
  normalized.clip_references[0].reference_numbers.pop();
  assert.deepEqual(p,before,'normalization must not alias caller arrays');
});

test('C5 submission uses approved clip order instead of per-shot first encounter order',()=>{
  const entries=[card(plan()),approve];
  assert.doesNotThrow(()=>assertProposalSubmission(entries,submitted([1,2,3,4,5])));
  assert.throws(()=>assertProposalSubmission(entries,submitted([1,3,5,2,4])),/match/i);
  assert.throws(()=>assertProposalSubmission(entries,submitted([1,3,5])),/match/i);
  assert.throws(()=>assertProposalSubmission([card(plan())],submitted([1,2,3,4,5])),/confirm/i);
});

test('nonnumeric explicit orders remain meaningful and legacy cards keep their original union order',()=>{
  const p=plan();p.clip_references[0].reference_numbers=[5,2,1,4,3];
  assert.doesNotThrow(()=>assertProposalSubmission([card(p),approve],submitted([5,2,1,4,3])));
  assert.throws(()=>assertProposalSubmission([card(p),approve],submitted([1,2,3,4,5])),/match/i);
  delete p.clip_references;
  assert.doesNotThrow(()=>assertProposalSubmission([card(p),approve],submitted([1,3,5,2,4])));
  assert.throws(()=>assertProposalSubmission([card(p),approve],submitted([1,2,3,4,5])),/match/i);
});

test('each clip has its own order and clip-wide inputs need not be repeated on every shot',()=>{
  const p={version:'v1',shots:[shot('A',[1],'C1'),shot('B',[2],'C2')],clip_references:[{clip_id:'C1',reference_numbers:[3,1]},{clip_id:'C2',reference_numbers:[2,3]}]};
  assert.deepEqual(validateProposal(p,5,items).clip_references,p.clip_references);
  for(const refs of [[3,1],[2,3]])assert.doesNotThrow(()=>assertProposalSubmission([card(p),approve],submitted(refs)));
  for(const refs of [[1],[1,3],[2,3,1]])assert.throws(()=>assertProposalSubmission([card(p),approve],submitted(refs)),/match/i);
});

test('malformed explicit clip maps fail closed instead of being silently dropped or partly inferred',()=>{
  const invalid=[null,[],{},[{clip_id:'unknown',reference_numbers:[1,2,3,4,5]}],
    [{clip_id:'C5',reference_numbers:[1,2,3,4,5]},{clip_id:'C5',reference_numbers:[1,2,3,4,5]}],
    [{clip_id:'C5',reference_numbers:[1,3,5]}],
    [{clip_id:'C5',reference_numbers:[1,2,3,4,5,5]}],
    [{clip_id:'C5',reference_numbers:[1,2,3,4,5,6]}],
    [{clip_id:'C5',reference_numbers:[0,1,2,3,4,5]}],
    [{clip_id:'C5',reference_numbers:[1,2,3,4,5,NaN]}],
    [{clip_id:'C5',reference_numbers:[1,2,3,4,5,...Array(1)]}],Array(1)];
  for(const clip_references of invalid)assert.throws(()=>validateProposal({...plan(),clip_references},5,items),/clip|reference/i);
  const p=plan();p.shots.push(shot('extra',[1],'C2'));
  assert.throws(()=>validateProposal(p,5,items),/clip/i);
  const media=structuredClone(items);media[4].type='video';
  const clipOnly={version:'v1',shots:[shot('A',[1])],clip_references:[{clip_id:'C5',reference_numbers:[1,5]}]};
  assert.throws(()=>validateProposal(clipOnly,5,media),/reference|image/i);
});

test('reference removal must change the clip conditioning, not only the shot relevance',()=>{
  const p={version:'v1',shots:[shot('A',[1])],clip_references:[{clip_id:'C5',reference_numbers:[1,2]}]};
  const before=card(p),request={seq:3,kind:'user',text:'Remove reference #2'};
  const unchanged=card({...p,version:'v2'});unchanged.seq=4;
  const confirmed={seq:5,kind:'user',text:'Confirm v2'};
  const entries=[before,approve,request,unchanged,confirmed];
  assert.equal(proposalState(entries,'v2').status,'references_pending');
  unchanged.value.proposal.clip_references=[{clip_id:'C5',reference_numbers:[1]}];
  assert.equal(proposalState(entries,'v2').status,'confirmed');
  assert.doesNotThrow(()=>assertProposalSubmission(entries,submitted([1])));
});

test('reordering clip-map entries cannot make an actual reference removal remain pending',()=>{
  const before={version:'v1',shots:[shot('A',[1,2],'C1'),shot('B',[3],'C2')],clip_references:[{clip_id:'C1',reference_numbers:[1,2]},{clip_id:'C2',reference_numbers:[3]}]};
  const after={version:'v2',shots:[shot('A',[1],'C1'),shot('B',[3],'C2')],clip_references:[{clip_id:'C2',reference_numbers:[3]},{clip_id:'C1',reference_numbers:[1]}]};
  const changed={...card(after),seq:4};
  const entries=[card(before),approve,{seq:3,kind:'user',text:'Remove reference #2'},changed,{seq:5,kind:'user',text:'Confirm v2'}];
  assert.equal(proposalState(entries,'v2').status,'confirmed');
  assert.doesNotThrow(()=>assertProposalSubmission(entries,submitted([1])));
  assert.doesNotThrow(()=>assertProposalSubmission(entries,submitted([3])));
});

test('invalid latest clip map is an approval barrier but a later valid full card can recover',()=>{
  for(const clip_references of [null,[],[{clip_id:'unknown',reference_numbers:[1]}]]){
    const bad={...card({...plan(),version:'bad',clip_references}),seq:3};
    const entries=[card(plan()),approve,bad,{seq:4,kind:'user',text:'Confirm bad'}];
    assert.equal(proposalState(entries,'bad').status,'invalid_references');
    assert.throws(()=>assertProposalSubmission(entries,submitted([1,2,3,4,5])),/invalid.*reference|reference.*invalid/i);
    entries.push({...card({...plan(),version:'recovered'}),seq:5});
    assert.equal(proposalState(entries,'recovered').status,'awaiting_confirmation');
    assert.throws(()=>assertProposalSubmission(entries,submitted([1,2,3,4,5])),/confirm/i);
    entries.push({seq:6,kind:'user',text:'Confirm recovered'});
    assert.doesNotThrow(()=>assertProposalSubmission(entries,submitted([1,2,3,4,5])));
  }
});

test('invalid intermediate history never erases an outstanding real reference edit',()=>{
  const p={version:'v1',shots:[shot('A',[1])],clip_references:[{clip_id:'C5',reference_numbers:[1,2]}]};
  const entries=[card(p),approve,{seq:3,kind:'user',text:'Remove reference #2'},{...card({...p,version:'bad',clip_references:null}),seq:4},{...card({...p,version:'v2'}),seq:5},{seq:6,kind:'user',text:'Confirm v2'}];
  assert.equal(proposalState(entries,'v2').status,'references_pending');
  entries[4].value.proposal.clip_references=[{clip_id:'C5',reference_numbers:[1]}];
  assert.equal(proposalState(entries,'v2').status,'confirmed');
});

test('an edit requested against an invalid baseline is never treated as an empty or older valid baseline',()=>{
  const p={version:'v1',shots:[shot('A',[1])],clip_references:[{clip_id:'C5',reference_numbers:[1,2]}]};
  for(const [text,reference_numbers] of [['Remove reference #2',[1]],['Replace reference #2 with a new image',[1,3]],['Add a reference image',[1,2,3]]]){
    const entries=[card(p),approve,{...card({...p,version:'bad',clip_references:null}),seq:3},{seq:4,kind:'user',text},
      {...card({...p,version:'recovered',clip_references:[{clip_id:'C5',reference_numbers}]}),seq:5},{seq:6,kind:'user',text:'Confirm recovered'}];
    assert.equal(proposalState(entries,'recovered').status,'references_pending');
    assert.deepEqual(proposalState(entries,'recovered').unverifiable,[text]);
    assert.throws(()=>assertProposalSubmission(entries,submitted(reference_numbers)),/invalid.*baseline|baseline.*invalid/i);
    const fresh=[entries[4],entries[5]];
    assert.doesNotThrow(()=>assertProposalSubmission(fresh,submitted(reference_numbers)),'a new independent review still needs and accepts its own human confirmation');
  }
});

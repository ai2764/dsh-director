import test from 'node:test';import assert from 'node:assert/strict';
const id='x'.repeat(43);
const value={kind:'director-media',version:1,session_id:'s',title:'Reference review',items:[{id,type:'image',mime:'image/png',filename:'actor-a.png',url:`/director-media/${id}?session=s`}]};
const block={kind:'tool-result',callId:'c',seq:1,time:1,call:{name:'director_show_media',argsRaw:'{}'},callTime:1,content:[{type:'text',text:JSON.stringify(value)}],isError:false,subCalls:[]};
test('parser renders nested durable text results, not only meta',async()=>{
  const {parseMediaResult}=await import('../src/client/media-result.mjs');
  assert.equal(parseMediaResult({...block,parentCallId:'outer'},'s').kind,'ready');
  assert.equal(parseMediaResult({...block,isError:true},'s').kind,'error');
  assert.equal(parseMediaResult({name:'director_show_media',callId:'c'},'s').kind,'running');
  assert.equal(parseMediaResult(block,'other').kind,'error');
});
test('parser refuses unsafe URLs, mismatched ID and unsupported media',async()=>{
  const {parseMediaResult}=await import('../src/client/media-result.mjs');
  for(const patch of [{url:'http://evil/x'},{url:'//evil/x'},{url:'/director-media/../secret?session=s'},{type:'html',mime:'text/html'},{id:'different'},{url:`/director-media/${id}?session=other`}]){
    const next={...value,items:[{...value.items[0],...patch}]};
    assert.equal(parseMediaResult({...block,content:[{type:'text',text:JSON.stringify(next)}]},'s').kind,'error');
  }
});
test('malformed optional display fields cannot reach React as objects',async()=>{
  const {parseMediaResult}=await import('../src/client/media-result.mjs');
  for(const key of ['label','caption','shot_id','responsibility'])for(const bad of [{bad:true},['bad'],123,null]){
    const next={...value,items:[{...value.items[0],[key]:bad}]};
    assert.equal(parseMediaResult({...block,content:[{type:'text',text:JSON.stringify(next)}]},'s').kind,'error',key);
  }
});

test('proposal parser retains shot metadata and rejects invalid references or React-unsafe fields',async()=>{
  const {parseMediaResult}=await import('../src/client/media-result.mjs');
  const proposal={version:'v1',shots:[{shot_id:'s1',clip_id:'c1',duration_seconds:4,content:'Alex smiles.',reference_numbers:[1]}]};
  const parse=p=>parseMediaResult({...block,content:[{type:'text',text:JSON.stringify({...value,proposal:p})}]},'s');
  assert.deepEqual(parse(proposal).proposal,proposal);
  for(const patch of [{reference_numbers:[0]},{reference_numbers:[2]},{duration_seconds:0},{content:{}},{dialogue:{}},{shot_id:''}])
    assert.equal(parse({...proposal,shots:[{...proposal.shots[0],...patch}]}).kind,'error');
  assert.equal(parse({...proposal,shots:[proposal.shots[0],proposal.shots[0]]}).kind,'error');
});

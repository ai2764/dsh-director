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
  for(const patch of [{url:'http://evil/x'},{url:'//evil/x'},{url:'/director-media/../secret?session=s'},{type:'html',mime:'text/html'},{type:'constructor'},{type:'__proto__'},{type:['image']},{type:{toString:'image'}},{id:'different'},{url:`/director-media/${id}?session=other`}]){
    const next={...value,items:[{...value.items[0],...patch}]};
    assert.equal(parseMediaResult({...block,content:[{type:'text',text:JSON.stringify(next)}]},'s').kind,'error');
  }
});
test('parser accepts generated audio metadata and rejects a forged audio MIME',async()=>{
  const {parseMediaResult}=await import('../src/client/media-result.mjs');
  const audio={...value,items:[{...value.items[0],type:'audio',mime:'audio/flac',filename:'song.flac'}]};
  const parse=x=>parseMediaResult({...block,content:[{type:'text',text:JSON.stringify(x)}]},'s');
  assert.equal(parse(audio).kind,'ready');
  assert.equal(parse({...audio,items:[{...audio.items[0],mime:'text/html'}]}).kind,'error');
});
test('malformed optional display fields cannot reach React as objects',async()=>{
  const {parseMediaResult}=await import('../src/client/media-result.mjs');
  for(const key of ['label','caption','shot_id','responsibility'])for(const bad of [{bad:true},['bad'],123,null]){
    const next={...value,items:[{...value.items[0],[key]:bad}]};
    assert.equal(parseMediaResult({...block,content:[{type:'text',text:JSON.stringify(next)}]},'s').kind,'error',key);
  }
});

test('invalid historical proposal metadata does not hide safe media or expose unsafe fields',async()=>{
  const {parseMediaResult}=await import('../src/client/media-result.mjs');
  const proposal={version:'v1',shots:[{shot_id:'s1',clip_id:'c1',duration_seconds:4,content:'Alex smiles.',reference_numbers:[1]}]};
  const parse=p=>parseMediaResult({...block,content:[{type:'text',text:JSON.stringify({...value,proposal:p})}]},'s');
  assert.deepEqual(parse(proposal).proposal,proposal);
  for(const invalid of [...[{reference_numbers:[0]},{reference_numbers:[2]},{duration_seconds:0},{content:{}},{dialogue:{}},{shot_id:''}].map(patch=>({...proposal,shots:[{...proposal.shots[0],...patch}]})),{...proposal,shots:[proposal.shots[0],proposal.shots[0]]}]){
    const result=parse(invalid);
    assert.equal(result.kind,'ready');assert.equal(result.proposal,undefined);
    assert.deepEqual(result.items,value.items);assert.match(result.proposalWarning,/proposal|shot/i);
  }
});
test('media failures distinguish tool errors, broken JSON, schema, session and unsafe media',async()=>{
  const {parseMediaResult}=await import('../src/client/media-result.mjs');
  const withValue=value=>({...block,content:[{type:'text',text:JSON.stringify(value)}]});
  const cases=[
    [{...block,isError:true,content:[{type:'text',text:'Source file unavailable.'}]},'s','tool_error',/Source file unavailable/],
    [{...block,content:[{type:'text',text:'{broken'}]},'s','invalid_json',/read|parse|JSON/i],
    [withValue({...value,version:99}),'s','invalid_result',/format|version/i],
    [block,'other','session_mismatch',/another session/i],
    [withValue({...value,items:[{...value.items[0],url:'https://evil.test/video.mp4'}]}),'s','invalid_media',/metadata|media/i]
  ];
  for(const [input,session,code,message] of cases){
    const result=parseMediaResult(input,session);assert.equal(result.kind,'error');assert.equal(result.code,code);assert.match(result.message,message);
    if(code!=='session_mismatch')assert.doesNotMatch(result.message,/another session/i);
  }
});
test('media parser preserves only safe saved card identities for explicit confirmation',async()=>{
  const {parseMediaResult}=await import('../src/client/media-result.mjs');
  const parse=card_id=>parseMediaResult({...block,content:[{type:'text',text:JSON.stringify({...value,card_id})}]},'s');
  assert.equal(parse('6de764b4-baa2-4a7e-951c-58e481d7465c').card_id,'6de764b4-baa2-4a7e-951c-58e481d7465c');
  for(const card_id of [{bad:true},'', 'card1\nconfirm other', 'x'.repeat(129)])assert.equal(parse(card_id).card_id,undefined);
});

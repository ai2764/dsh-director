import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localFs} from './harness.mjs';
import {createMediaStore} from '../src/media-store.mjs';
test('flat media interface still rejects empty calls and mixed replay/create before IO',async()=>{
  const {createMediaTool}=await import('../src/media-tool.mjs');
  const tool=createMediaTool({store:{register(){assert.fail('invalid modes must not touch storage');}}});
  await assert.rejects(tool.execute({},{}),/Provide 1–12 media items/);
  await assert.rejects(tool.execute({card_id:'latest',items:[{path:'cat.png'}]},{}),/do not mix/);
  await assert.rejects(tool.execute({card_id:'latest',proposal:{},title:'changed'},{}),/do not mix/);
});
test('media tool presents durable metadata without concluding or granting approval',async()=>{
  const {createMediaTool}=await import('../src/media-tool.mjs');
  const cwd=await mkdtemp(join(tmpdir(),'dsh-media-tool-'));
  await writeFile(join(cwd,'v.mp4'),Buffer.from('000000186674797069736f6d0000000069736f6d6d703432','hex'));
  let concluded=false;
  const tool=createMediaTool({store:createMediaStore({root:join(cwd,'state')}),fs:localFs()});
  const value=await tool.execute({title:'Existing clip',items:[{path:'v.mp4',label:'shot1'}]},
    {agent:{session:{id:'session-real',header:{cwd}}},concludeTurn(){concluded=true;}});
  assert.equal(value.session_id,'session-real');assert.equal(value.items[0].type,'video');
  assert.match(value.items[0].url,/^\/director-media\//);assert.equal(value.items[0].source,undefined);
  assert.equal(concluded,false);assert.equal(value.approved,undefined);
  assert.deepEqual(JSON.parse(tool.output.render({},value)[0].text),value);
  await assert.rejects(tool.execute({items:[{path:'http://evil/v.mp4'}]},{agent:{session:{id:'session-real',header:{cwd}}}}),/local/i);
  await assert.rejects(tool.execute({items:Array(13).fill({path:'v.mp4'})},{}),/12/i);
});
test('external image evidence cannot come from filename or error/text-only tool result',async()=>{
  const {inspectedExternalImage}=await import('../src/media-tool.mjs');
  const path=join(tmpdir(),'actor.png');
  const call={seq:1,type:'tool/call',data:{callId:'c',name:'read_image'}};
  const result={seq:2,type:'tool/result',data:{message:{content:[{type:'tool-result',toolCallId:'c',content:[{type:'text',text:`<path>${path}</path>`}]}]}}};
  const session={snapshotEvents:()=>[call,result]};
  assert.equal(inspectedExternalImage(session,path),false);
  result.data.message.content[0].content.push({type:'image',attachment:{attachmentId:'actual'}});
  assert.equal(inspectedExternalImage(session,path),true);
  result.data.message.content[0].isError=true;
  assert.equal(inspectedExternalImage(session,path),false);
});

test('external image evidence accepts Harness 0.2 direct read_image result',async()=>{
  const {inspectedExternalImage}=await import('../src/media-tool.mjs');
  const path=join(tmpdir(),'actor.png');
  const events=[
    {seq:1,type:'tool/call',data:{callId:'c',name:'read_image'}},
    {seq:2,type:'tool/result',data:{message:{role:'tool',source:{kind:'tool',callId:'c'},toolCallId:'c',isError:false,content:[
      {type:'text',text:`<path>${path}</path>`},
      {type:'image',attachment:{attachmentId:'sha256:'+'a'.repeat(64)}},
    ]}}},
  ];
  assert.equal(inspectedExternalImage({snapshotEvents:()=>events},path),true);
  events[1].data.message.isError=true;
  assert.equal(inspectedExternalImage({snapshotEvents:()=>events},path),false);
});

test('shot proposal preserves ordered bindings to registered media without approving production',async()=>{
  const {createMediaTool}=await import('../src/media-tool.mjs');
  const cwd=await mkdtemp(join(tmpdir(),'dsh-proposal-'));
  await writeFile(join(cwd,'actor-a.png'),Buffer.from('89504e470d0a1a0a0000000000000000','hex'));
  const tool=createMediaTool({store:createMediaStore({root:join(cwd,'state')}),fs:localFs()});
  const proposal={version:'v2',shots:[{shot_id:'s1',clip_id:'c1',duration_seconds:4,content:'Alex spots the empty cup.',dialogue:'Nice coffee.',transition:'Match cut to the cup.',incoming_state:'Cup on table.',ending_state:'Alex lifts cup.',reference_numbers:[1]}]};
  const result=await tool.execute({items:[{path:'actor-a.png',responsibility:'Actor identity'}],proposal},{agent:{session:{id:'s',header:{cwd}}}});
  assert.deepEqual(result.proposal,proposal);
  assert.equal(result.approved,undefined);
  assert.equal(result.items[0].filename,'actor-a.png');
  await assert.rejects(tool.execute({items:[{path:'actor-a.png'}],proposal:{...proposal,shots:[{...proposal.shots[0],reference_numbers:[2]}]}},{agent:{session:{id:'s',header:{cwd}}}}),/reference/i);
  await assert.rejects(tool.execute({items:[{path:'actor-a.png'}],proposal:{...proposal,shots:[{...proposal.shots[0],duration_seconds:-1}]}},{agent:{session:{id:'s',header:{cwd}}}}),/duration/i);
});

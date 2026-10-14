import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createMediaTool} from '../src/media-tool.mjs';
import {createMediaStore} from '../src/media-store.mjs';
import {localFs} from './harness.mjs';
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'director-assets-')),cwd=join(root,'work');await mkdir(cwd);
  const path=join(root,'upload-without-extension');await writeFile(path,png);
  const events=[{seq:1,type:'user/message',data:{source:{kind:'user'},content:[{type:'image',attachment:{attachmentId:'sha256:'+createHash('sha256').update(png).digest('hex'),name:'original.png',mediaType:'image/png'}}]}}];
  const exec={agent:{session:{id:'one',header:{cwd},surface:{nodes:[]},snapshotEvents:()=>events}}};
  const options={root:join(root,'catalog'),fs:localFs(),attachments:{imageHostPath:()=>path}};
  const mod=await import('../src/asset-catalog.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e});
  assert.equal(typeof mod.createAssetTool,'function','director assets must resolve durable uploads');
  const tool=mod.createAssetTool(options);
  const inspect=()=>events.push({seq:events.length+1,time:Date.now()+1000,type:'tool/call',data:{callId:'r'+events.length,name:'read_image'}},{seq:events.length+2,time:Date.now()+1000,type:'tool/result',data:{message:{content:[{type:'tool-result',toolCallId:'r'+events.length,content:[{type:'text',text:`<path>${path}</path>`},{type:'image',attachment:{attachmentId:'seen'}}]}]}}});
  return {path,events,exec,options,tool,create:mod.createAssetTool,inspect,cwd};
}
test('compacted uploads retain real path and filename without guessing tags or suffix',async()=>{
  const f=await fixture();const result=await f.tool.execute({},f.exec);
  assert.equal(result.assets[0].source_path,f.path);assert.equal(result.assets[0].name,'original.png');
  assert.deepEqual(result.assets[0].roles,[]);assert.equal(result.assets[0].availability,'available');
  assert.equal(result.assets[0].inspected,false);
});
test('observed labels persist across instances; changed bytes invalidate labels and sessions stay isolated',async()=>{
  const f=await fixture();await assert.rejects(f.tool.execute({action:'register',items:[{path:f.path,roles:['costume'],observation:'Teal bodysuit'}]},f.exec),/read_image/);
  f.inspect();await f.tool.execute({action:'register',items:[{path:f.path,name:'Costume',roles:['costume'],observation:'Teal bodysuit',shot_ids:['s1']}]},f.exec);
  const tool=f.create(f.options);const list=await tool.execute({query:'teal'},f.exec);
  assert.equal(list.assets.length,1);assert.deepEqual(list.assets[0].shot_ids,['s1']);
  const other={agent:{session:{...f.exec.agent.session,id:'two',snapshotEvents:()=>[]}}};
  assert.equal((await tool.execute({},other)).assets.length,0);
  await writeFile(f.path,Buffer.concat([png,Buffer.from('changed')]));
  const changed=(await tool.execute({},f.exec)).assets[0];assert.equal(changed.availability,'changed');assert.deepEqual(changed.roles,[]);assert.equal(changed.observation,undefined);
  await unlink(f.path);assert.equal((await tool.execute({},f.exec)).assets[0].availability,'missing');
});
test('workspace folder assets can be registered; no folder or global drive scan is implicit',async()=>{
  const f=await fixture();const path=join(f.cwd,'scene.png');await writeFile(path,png);
  await f.tool.execute({action:'register',items:[{path}]},f.exec);
  const list=await f.create(f.options).execute({limit:1},f.exec);
  assert.equal(list.total,2);assert.equal(list.assets.length,1);assert.equal(list.next_offset,1);
});

test('an old visual read cannot label overwritten bytes',async()=>{
  const f=await fixture();f.inspect();
  for(const event of f.events)if(event.time)event.time=1;
  await assert.rejects(f.tool.execute({action:'register',items:[{path:f.path,roles:['actor']}]},f.exec),/read_image|changed/);
});

function exposeCurrentUpload(f){
  f.events.push({seq:2,type:'assistant/message',data:{message:{source:{kind:'model'},content:[]}}});
  f.exec.agent.session.surface.nodes=[1,2];
}
test('current human upload followed by a model response can be labeled without a duplicate read_image',async()=>{
  const f=await fixture();exposeCurrentUpload(f);
  const result=await f.tool.execute({action:'register',items:[{path:f.path,roles:['actor'],observation:'Visible portrait'}]},f.exec);
  assert.equal(result.assets[0].inspected,true);
  assert.deepEqual(result.assets[0].roles,['actor']);
  f.exec.agent.session.surface.nodes=[2];
  await assert.rejects(f.tool.execute({action:'register',items:[{path:f.path,roles:['costume']}]},f.exec),/read_image/);
});
test('current upload evidence rejects overwritten bytes, nonhuman images and missing model consumption',async()=>{
  for(const change of ['bytes','source','response','nonmodel','unmapped','wrong-path']){
    const f=await fixture();exposeCurrentUpload(f);
    if(change==='bytes')await writeFile(f.path,Buffer.concat([png,Buffer.from('changed')]));
    if(change==='source')f.events[0].data.source.kind='plugin';
    if(change==='response')f.exec.agent.session.surface.nodes=[1];
    if(change==='nonmodel')f.events[1].data.message.source.kind='plugin';
    if(change==='unmapped')f.options.attachments.imageHostPath=()=>undefined;
    if(change==='wrong-path')f.options.attachments.imageHostPath=()=>join(f.cwd,'different.png');
    await assert.rejects(f.tool.execute({action:'register',items:[{path:f.path,roles:['actor']}]},f.exec),/read_image|changed/);
  }
});
test('review display accepts a byte-verified current upload, but rejects a modified file',async()=>{
  const f=await fixture();exposeCurrentUpload(f);
  const media=createMediaTool({store:createMediaStore({root:join(f.cwd,'media')}),fs:f.options.fs,attachments:f.options.attachments});
  const shown=await media.execute({items:[{path:f.path,responsibility:'Actor identity'}]},f.exec);
  assert.equal(shown.items[0].sha256,createHash('sha256').update(png).digest('hex'));
  await writeFile(f.path,Buffer.concat([png,Buffer.from('changed')]));
  await assert.rejects(media.execute({items:[{path:f.path}]},f.exec),/changed|read_image/);
});

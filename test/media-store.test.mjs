import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,unlink,symlink,rename,stat,utimes,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localFs} from './harness.mjs';

const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'dsh-director-test-'));
  const cwd=join(root,'workspace');await mkdir(cwd);
  const path=join(cwd,'a.png');await writeFile(path,png);
  const {createMediaStore}=await import('../src/media-store.mjs');
  const store=createMediaStore({root:join(root,'media')});
  return {store,root,cwd,path,input:{sessionId:'session-test',cwd,path,fs:localFs()}};
}
test('registered media survives a fresh store and refuses another session',async()=>{
  const f=await fixture();const item=await f.store.register(f.input);
  assert.match(item.id,/^[A-Za-z0-9_-]{43}$/);
  const {createMediaStore}=await import('../src/media-store.mjs');
  const next=createMediaStore({root:join(f.root,'media')});
  assert.equal((await next.lookup(item.id,'session-test')).sha256,item.sha256);
  await assert.rejects(next.lookup(item.id,'other'),/not found/i);
  const opened=await next.openVerified(item.id,'session-test');
  assert.equal(opened.size,png.length);await opened.handle.close();
});
test('changed same-size bytes and deleted sources cannot replay under original ID',async()=>{
  const f=await fixture();const item=await f.store.register(f.input);
  const changed=Buffer.from(png);changed[30]^=1;await writeFile(f.path,changed);
  await assert.rejects(f.store.openVerified(item.id,'session-test'),/changed/i);
  await unlink(f.path);await assert.rejects(f.store.openVerified(item.id,'session-test'),/unavailable/i);
});
test('archived playback survives source moves, replacement and deletion while production rejects them',async()=>{
  const f=await fixture(),item=await f.store.register(f.input),moved=join(f.cwd,'renamed.png');
  const assertPlayback=async store=>{
    const opened=await (store.openForPlayback??store.openVerified)(item.id,'session-test');
    try{assert.deepEqual(await opened.handle.readFile(),png);}finally{await opened.handle.close();}
  };
  await rename(f.path,moved);
  await assertPlayback(f.store);
  await assert.rejects((f.store.openOriginal??f.store.openVerified)(item.id,'session-test'),/unavailable/i);
  const changed=Buffer.from(png);changed[30]^=1;await writeFile(f.path,changed);
  await assertPlayback(f.store);
  await assert.rejects((f.store.openOriginal??f.store.openVerified)(item.id,'session-test'),/changed/i);
  await unlink(f.path);
  const {createMediaStore}=await import('../src/media-store.mjs');
  await assertPlayback(createMediaStore({root:join(f.root,'media')}));
  await assert.rejects((f.store.openForPlayback??f.store.openVerified)(item.id,'other'),/not found/i);
});
test('unchanged snapshots reuse integrity verification and detect same-size tampering with restored mtime',async t=>{
  const f=await fixture(),item=await f.store.register(f.input),snapshot=join(f.root,'media',item.id+'.bin');
  const probe=await open(snapshot,'r'),prototype=Object.getPrototypeOf(probe),read=prototype.read;
  await probe.close();let reads=0;
  prototype.read=async function(...args){reads++;return read.apply(this,args);};
  t.after(()=>{prototype.read=read;});
  const first=await (f.store.openForPlayback??f.store.openVerified)(item.id,'session-test');await first.handle.close();
  assert.ok(reads>0);reads=0;
  for(let i=0;i<3;i++){const next=await (f.store.openForPlayback??f.store.openVerified)(item.id,'session-test');await next.handle.close();}
  assert.equal(reads,0,'unchanged Range/HEAD requests must not hash the full snapshot again');
  const before=await stat(snapshot),changed=Buffer.from(png);changed[30]^=1;
  await writeFile(snapshot,changed);await utimes(snapshot,before.atime,before.mtime);
  await assert.rejects((f.store.openForPlayback??f.store.openVerified)(item.id,'session-test'),/stored media changed/i);
  assert.ok(reads>0,'a changed stat must force content verification');
});
test('missing and corrupt snapshots remain explicit archive errors even with a valid source',async()=>{
  const f=await fixture(),item=await f.store.register(f.input),snapshot=join(f.root,'media',item.id+'.bin');
  await writeFile(snapshot,'bad');
  await assert.rejects((f.store.openForPlayback??f.store.openVerified)(item.id,'session-test'),/stored media changed/i);
  await unlink(snapshot);
  await assert.rejects((f.store.openForPlayback??f.store.openVerified)(item.id,'session-test'),/stored media unavailable/i);
});
test('outside workspace is refused without inspected-source authorization',async()=>{
  const f=await fixture();const path=join(f.root,'outside.png');await writeFile(path,png);
  await assert.rejects(f.store.register({...f.input,path}),/outside/i);
  const item=await f.store.register({...f.input,path,externalEvidence:true});
  assert.equal(item.type,'image');
});

test('extensionless uploaded image can display without renaming or changing source bytes',async()=>{
  const f=await fixture(),path=join(f.root,'attachment-hash');await writeFile(path,png);
  const item=await f.store.register({...f.input,path,externalEvidence:true});
  assert.equal(item.type,'image');assert.equal(item.mime,'image/png');assert.equal(item.filename,'attachment-hash.png');
  const opened=await f.store.openVerified(item.id,'session-test');assert.equal(opened.source,path);await opened.handle.close();
});
test('generated FLAC and MP3 audio can be registered, but mislabeled bytes are rejected',async()=>{
  const f=await fixture();
  for(const [name,bytes,mime] of [
    ['song.flac',Buffer.from('664c614300000022','hex'),'audio/flac'],
    ['song.mp3',Buffer.from('49443304000000000000','hex'),'audio/mpeg']
  ]){
    const path=join(f.cwd,name);await writeFile(path,bytes);
    const item=await f.store.register({...f.input,path});
    assert.equal(item.type,'audio');assert.equal(item.mime,mime);
    const opened=await f.store.openVerified(item.id,'session-test');assert.equal(opened.size,bytes.length);await opened.handle.close();
  }
  const bad=join(f.cwd,'bad.flac');await writeFile(bad,Buffer.from('not audio'));
  await assert.rejects(f.store.register({...f.input,path:bad}),/signature/i);
});
test('signature mismatch, URLs, symlink escape, unmapped backend and cancellation fail closed',async()=>{
  const f=await fixture();await writeFile(f.path,'<html>not an image</html>');
  await assert.rejects(f.store.register(f.input),/signature/i);
  await assert.rejects(f.store.register({...f.input,path:'http://evil.example/image.png'}),/local/i);
  await writeFile(f.path,png);const outside=join(f.root,'outside.png');await writeFile(outside,png);
  const link=join(f.cwd,'escape');await symlink(f.root,link,'junction');
  await assert.rejects(f.store.register({...f.input,path:join(link,'outside.png')}),/outside/i);
  await assert.rejects(f.store.register({...f.input,fs:{...f.input.fs,resolve:()=>{},processPathFromHostPath:()=>undefined}}));
  const c=new AbortController();c.abort();await assert.rejects(f.store.register({...f.input,signal:c.signal}));
});

test('internal workspace junctions cannot become gallery source files',async()=>{
  const f=await fixture(),link=join(f.cwd,'alias');await symlink(f.cwd,link,'junction');
  await assert.rejects(f.store.register({...f.input,path:join(link,'a.png')}),/link|junction/i);
});

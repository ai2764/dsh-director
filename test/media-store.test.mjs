import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,unlink,symlink} from 'node:fs/promises';
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

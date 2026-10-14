import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, access, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {gzipSync} from 'node:zlib';
import * as guides from '../src/skills.mjs';

// Synthetic upstream documents: never copy official guide text into fixtures.
const payloads = new Map([
  ['references/upstream-SKILL.md', '# Synthetic upstream skill\n'],
  ['references/ref-en.txt', 'Synthetic reference guide.\n'],
  ['references/base-en.txt', 'Synthetic shared guide.\n'],
  ['LICENSE.minimax-h3', 'Synthetic license fixture.\n'],
]);
const manifest = {
  revision: 'a'.repeat(40), source: 'https://github.com/example/fixture',
  licenseUrl: 'https://example.invalid/pinned-license',
  files: [...payloads].map(([path, text]) => ({path, url: 'https://example.invalid/'+path,
    bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex')})),
};
async function fixture(options={}) {
  assert.equal(typeof guides.createH3GuideStore, 'function', 'The provider needs a consent-gated external guide cache');
  const root=await mkdtemp(join(tmpdir(),'director-guides-'));
  const requests=[],questions=[];
  const ask=async request=>{
    questions.push(request);
    assert.equal(request.questions.length,1);
    return {answers:[{id:request.questions[0].id,selected:[guides.H3_DOWNLOAD_ACCEPT]}]};
  };
  const fetchImpl=async(url,init)=>{
    requests.push({url,init});
    const entry=manifest.files.find(file=>file.url===url);
    assert.ok(entry,'Only manifest URLs may be requested');
    return new Response(payloads.get(entry.path));
  };
  const store=guides.createH3GuideStore({cacheRoot:root,manifest,fetchImpl,...options});
  return {root,store,requests,questions,ask};
}

test('startup, skill discovery and missing-guide reads are offline and read-only',async()=>{
  const f=await fixture();
  assert.equal((await f.store.status()).available,false);
  const provider=await guides.createBundledProvider(undefined,{guideStore:f.store});
  const {candidates}=await provider.list();
  assert.deepEqual(candidates.map(c=>c.name).sort(),['director','h3-prompt-writing']);
  const h3=await provider.get(candidates.find(c=>c.name==='h3-prompt-writing'));
  assert.match(h3.content,/director_h3_skill/);
  assert.equal((await f.store.status()).available,false);
  assert.equal(f.requests.length,0);assert.equal(f.questions.length,0);
  await assert.rejects(access(join(f.root,'h3')),/ENOENT/);
});

test('installation asks through the native human seam before downloading pinned files',async()=>{
  const f=await fixture();
  const result=await f.store.install({ask:async req=>{
    assert.equal(f.requests.length,0,'No download before human confirmation');
    assert.match(req.questions[0].question,/https:\/\/github.com\/example\/fixture/);
    assert.match(req.questions[0].question,/https:\/\/example.invalid\/pinned-license/);
    return f.ask(req);
  },agent:{id:'root'}});
  assert.equal(result.available,true);assert.equal(f.questions.length,1);
  assert.equal(f.questions[0].agent.id,'root');
  assert.equal(f.requests.length,4);
  assert.ok(f.requests.every(r=>r.init.redirect==='error'));
  for(const [path,text]of payloads)assert.equal(await readFile(join(result.directory,path),'utf8'),text);
  const provider=await guides.createBundledProvider(undefined,{guideStore:f.store});
  const {candidates}=await provider.list();
  const h3=await provider.get(candidates.find(c=>c.name==='h3-prompt-writing'));
  assert.equal(h3.resourceBase.path,result.directory);
  assert.equal(await readFile(join(h3.resourceBase.path,'references/ref-en.txt'),'utf8'),'Synthetic reference guide.\n');
  await access(join(h3.resourceBase.path,'references/UPSTREAM.md'));
});

test('decline, custom or malformed answers, missing UI and cancellation never download',async()=>{
  for(const mode of ['decline','custom','wrong-id','multiple','missing','abort','abort-after-consent']){
    const f=await fixture();
    const controller=new AbortController();if(mode==='abort')controller.abort();
    const ask=mode==='missing'?undefined:async req=>{if(mode==='abort-after-consent')controller.abort();return {answers:[{
      id:mode==='wrong-id'?'other':req.questions[0].id,
      selected:mode==='multiple'?[guides.H3_DOWNLOAD_ACCEPT,'Not now']:mode==='decline'?['Not now']:mode==='custom'?[]:[guides.H3_DOWNLOAD_ACCEPT],
      ...(mode==='custom'?{custom:'yes'}:{}),
    }]};};
    await assert.rejects(f.store.install({ask,signal:controller.signal}),/confirm|consent|declin|abort|cancel|human/i);
    assert.equal(f.requests.length,0);assert.equal((await f.store.status()).available,false);
  }
});

test('verified cache survives a new provider offline without another prompt or download',async()=>{
  const f=await fixture(),installed=await f.store.install({ask:f.ask});
  const offline=guides.createH3GuideStore({cacheRoot:f.root,manifest,fetchImpl:async()=>{throw Error('Network forbidden');}});
  const result=await offline.install({});
  assert.equal(result.directory,installed.directory);assert.equal(result.available,true);
  assert.equal(f.questions.length,1);assert.equal(f.requests.length,4);
});

test('concurrent setup calls share one human question and one verified download',async()=>{
  const f=await fixture();
  const [a,b]=await Promise.all([f.store.install({ask:f.ask}),f.store.install({ask:f.ask})]);
  assert.equal(a.directory,b.directory);
  assert.equal(f.questions.length,1);assert.equal(f.requests.length,4);
});

test('real gzip transport verifies decoded bytes, not compressed Content-Length',async t=>{
  let requests=0;
  const server=createServer((req,res)=>{
    requests++;
    const entry=manifest.files.find(file=>'/'+file.path===req.url);
    if(!entry){res.writeHead(404);res.end();return;}
    const compressed=gzipSync(payloads.get(entry.path));
    res.writeHead(200,{'Content-Encoding':'gzip','Content-Length':compressed.length});
    res.end(compressed);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const remote={...manifest,files:manifest.files.map(file=>({...file,url:origin+'/'+file.path}))};
  const f=await fixture({manifest:remote,fetchImpl:globalThis.fetch});
  assert.equal((await f.store.install({ask:f.ask})).available,true);
  assert.equal(requests,4);
});

test('bad hashes, failed HTTP, redirects and oversized bodies never publish a cache',async()=>{
  for(const mode of ['hash','http','redirect','oversize']){
    const f=await fixture({fetchImpl:async()=>{
      if(mode==='http')return new Response('failure',{status:503});
      if(mode==='redirect')return new Response('',{status:302,headers:{Location:'https://elsewhere.invalid'}});
      return new Response(mode==='oversize'?'x'.repeat(200000):'x'.repeat(manifest.files[0].bytes));
    }});
    await assert.rejects(f.store.install({ask:f.ask}),/hash|size|bytes|HTTP|download|redirect|integrity/i);
    assert.equal((await f.store.status()).available,false);
  }
});

test('modified cached bytes fail closed and never overwrite user-owned skills',async()=>{
  const f=await fixture();
  const userSkill=join(f.root,'.agents/skills/h3-prompt-writing/SKILL.md');
  await mkdir(join(f.root,'.agents/skills/h3-prompt-writing'),{recursive:true});
  await writeFile(userSkill,'# User skill must survive\n');
  const installed=await f.store.install({ask:f.ask});
  await writeFile(join(installed.directory,'references/ref-en.txt'),'modified');
  assert.equal((await f.store.status()).available,false);
  await assert.rejects(f.store.install({ask:f.ask}),/integrity|corrupt|cache/i);
  assert.equal(await readFile(userSkill,'utf8'),'# User skill must survive\n');
  assert.equal(await readFile(join(installed.directory,'references/ref-en.txt'),'utf8'),'modified');
});

test('the setup tool cannot treat model arguments as human download consent',async()=>{
  const f=await fixture();
  assert.equal(typeof guides.createH3GuideTool,'function');
  const tool=guides.createH3GuideTool({guideStore:f.store});
  await assert.rejects(tool.execute({action:'install',accepted:true},{agent:{id:'root'}}),/confirm|consent|human|argument/i);
  assert.equal(f.requests.length,0);
  assert.equal((await tool.execute({action:'status'},{})).available,false);
});

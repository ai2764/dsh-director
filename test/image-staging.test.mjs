import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,unlink,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {localFs} from './harness.mjs';
import {createServer} from 'node:http';

const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'dsh-stage-test-')),cwd=join(root,'workspace');await mkdir(cwd);
  const path=join(cwd,'actor.png');await writeFile(path,png);
  const module=await import('../src/image-staging.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
  assert.equal(typeof module.createStageImagesTool,'function','image staging must be a real reusable tool');
  const files=new Map(),requests=[],uploads=[];
  const fetchImpl=async(input,init={})=>{
    const url=new URL(input);requests.push({url,init});assert.equal(url.origin,'http://comfy.test:8188');assert.equal(init.redirect,'error');
    if(url.pathname==='/view'){
      const key=[url.searchParams.get('subfolder'),url.searchParams.get('filename')].filter(Boolean).join('/');
      assert.equal(url.searchParams.get('type'),'input');return files.has(key)?new Response(files.get(key)):new Response('',{status:404});
    }
    assert.equal(url.pathname,'/upload/image');assert.equal(init.method,'POST');
    const form=init.body;assert.ok(form instanceof FormData);assert.equal(form.get('type'),'input');assert.equal(form.get('overwrite'),'false');
    const file=form.get('image'),bytes=Buffer.from(await file.arrayBuffer());assert.equal(file.type,'image/png');
    const subfolder=form.get('subfolder');let name=file.name,key=subfolder+'/'+name;
    if(files.has(key)){name='collision-'+uploads.length+'.png';key=subfolder+'/'+name;}
    files.set(key,bytes);uploads.push({key,bytes});return Response.json({name,subfolder,type:'input'});
  };
  const options={root:join(root,'state'),fs:localFs(),comfyBaseUrl:'http://comfy.test:8188',fetchImpl};
  const tool=module.createStageImagesTool(options),exec={agent:{session:{id:'s',header:{cwd}}},concludeTurn(){assert.fail('staging must not end the turn');}};
  return {root,cwd,path,files,requests,uploads,options,tool,exec,create:module.createStageImagesTool};
}

test('stage original bytes once and reuse verified binding from a fresh tool instance',async()=>{
  const f=await fixture();const first=await f.tool.execute({source_paths:[f.path]},f.exec);
  assert.equal(first.images.length,1);assert.equal(first.images[0].reused,false);
  assert.equal(first.images[0].source_path,f.path);assert.equal(first.images[0].sha256,createHash('sha256').update(png).digest('hex'));
  assert.match(first.images[0].image,/^dsh-director\/[a-f0-9]{64}\.png$/);assert.deepEqual(f.uploads[0].bytes,png);
  const second=await f.create(f.options).execute({source_paths:[f.path]},f.exec);
  assert.equal(second.images[0].image,first.images[0].image);assert.equal(second.images[0].reused,true);assert.equal(f.uploads.length,1);
  assert.ok(f.requests.every(r=>!r.url.pathname.includes('object_info')),'never enumerate the image library');
  assert.ok(f.tool.output.render({},second)[0].text.length<1200,'model receives selected bindings, not schema or image bytes');
});

test('changed local image gets a new binding and never overwrites the previous asset',async()=>{
  const f=await fixture(),first=await f.tool.execute({source_paths:[f.path]},f.exec);
  const changed=Buffer.from(png);changed[30]^=1;await writeFile(f.path,changed);
  const second=await f.tool.execute({source_paths:[f.path]},f.exec);
  assert.notEqual(second.images[0].image,first.images[0].image);assert.notEqual(second.images[0].sha256,first.images[0].sha256);
  assert.deepEqual(f.files.get(first.images[0].image),png);assert.deepEqual(f.files.get(second.images[0].image),changed);
});

test('missing or mismatched remote asset is repaired and the returned collision name is reusable',async()=>{
  const f=await fixture();const first=await f.tool.execute({source_paths:[f.path]},f.exec);
  f.files.set(first.images[0].image,Buffer.from('different bytes'));
  const repaired=await f.tool.execute({source_paths:[f.path]},f.exec);
  assert.equal(repaired.images[0].reused,false);assert.notEqual(repaired.images[0].image,first.images[0].image);
  const again=await f.create(f.options).execute({source_paths:[f.path]},f.exec);
  assert.equal(again.images[0].reused,true);assert.equal(again.images[0].image,repaired.images[0].image);assert.equal(f.uploads.length,2);
  f.files.delete(again.images[0].image);const restored=await f.tool.execute({source_paths:[f.path]},f.exec);
  assert.equal(restored.images[0].reused,false);assert.deepEqual(f.files.get(restored.images[0].image),png);
});

test('extensionless uploaded attachment keeps source path and bytes but gets a usable image suffix',async()=>{
  const f=await fixture(),path=join(f.root,'uploaded-hash');await writeFile(path,png);
  f.exec.agent.session.snapshotEvents=()=>[
    {type:'tool/call',data:{callId:'read',name:'read_image'}},
    {type:'tool/result',data:{message:{content:[{type:'tool-result',toolCallId:'read',content:[
      {type:'text',text:`<path>${path}</path>`},{type:'image',attachment:{attachmentId:'a'}}]}]}}},
  ];
  const result=await f.tool.execute({source_paths:[path]},f.exec);
  assert.equal(result.images[0].source_path,path);assert.match(result.images[0].image,/\.png$/);assert.deepEqual(f.uploads[0].bytes,png);
  assert.deepEqual(await readFile(path),png);
});

test('URLs, uninspected external sources, symlink escapes, unsupported bytes and cancellation fail before upload',async()=>{
  const f=await fixture(),outside=join(f.root,'outside.png');await writeFile(outside,png);
  await assert.rejects(f.tool.execute({source_paths:['http://evil.test/a.png']},f.exec),/local/i);
  await assert.rejects(f.tool.execute({source_paths:[outside]},f.exec),/read_image|inspect|outside/i);
  const link=join(f.cwd,'escape');await symlink(f.root,link,'junction');
  await assert.rejects(f.tool.execute({source_paths:[join(link,'outside.png')]},f.exec),/read_image|inspect|outside/i);
  await writeFile(f.path,'<html>bad</html>');await assert.rejects(f.tool.execute({source_paths:[f.path]},f.exec),/signature|image/i);
  const abort=new AbortController();abort.abort();await assert.rejects(f.tool.execute({source_paths:[f.path]},{...f.exec,signal:abort.signal}));
  assert.equal(f.uploads.length,0);assert.equal(f.requests.length,0);
});

test('transport failure and failed byte verification are not treated as permission to overwrite or upload again',async()=>{
  const f=await fixture();
  const fail=f.create({...f.options,fetchImpl:async()=>{throw new Error('offline');}});
  await assert.rejects(fail.execute({source_paths:[f.path]},f.exec),/offline/);
  const corrupt=f.create({...f.options,fetchImpl:async(url,init)=>new URL(url).pathname==='/view'?new Response('wrong bytes'):f.options.fetchImpl(url,init)});
  await assert.rejects(corrupt.execute({source_paths:[f.path]},f.exec),/verify|bytes|mismatch/i);
  assert.equal(f.uploads.length,1); // one explicit upload only; no retry loop
});

test('configured origin, source count, missing files and size limit are enforced',async()=>{
  const f=await fixture();await assert.rejects(f.tool.execute({source_paths:[]},f.exec),/1.*9/);
  await assert.rejects(f.tool.execute({source_paths:Array(10).fill(f.path)},f.exec),/1.*9/);
  await assert.rejects(f.create({...f.options,maxBytes:8}).execute({source_paths:[f.path]},f.exec),/size|oversized|limit/i);
  await unlink(f.path);await assert.rejects(f.tool.execute({source_paths:[f.path]},f.exec),/unavailable|file/i);
  assert.equal(f.uploads.length,0);
});

test('redirects cannot leak reference bytes to a different service',async t=>{
  const f=await fixture();let forwarded=0;
  const target=createServer((req,res)=>{forwarded++;res.end('unexpected');});
  await new Promise(r=>target.listen(0,'127.0.0.1',r));
  const source=createServer((req,res)=>{
    if(req.url.startsWith('/view')){res.writeHead(404);res.end();}
    else{res.writeHead(307,{Location:`http://127.0.0.1:${target.address().port}/upload/image`});res.end();}
  });
  await new Promise(r=>source.listen(0,'127.0.0.1',r));
  t.after(()=>{source.closeAllConnections();source.close();target.closeAllConnections();target.close();});
  const tool=f.create({...f.options,comfyBaseUrl:`http://127.0.0.1:${source.address().port}`,fetchImpl:globalThis.fetch});
  await assert.rejects(tool.execute({source_paths:[f.path]},f.exec),/redirect|fetch failed/i);assert.equal(forwarded,0);
});

test('a saved binding from another ComfyUI origin is never reused as current endpoint evidence',async()=>{
  const f=await fixture(),first=await f.tool.execute({source_paths:[f.path]},f.exec);
  let uploaded=0;
  const second=f.create({...f.options,comfyBaseUrl:'http://second.test:8000',fetchImpl:async(url,init={})=>{
    assert.equal(new URL(url).origin,'http://second.test:8000');
    if(new URL(url).pathname==='/view')return uploaded?new Response(png):new Response('',{status:404});
    uploaded++;assert.deepEqual(Buffer.from(await init.body.get('image').arrayBuffer()),png);
    return Response.json({name:first.images[0].image.split('/').at(-1),subfolder:'dsh-director',type:'input'});
  }});
  const value=await second.execute({source_paths:[f.path]},f.exec);assert.equal(value.images[0].reused,false);assert.equal(uploaded,1);
});

test('internal workspace junctions are rejected before contacting ComfyUI',async()=>{
  const f=await fixture(),link=join(f.cwd,'alias');await symlink(f.cwd,link,'junction');
  await assert.rejects(f.tool.execute({source_paths:[join(link,'actor.png')]},f.exec),/link|junction/i);
  assert.equal(f.requests.length,0);
});

test('cancellation during final remote verification cannot publish a successful binding',async()=>{
  const f=await fixture(),abort=new AbortController();
  const tool=f.create({...f.options,fetchImpl:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(png);controller.close();abort.abort();}}))});
  await assert.rejects(tool.execute({source_paths:[f.path]},{...f.exec,signal:abort.signal}),/abort/i);
  const {readdir}=await import('node:fs/promises');
  assert.deepEqual(await readdir(f.options.root).catch(e=>{if(e.code==='ENOENT')return [];throw e;}),[]);
});

test('null upload JSON receives an actionable binding error',async()=>{
  const f=await fixture(),tool=f.create({...f.options,fetchImpl:async url=>new URL(url).pathname==='/view'?new Response('',{status:404}):Response.json(null)});
  await assert.rejects(tool.execute({source_paths:[f.path]},f.exec),/unexpected input binding/i);
});

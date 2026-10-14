import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubmitComfyVideo} from '../src/submit-comfy-video.mjs';
import {createServer} from 'node:http';

test('configured Comfy and swap origins own every network request',async()=>{
  const urls=[];
  const submit=createSubmitComfyVideo({comfyBaseUrl:'http://comfy.example:8000',llamaSwapBaseUrl:'http://swap.example:9000',sleep:async()=>{},fetchImpl:async u=>{
    urls.push(String(u));
    return Response.json(String(u).endsWith('/prompt')?{prompt_id:'p'}:{});
  }});
  await submit({workflow:{1:{class_type:'Test',inputs:{}}}},{concludeTurn(){}});
  assert.deepEqual(urls,['http://comfy.example:8000/prompt','http://swap.example:9000/api/models/unload','http://swap.example:9000/running']);
});
test('service redirects cannot forward workflow bytes to another origin',async t=>{
  let forwarded=0;
  const target=createServer((req,res)=>{forwarded++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({prompt_id:'unrelated'}));});
  await new Promise(r=>target.listen(0,'127.0.0.1',r));
  const source=createServer((req,res)=>{
    if(req.url==='/prompt'){res.writeHead(307,{Location:`http://127.0.0.1:${target.address().port}/prompt`});res.end();}
    else{res.setHeader('Content-Type','application/json');res.end('{}');}
  });
  await new Promise(r=>source.listen(0,'127.0.0.1',r));
  t.after(()=>{source.closeAllConnections();source.close();target.closeAllConnections();target.close();});
  const origin=`http://127.0.0.1:${source.address().port}`;
  const submit=createSubmitComfyVideo({comfyBaseUrl:origin,llamaSwapBaseUrl:origin});
  await assert.rejects(submit({workflow:{1:{class_type:'Test',inputs:{}}}},{concludeTurn(){}}),/redirect|fetch failed/i);
  assert.equal(forwarded,0);
});

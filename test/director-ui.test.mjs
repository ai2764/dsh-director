import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

async function component(file,name){
  const built=await build({entryPoints:[file],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-dom'],jsx:'automatic'});
  const module={exports:{}};
  vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),setTimeout,clearTimeout});
  return module.exports[name];
}
async function render(t,Component,props){
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:3080'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(()=>root.unmount());dom.window.close();delete globalThis.window;delete globalThis.document;});
  await act(()=>root.render(React.createElement(Component,props)));
  return root;
}
const mediaId='m'.repeat(43);
const media={kind:'director-media',version:1,session_id:'s',title:'Coffee prank',items:[{id:mediaId,type:'image',mime:'image/png',filename:'actor-a.png',label:'Alex',responsibility:'Actor identity',url:`/director-media/${mediaId}?session=s`}],proposal:{version:'v3',shots:[{shot_id:'s1',clip_id:'c1',duration_seconds:4,content:'Alex picks up the empty cup.',dialogue:'Great coffee.',incoming_state:'Cup on table.',ending_state:'Cup in hand.',transition:'Match cut to Blake.',reference_numbers:[1]}]}};
const result=(name,text,error=false,subCalls=[])=>({kind:'tool-result',seq:2,time:2000,callId:name,call:{name,argsRaw:'{"path":"scene.json"}'},callTime:1000,content:[{type:'text',text}],isError:error,subCalls});
const connected={state:{getSnapshot:()=> 'connected',subscribe:()=>()=>{}}};

test('review displays clip Picture order separately from shot relevance and previews clip-wide-only references',async t=>{
  const MediaCard=await component('src/client/MediaCard.jsx','MediaCard');
  const value={...media,items:['a','b','c'].map((x,i)=>({...media.items[0],id:x.repeat(43),filename:`ref${i+1}.png`,label:`Asset ${i+1}`,url:`/director-media/${x.repeat(43)}?session=s`}))};
  value.proposal={version:'explicit',clip_references:[{clip_id:'C1',reference_numbers:[2,1,3]}],shots:[{...media.proposal.shots[0],clip_id:'C1',reference_numbers:[1]},{...media.proposal.shots[0],shot_id:'s2',clip_id:'C1',reference_numbers:[2]}]};
  await render(t,MediaCard,{block:result('director_show_media',JSON.stringify(value)),sessionId:'s'});
  assert.deepEqual([...document.querySelectorAll('[data-director-clip-order="C1"] li')].map(e=>e.textContent),['Picture 1 → Reference #2: Asset 2','Picture 2 → Reference #1: Asset 1','Picture 3 → Reference #3: Asset 3']);
  assert.equal(document.querySelector('[data-shot-id="s1"] .dsh-director-bound-ref span').textContent,'Reference #1 · Picture 2');
  assert.equal(document.querySelector('[data-director-clip-wide] img').alt,'Asset 3');
  assert.match(document.querySelector('[data-proposal-status]').textContent,/Awaiting confirmation/);
});

test('a valid review card renders and awaits fresh confirmation despite an earlier invalid clip map',async t=>{
  const MediaCard=await component('src/client/MediaCard.jsx','MediaCard');
  const bad=result('director_show_media',JSON.stringify({...media,proposal:{...media.proposal,version:'bad',clip_references:null}}));
  const block={...result('director_show_media',JSON.stringify(media)),seq:3};
  const nodes=new Map([['bad',{kind:'tool-call',data:{root:bad}}],['current',{kind:'tool-call',data:{root:block}}]]);
  const useChat=selector=>selector({order:['bad','current'],nodes});
  await render(t,MediaCard,{block,sessionId:'s',useChat});
  assert.equal(document.querySelector('[data-proposal-status]').dataset.proposalStatus,'awaiting_confirmation');
  assert.ok(document.querySelector('img'));
});

test('an empty explicit clip does not claim that reference inputs are connected',async t=>{
  const MediaCard=await component('src/client/MediaCard.jsx','MediaCard');
  const value={...media,proposal:{...media.proposal,clip_references:[{clip_id:'c1',reference_numbers:[]}],shots:[{...media.proposal.shots[0],reference_numbers:[]}]}};
  await render(t,MediaCard,{block:result('director_show_media',JSON.stringify(value)),sessionId:'s'});
  assert.match(document.querySelector('.dsh-director-missing-ref').textContent,/No references are connected to this clip/);
  assert.doesNotMatch(document.querySelector('.dsh-director-missing-ref').textContent,/still apply/);
});

test('an edit against invalid history explains the unknown baseline instead of promising confirmation will repair it',async t=>{
  const MediaCard=await component('src/client/MediaCard.jsx','MediaCard');
  const bad=result('director_show_media',JSON.stringify({...media,proposal:{...media.proposal,version:'bad',clip_references:null}}));
  const block={...result('director_show_media',JSON.stringify(media)),seq:4};
  const nodes=new Map([['bad',{kind:'tool-call',data:{root:bad}}],['edit',{kind:'user',data:{seq:3,source:{kind:'user'},content:[{type:'text',text:'Add a reference image'}]}}],['current',{kind:'tool-call',data:{root:block}}]]);
  const useChat=selector=>selector({order:['bad','edit','current'],nodes});
  await render(t,MediaCard,{block,sessionId:'s',useChat});
  assert.equal(document.querySelector('[data-proposal-status]').dataset.proposalStatus,'references_pending');
  assert.match(document.querySelector('.dsh-director-confirm-note').textContent,/invalid.*baseline|baseline.*invalid/i);
  assert.doesNotMatch(document.querySelector('.dsh-director-confirm-note').textContent,/then confirm/i);
});

test('review card follows human confirmation and superseding versions without losing references',async t=>{
  const MediaCard=await component('src/client/MediaCard.jsx','MediaCard');
  const block={...result('director_show_media',JSON.stringify(media)),seq:10};
  let nodes=[{key:'card',kind:'tool-call',data:{root:block}}];
  const useChat=selector=>selector({order:nodes.map(n=>n.key),nodes:{get:key=>nodes.find(n=>n.key===key)}});
  const root=await render(t,MediaCard,{block,sessionId:'s',useChat});
  assert.match(document.querySelector('.dsh-director-awaiting').textContent,/Awaiting confirmation/);
  nodes.push({key:'user',kind:'user',data:{seq:11,source:{kind:'user'},content:[{type:'text',text:'ok'}]}});
  await act(()=>root.render(React.createElement(MediaCard,{block,sessionId:'s',useChat})));
  assert.match(document.querySelector('.dsh-director-awaiting').textContent,/Confirmed/);
  assert.equal(document.querySelector('[data-proposal-status]').dataset.proposalStatus,'confirmed');
  nodes.push({key:'next',kind:'tool-call',data:{root:{...block,seq:12,content:[{type:'text',text:JSON.stringify({...media,proposal:{...media.proposal,version:'v4'}})}]}}});
  await act(()=>root.render(React.createElement(MediaCard,{block,sessionId:'s',useChat})));
  assert.match(document.querySelector('.dsh-director-awaiting').textContent,/Superseded/);
  assert.ok(document.querySelector('img'));
});

test('incomplete reference card shows missing references rather than asking to approve generation',async t=>{
  const MediaCard=await component('src/client/MediaCard.jsx','MediaCard');
  const pending={...media,proposal:{...media.proposal,pending_references:['White bodysuit layout']}};
  await render(t,MediaCard,{block:result('director_show_media',JSON.stringify(pending)),sessionId:'s'});
  assert.match(document.querySelector('.dsh-director-awaiting').textContent,/References pending/);
  assert.match(document.querySelector('.dsh-director-confirm-note').textContent,/cannot be approved/);
  assert.ok(document.body.textContent.includes('White bodysuit layout'));
});

// The production break caught here is rendering every completed call as its
// own visible row, or grouping across a visible message / active call / media.
test('consecutive completed chat nodes become one expandable history with all logs intact',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const tool=(key,name)=>({key,kind:'tool-call',data:{root:{...result(name,`${name} output`),callId:key}},location:{kind:'step',turn:{turn:1}}});
  const a=tool('a','read'),b=tool('b','pwsh'),c=tool('c','edit');
  const empty={key:'empty',kind:'assistant-step',data:{status:'settled',blocks:[{kind:'tool-call'}]}};
  const snapshot={order:['a','empty','b','c'],nodes:{get:key=>[a,empty,b,c].find(n=>n.key===key)}};
  function Flow(){return React.createElement('div',{},...[a,b,c].map(node=>React.createElement(ToolTimeline,{key:node.key,node,sessionId:'s',useChat:selector=>selector(snapshot)})));}
  await render(t,Flow,{});
  const history=document.querySelector('.dsh-director-tool-history');assert.ok(history,'completed rows need one shared disclosure');
  assert.equal(history.open,false);assert.match(history.querySelector('summary').textContent,/Completed.*3 tool calls/);
  assert.equal(document.querySelectorAll('.dsh-director-tool-history').length,1);
  assert.equal(document.querySelectorAll('[data-director-history-member]').length,2);
  await act(()=>history.querySelector('summary').click());assert.equal(history.open,true);
  assert.deepEqual([...history.querySelectorAll('[data-chat-call-id]')].map(e=>e.dataset.chatCallId),['a','b','c']);
  for(const name of ['read','pwsh','edit'])assert.ok(history.textContent.includes(`${name} output`));
});

test('history grouping stops at text, failures, media and running calls and folds new results',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const tool=(key,block)=>({key,kind:'tool-call',data:{root:{...block,callId:key}},location:{kind:'step',turn:{turn:1}}});
  const a=tool('a',result('read','Before')),text={key:'text',kind:'assistant-step',data:{status:'settled',blocks:[{kind:'text',text:'Keep this message'}]}};
  const b=tool('b',result('edit','After')),error=tool('error',result('pwsh','Failed\n[exit code: 1]'));error.data.root.call.argsRaw='{"description":"Run work"}';
  const gallery=tool('media',result('director_show_media',JSON.stringify(media)));
  let active=tool('active',{name:'pwsh',argsRaw:'{}',time:2000,subCalls:[]});
  function Flow(){const nodes=[a,text,b,error,gallery,active],snapshot={order:nodes.map(n=>n.key),nodes:{get:key=>nodes.find(n=>n.key===key)}};return React.createElement('div',{},...nodes.map(node=>node.kind==='tool-call'?React.createElement(ToolTimeline,{key:node.key,node,sessionId:'s',useChat:selector=>selector(snapshot)}):React.createElement('p',{key:node.key},'Keep this message')));}
  const root=await render(t,Flow,{});
  assert.equal(document.querySelectorAll('.dsh-director-tool-history').length,2,'text and errors must break history groups');
  assert.ok(document.querySelector('[data-shot-id="s1"]'));assert.equal(document.querySelector('[data-shot-id="s1"]').closest('.dsh-director-tool-history'),null);
  assert.equal(document.querySelector('[role="alert"]').closest('.dsh-director-tool-history'),null);
  assert.equal(document.querySelector('[data-chat-call-id="active"] details').open,true);
  active=tool('active',result('pwsh','Finished'));
  await act(()=>root.render(React.createElement(Flow)));
  assert.equal(document.querySelectorAll('.dsh-director-tool-history').length,3);
  assert.equal(document.querySelector('[data-chat-call-id="active"] details').open,false);
});

test('history respects turn boundaries and keeps deliberate expansion when another result arrives',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const node=(key,turn)=>({key,kind:'tool-call',location:{kind:'step',turn:{turn}},data:{root:{...result('read',key),callId:key}}});
  let nodes=[node('a',1),node('b',2)];
  function Flow(){const snapshot={order:nodes.map(n=>n.key),nodes:{get:key=>nodes.find(n=>n.key===key)}};return React.createElement('div',{},...nodes.map(n=>React.createElement(ToolTimeline,{key:n.key,node:n,sessionId:'s',useChat:selector=>selector(snapshot)})));}
  const root=await render(t,Flow,{});
  assert.equal(document.querySelectorAll('.dsh-director-tool-history').length,2);
  const history=document.querySelectorAll('.dsh-director-tool-history')[1];
  await act(()=>history.querySelector('summary').click());assert.equal(history.open,true);
  nodes=[...nodes,node('c',2)];await act(()=>root.render(React.createElement(Flow)));
  assert.equal(document.querySelectorAll('.dsh-director-tool-history')[1],history);
  assert.equal(history.open,true);assert.equal(history.querySelectorAll('[data-chat-call-id]').length,2);
});

test('GPU status keeps editable draft, disables only Send and restores sending after verified release',async t=>{
  const GpuStatus=await component('src/client/GpuStatus.jsx','GpuStatus');
  let status={phase:'generating',blocked:true,llm:'unloaded'},sent=0;
  const shell={submit(){sent++;}};
  function Composer(){return React.createElement('div',{'data-composer-seat':''},React.createElement(GpuStatus,{shell,connection:connected,readStatus:async()=>status,pollMs:10}),React.createElement('textarea',{defaultValue:'Keep this draft'}),React.createElement('button',{'data-send':'',onClick:()=>shell.submit()},React.createElement('svg',{},React.createElement('path',{d:'M8.3125 0.980183 test send arrow'}))),React.createElement('button',{'data-stop':''},React.createElement('svg',{},React.createElement('rect',{}))));}
  await render(t,Composer,{});await act(()=>new Promise(r=>setTimeout(r,20)));
  assert.match(document.querySelector('[role="status"]').textContent,/LLM unloaded.*ComfyUI generating/);
  assert.equal(document.querySelector('[data-send]').getAttribute('aria-disabled'),'true');
  assert.equal(document.querySelector('textarea').disabled,false);assert.equal(document.querySelector('textarea').value,'Keep this draft');
  await act(()=>document.querySelector('[data-send]').click());assert.equal(sent,0);
  assert.equal(document.querySelector('[data-stop]').getAttribute('aria-disabled'),null);
  status={phase:'releasing_vram',blocked:true,llm:'unloaded'};await act(()=>new Promise(r=>setTimeout(r,20)));
  assert.match(document.querySelector('[role="status"]').textContent,/Releasing VRAM/);
  status={phase:'ready',blocked:false,llm:'unloaded'};await act(()=>new Promise(r=>setTimeout(r,20)));
  assert.match(document.querySelector('[role="status"]').textContent,/GPU ready.*send messages/);
  assert.equal(document.querySelector('[data-send]').getAttribute('aria-disabled'),null);
  await act(()=>document.querySelector('[data-send]').click());assert.equal(sent,1);
});

test('GPU-ready composer shows transport loss and recovery without clearing or automatically sending its draft',async t=>{
  const GpuStatus=await component('src/client/GpuStatus.jsx','GpuStatus');
  let state='disconnected',sent=0;const listeners=new Set();
  const connection={state:{getSnapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}}};
  const shell={submit(){sent++;}};
  function Composer(){return React.createElement('div',{'data-composer-seat':''},React.createElement(GpuStatus,{shell,connection,readStatus:async()=>({phase:'ready',blocked:false,llm:'unloaded'}),pollMs:10}),React.createElement('textarea',{defaultValue:'Unsent draft'}),React.createElement('button',{'data-send':'',onClick:()=>shell.submit()},React.createElement('svg',{},React.createElement('path',{d:'M8.3125 0.980183 test send arrow'}))));}
  await render(t,Composer,{});await act(()=>new Promise(r=>setTimeout(r,20)));
  assert.match(document.body.textContent,/Disconnected/);assert.doesNotMatch(document.body.textContent,/You can send messages/);
  await act(()=>document.querySelector('[data-send]').click());assert.equal(sent,0);
  await act(()=>{state='connecting';for(const fn of listeners)fn();});assert.match(document.body.textContent,/Reconnecting/);
  await act(()=>{state='connected';for(const fn of listeners)fn();});assert.match(document.body.textContent,/Connected/);
  assert.equal(document.querySelector('textarea').value,'Unsent draft');assert.equal(sent,0);
  await act(()=>document.querySelector('[data-send]').click());assert.equal(sent,1);
});

test('an offline Send click cannot become an automatic submission when recovery wins a slow GPU check',async t=>{
  const GpuStatus=await component('src/client/GpuStatus.jsx','GpuStatus');
  let state='disconnected',sent=0,reads=0;const listeners=new Set(),pending=Promise.withResolvers();
  const connection={state:{getSnapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}}};
  const shell={submit(){sent++;}};
  await render(t,GpuStatus,{shell,connection,pollMs:100000,readStatus:()=>{reads++;return reads===1?Promise.resolve({phase:'ready',blocked:false,llm:'unloaded'}):pending.promise;}});
  await act(()=>shell.submit());assert.equal(sent,0);
  await act(()=>{state='connected';for(const fn of listeners)fn();pending.resolve({phase:'ready',blocked:false,llm:'unloaded'});});
  assert.equal(sent,0,'recovering a connection must require a new deliberate send');
  await act(()=>shell.submit());assert.equal(sent,1);
});

test('review card shows shot dialogue, continuity, version and actual bound image; enlarge works',async t=>{
  const MediaCard=await component('src/client/MediaCard.jsx','MediaCard');
  await render(t,MediaCard,{block:result('director_show_media',JSON.stringify(media)),sessionId:'s'});
  const card=document.querySelector('[data-shot-id="s1"]');
  assert.ok(card,'shot card should be present');
  for(const text of ['Great coffee.','Cup on table.','Cup in hand.','Match cut to Blake.','4','actor-a.png','Actor identity'])assert.ok(card.textContent.includes(text),text);
  assert.ok(document.querySelector('[data-proposal-version="v3"]'));
  assert.equal(card.querySelector('img').getAttribute('src'),`/director-media/${mediaId}?session=s`);
  await act(()=>card.querySelector('[data-action="enlarge"]').click());
  assert.ok(document.querySelector('dialog').open);
  assert.ok(!document.querySelector('[data-action="approve"]'),'presentation cannot fabricate approval');
});

test('compact tool tree preserves ordered nested calls, logs and visible child failures',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const child=result('read','source content');
  const failed=result('bash','HTTP 500: backend unavailable',true);
  const node={data:{root:result('code_execution','root output',false,[child,failed])}};
  await render(t,ToolTimeline,{node,sessionId:'s',inspectCall:()=>{}});
  assert.deepEqual([...document.querySelectorAll('[data-chat-call-id]')].map(e=>e.dataset.chatCallId),['code_execution','read','bash']);
  assert.ok(document.querySelector('[role="alert"]').textContent.includes('HTTP 500'));
  const detail=document.querySelector('[data-chat-call-id="read"] details');
  assert.equal(detail.open,false);
  assert.ok(detail.textContent.includes('source content'));
  await act(()=>{detail.open=true;detail.dispatchEvent(new window.Event('toggle'));});
  assert.ok(detail.open);
});

test('Director tools replace their timeline dot with an accessible clapperboard while ordinary tools keep dots',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const submit={callId:'submit-running',name:'submit_comfy_job',argsRaw:'{}',time:1000,subCalls:[]};
  const node={data:{root:result('code_execution','done',false,[result('director_show_media',JSON.stringify(media)),result('director_stage_images','Staged references'),submit,result('submit_comfy_video','Rejected',true),result('read','ordinary tool'),result('director_unrelated','not a plugin tool')])}};
  await render(t,ToolTimeline,{node,sessionId:'s'});
  for(const id of ['director_show_media','director_stage_images','submit-running','submit_comfy_video']){
    const row=document.querySelector(`[data-chat-call-id="${id}"]`),summary=row.querySelector('summary');
    assert.equal(summary.querySelectorAll('.dsh-director-node').length,1,'icon must replace, not accompany, the dot');
    const marker=summary.querySelector('.dsh-director-node');
    assert.equal(marker.getAttribute('aria-label'),'Director tool');
    assert.ok(marker.querySelector('svg'),'Director marker must be a drawn icon, not a platform-dependent emoji');
  }
  for(const id of ['code_execution','read','director_unrelated']){
    const marker=document.querySelector(`[data-chat-call-id="${id}"] summary .dsh-director-node`);
    assert.equal(marker.querySelector('svg'),null);assert.equal(marker.getAttribute('aria-hidden'),'true');
  }
  assert.match(document.querySelector('[data-chat-call-id="submit-running"]').className,/tool-running/);
  assert.match(document.querySelector('[data-chat-call-id="submit_comfy_video"]').className,/tool-error/);
  const detail=document.querySelector('[data-chat-call-id="director_stage_images"] details');
  assert.equal(detail.open,false);await act(()=>detail.querySelector('summary').click());assert.equal(detail.open,true);
});

test('Director review cards stay visible while completed tool image previews fold with their logs',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const photo={...result('read_image','Seen Alex'),content:[{type:'image',attachment:{attachmentId:'a'}},{type:'text',text:'Seen Alex'}]};
  const rootCall={callId:'running',name:'code_execution',argsRaw:'{}',time:1000,turn:1,step:1,subCalls:[result('director_show_media',JSON.stringify(media)),photo]};
  await render(t,ToolTimeline,{node:{data:{root:rootCall}},sessionId:'s',inspectCall:()=>{},renderMessageImages:()=>React.createElement('img',{src:'/authorized-preview',alt:'Native image'})});
  assert.ok(document.querySelector('[role="status"]').textContent.includes('Running'));
  const review=document.querySelector('[data-shot-id="s1"]');assert.ok(review);assert.equal(review.closest('details'),null);
  const image=document.querySelector('img[alt="Native image"]');assert.ok(image);
  assert.ok(image.closest('details'),'ordinary image previews must fold with the call');
  assert.equal(image.closest('details').open,false);
  await act(()=>image.closest('details').querySelector('summary').click());
  assert.equal(image.closest('details').open,true);
});

test('current call opens automatically then folds on completion without losing results or previews',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const running={callId:'read_image',name:'read_image',argsRaw:'{"path":"actor-a.png"}',time:1000,subCalls:[]};
  const props={sessionId:'s',renderMessageImages:()=>React.createElement('img',{src:'/authorized-preview',alt:'Native image'})};
  const root=await render(t,ToolTimeline,{...props,node:{data:{root:running}}});
  const detail=document.querySelector('details');assert.equal(detail.open,true);
  const finished={...result('read_image','Seen Alex'),content:[{type:'image',attachment:{attachmentId:'a'}},{type:'text',text:'Seen Alex'}]};
  await act(()=>root.render(React.createElement(ToolTimeline,{...props,node:{data:{root:finished}}})));
  assert.equal(document.querySelector('details'),detail,'lifecycle update should preserve the row');
  assert.equal(detail.open,false,'completion should auto-collapse the call');
  assert.ok(detail.textContent.includes('Seen Alex'));assert.ok(detail.querySelector('img'));
  await act(()=>detail.querySelector('summary').click());assert.equal(detail.open,true);
  await act(()=>root.render(React.createElement(ToolTimeline,{...props,node:{data:{root:{...finished}}}})));
  assert.equal(detail.open,true,'routine streaming updates must not undo a deliberate history inspection');
});

test('nested current child opens instead of its running parent and settled siblings remain compact',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const child={callId:'child',name:'pwsh',argsRaw:'{"command":"work"}',time:1000,subCalls:[]};
  const parent={callId:'parent',name:'code_execution',argsRaw:'{}',time:1000,subCalls:[result('read','Earlier output'),child]};
  const root=await render(t,ToolTimeline,{node:{data:{root:parent}},sessionId:'s'});
  const detail=id=>document.querySelector(`[data-chat-call-id="${id}"] details`);
  assert.equal(detail('parent').open,false);assert.equal(detail('read').open,false);assert.equal(detail('child').open,true);
  const next={callId:'next',name:'read',argsRaw:'{}',time:3000,subCalls:[]};
  const finishedChild={...result('pwsh','Completed'),callId:'child'};
  await act(()=>root.render(React.createElement(ToolTimeline,{node:{data:{root:{...parent,subCalls:[result('read','Earlier output'),finishedChild,next]}}},sessionId:'s'})));
  assert.equal(detail('parent').open,false);assert.equal(detail('child').open,false);assert.equal(detail('next').open,true);
});

test('completed video galleries stay outside folded tool details',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const video={...media,proposal:undefined,items:[{id:mediaId,type:'video',mime:'video/mp4',filename:'clip.mp4',label:'Finished clip',url:`/director-media/${mediaId}?session=s`}]};
  await render(t,ToolTimeline,{node:{data:{root:result('director_show_media',JSON.stringify(video))}},sessionId:'s'});
  assert.equal(document.querySelector('details').open,false);
  assert.ok(document.querySelector('video'));assert.equal(document.querySelector('video').closest('details'),null);
});

test('incremental review cards remain visible outside folded logs with the director icon',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  await render(t,ToolTimeline,{node:{data:{root:result('director_edit_review',JSON.stringify(media))}},sessionId:'s'});
  assert.equal(document.querySelector('details').open,false);
  assert.ok(document.querySelector('img'));assert.equal(document.querySelector('img').closest('details'),null);
  assert.ok(document.querySelector('[aria-label="Director tool"]'));
});

test('a manually inspected coordinating parent folds when its own result arrives',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const child={callId:'child',name:'pwsh',argsRaw:'{}',time:1000,subCalls:[]};
  const parent={callId:'parent',name:'code_execution',argsRaw:'{}',time:1000,subCalls:[child]};
  const root=await render(t,ToolTimeline,{node:{data:{root:parent}},sessionId:'s'});
  const detail=document.querySelector('[data-chat-call-id="parent"] details');
  await act(()=>detail.querySelector('summary').click());assert.equal(detail.open,true);
  await act(()=>root.render(React.createElement(ToolTimeline,{node:{data:{root:{...result('code_execution','Done',false,[{...result('pwsh','Done'),callId:'child'}]),callId:'parent'}}},sessionId:'s'})));
  assert.equal(detail.open,false);
});

test('parallel running children remain open and one completion does not fold the other',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const running=id=>({callId:id,name:'pwsh',argsRaw:'{}',time:1000,subCalls:[]});
  const parent={callId:'parent',name:'code_execution',argsRaw:'{}',time:1000,subCalls:[running('a'),running('b')]};
  const root=await render(t,ToolTimeline,{node:{data:{root:parent}},sessionId:'s'});
  const detail=id=>document.querySelector(`[data-chat-call-id="${id}"] details`);
  assert.equal(detail('parent').open,false);assert.equal(detail('a').open,true);assert.equal(detail('b').open,true);
  await act(()=>root.render(React.createElement(ToolTimeline,{node:{data:{root:{...parent,subCalls:[{...result('pwsh','Done'),callId:'a'},running('b')]}}},sessionId:'s'})));
  assert.equal(detail('a').open,false);assert.equal(detail('b').open,true);
});

test('window-cut tool results remain inspectable without a call head',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  await render(t,ToolTimeline,{node:{data:{root:{...result('orphan','Saved output'),call:null}}},sessionId:'s',inspectCall:()=>{}});
  assert.ok(document.querySelector('summary').textContent.includes('orphan'));
  assert.ok(document.body.textContent.includes('Saved output'));
});

test('nonzero shell exits and killed signals remain visible even with isError false',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const shell=(name,text)=>({...result(name,text),call:{name,argsRaw:'{"command":"do-work","description":"Run work"}'}});
  const node={data:{root:result('code_execution','done',false,[shell('pwsh','Failed command\n[exit code: 1]'),shell('bash','Stopped\n[killed by signal: SIGTERM]'),result('read','A document example\n[exit code: 1]')])}};
  await render(t,ToolTimeline,{node,sessionId:'s'});
  const alerts=[...document.querySelectorAll('[role="alert"]')];
  assert.equal(alerts.length,2);
  assert.ok(alerts.some(e=>e.textContent.includes('exit code: 1')));
  assert.ok(alerts.some(e=>e.textContent.includes('SIGTERM')));
});

test('expanded logs preserve file and extension blocks alongside readable text',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const block={...result('custom_export','Saved artifact'),content:[{type:'text',text:'Saved artifact'},{type:'file',path:'report.json'},{type:'custom',payload:{value:'important extension'}}]};
  await render(t,ToolTimeline,{node:{data:{root:block}},sessionId:'s'});
  const log=document.querySelector('.dsh-director-tool-log');
  assert.ok(log.textContent.includes('Saved artifact'));
  assert.ok(log.textContent.includes('report.json'));
  assert.ok(log.textContent.includes('important extension'));
});

test('review controls, reference warnings and confirmation instructions render in English',async t=>{
  const MediaCard=await component('src/client/MediaCard.jsx','MediaCard');
  const proposal={...media,proposal:{version:'v3',shots:[{...media.proposal.shots[0],dialogue:undefined,reference_numbers:[]}]}};
  await render(t,MediaCard,{block:result('director_show_media',JSON.stringify(proposal)),sessionId:'s'});
  const text=document.body.textContent;
  for(const label of ['Shot & reference review','1 clip / 1 shot','Awaiting confirmation','Dialogue','No dialogue','Incoming state','Ending state','Transition','No references are bound','Other media','Confirm v3 in chat','does not approve generation'])assert.ok(text.includes(label),label);
  assert.doesNotMatch(text,/\p{Script=Han}/u);
});

test('tool states, accessible region and fallback log instructions render in English',async t=>{
  const ToolTimeline=await component('src/client/ToolTimeline.jsx','ToolTimeline');
  const failed={...result('empty_failure','',true),call:null};
  const file={...result('export','Saved'),content:[{type:'text',text:'Saved'},{type:'file',path:'report.json'}]};
  const root={callId:'running',name:'code_execution',argsRaw:'{}',time:1000,subCalls:[failed,file]};
  await render(t,ToolTimeline,{node:{data:{root}},sessionId:'s',inspectCall:()=>{}});
  assert.equal(document.querySelector('section').getAttribute('aria-label'),'Tool execution nodes');
  for(const label of ['Running','Failed','Returned','Arguments','Results','Full results (including attachments)','View call details','Call arguments are outside the current history window.','Tool call failed. Expand for details.'])assert.ok(document.body.textContent.includes(label),label);
  assert.doesNotMatch(document.body.textContent,/\p{Script=Han}/u);
});

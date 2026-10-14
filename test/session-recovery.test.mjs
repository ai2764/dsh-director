import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {harnessRequire} from './harness.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,180));
async function runtime(t){
  const dom=new JSDOM('<textarea>Keep my draft</textarea>',{url:'http://localhost:3080'});
  let visibility='visible',online=true;
  Object.defineProperty(dom.window.document,'visibilityState',{get:()=>visibility});
  Object.defineProperty(dom.window.navigator,'onLine',{get:()=>online});
  const installed=await readFile(harnessRequire.resolve('@deepseek-ai/dsh-client-connection/client'),'utf8');
  const start=installed.indexOf('//#region lib/types/client/connection.js'),end=installed.indexOf('//#endregion',start);
  assert.ok(start>=0&&end>start,'installed ConnectionController must be available');
  const hookStart=installed.indexOf('function watchBrowserNetwork(controller)'),hookEnd=installed.indexOf('/**',hookStart);
  assert.ok(hookStart>=0&&hookEnd>hookStart);
  const context=vm.createContext({window:dom.window,AbortController,setTimeout,clearTimeout,console,resolveConnectionConfig:()=>({backoffBaseMs:5,backoffFactor:1,backoffMaxMs:5,generationReadyWarnMs:100,generationReadyTimeoutMs:1000})});
  vm.runInContext(`${installed.slice(start,end)}\n${installed.slice(hookStart,hookEnd)}\nglobalThis.Controller=ConnectionController;globalThis.watch=watchBrowserNetwork;`,context);
  let opens=0,state,generation,controller;
  const listeners=new Set(),generationListeners=new Set(),carrierClosers=new Set();
  const connection={
    state:{getSnapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}},
    generation:{getSnapshot:()=>generation,subscribe:fn=>{generationListeners.add(fn);return()=>generationListeners.delete(fn);}},
    reconnect:()=>controller.reconnect(),
  };
  controller=new context.Controller((signal,ready)=>new Promise(resolve=>{
    opens++;ready({home:'test-host'});signal.addEventListener('abort',resolve,{once:true});
  }),{onReconnectRequested:()=>{for(const fn of carrierClosers)fn();carrierClosers.clear();},onStateChange:next=>{state=next;generation=next==='connected'?{id:opens,host:{home:'test-host'}}:undefined;for(const fn of listeners)fn();for(const fn of generationListeners)fn();}});
  const unwatch=context.watch(controller);
  controller.start();
  const built=await build({entryPoints:['src/client/index.jsx'],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-dom'],jsx:'automatic',loader:{'.css':'text'}});
  const module={exports:{}};
  vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),window:dom.window,document:dom.window.document,setTimeout,clearTimeout});
  const disposers=[],docks=[];
  module.exports.apply({connection,conversation:{input:{shell:()=>({submit(){throw Error('Recovery must not send a prompt');}})}},effect(fn){disposers.push(fn());},slots:{inject(name,fn){fn();},register(def,Component){if(def.name==='conversation.input.dock')docks.push({def,Component});return()=>{};}}});
  const dispose=()=>{for(const fn of disposers.splice(0))fn?.();};
  t.after(async()=>{dispose();unwatch();controller.stop();await tick();dom.window.close();});
  return {dom,connection,docks,carrierClosers,opens:()=>opens,dispose,
    visibility(value){visibility=value;dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));},
    online(value){online=value;dom.window.dispatchEvent(new dom.window.Event(value?'online':'offline'));},
    fire(type,options){const event=new dom.window.Event(type);if(options)Object.assign(event,options);dom.window.dispatchEvent(event);},
  };
}

test('foreground recovery replaces stale connected carrier once and preserves draft without submission',async t=>{
  const r=await runtime(t);await tick();assert.equal(r.opens(),1,'mount must not reset a healthy carrier');
  r.visibility('hidden');r.visibility('visible');r.fire('pageshow',{persisted:true});r.fire('focus');await tick();
  assert.equal(r.opens(),2,'still-online mobile wake must establish a fresh follow generation');
  assert.equal(r.dom.window.document.querySelector('textarea').value,'Keep my draft');
  r.fire('focus');await tick();assert.equal(r.opens(),2,'duplicate wake events must not create a reconnect storm');
  r.visibility('hidden');r.visibility('visible');await tick();assert.equal(r.opens(),3,'a new background cycle must not be suppressed by the prior wake');
});

test('foreground recovery publishes missed messages through real native journal/follow baseline, without duplication',async t=>{
  const r=await runtime(t);await tick();
  const base=dirname(harnessRequire.resolve('@deepseek-ai/dsh-api-gateway'));
  const path=name=>JSON.stringify(resolve(base,'types/client',name).replaceAll('\\','/'));
  const built=await build({stdin:{contents:`export {RemoteStream} from ${path('remote-stream.js')};export {RemoteJournalStream} from ${path('journal-stream.js')};export {RemoteStreamCarrierError} from ${path('stream-client.js')};`,resolveDir:base},bundle:true,write:false,format:'cjs',platform:'node'});
  const module={exports:{}};
  vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),AbortController,AbortSignal,setTimeout,clearTimeout,console});
  const {RemoteStream,RemoteJournalStream,RemoteStreamCarrierError}=module.exports;
  let records=[{seq:1,text:'Already visible'}],displayed=[],failure,followCount=0;
  class Journal extends RemoteJournalStream {
    async *follow(request,signal){
      followCount++;
      assert.deepEqual(request,{sessionId:'test-session',maxMessages:20});
      const closed=Promise.withResolvers();
      const close=()=>closed.resolve();r.carrierClosers.add(close);signal.addEventListener('abort',close,{once:true});
      try{
        const page={records:[...records],hasMore:false};
        yield {type:'opened',cursor:records.at(-1).seq,page};
        await closed.promise;if(!signal.aborted)throw new RemoteStreamCarrierError('Test carrier replaced');
      }finally{r.carrierClosers.delete(close);signal.removeEventListener('abort',close);}
    }
    readPage(){throw Error('Wake must use a fresh follow baseline, not unrelated history paging');}
  }
  const journal=new Journal({$stream:options=>new RemoteStream(r.connection,options)},{name:'session-refresh-test',entries:page=>page.records,hasMore:page=>page.hasMore,first:entry=>entry.seq,last:entry=>entry.seq,compare:(a,b)=>a-b,follows:(a,b)=>b===a+1,emptyCursor:0,publish:update=>{assert.equal(update.type,'replace');displayed=Array.from(update.entries,entry=>entry.text);},failed:error=>{failure=error;}});
  t.after(()=>journal.dispose());
  await journal.open({sessionId:'test-session',maxMessages:20});
  assert.deepEqual(displayed,['Already visible']);
  r.visibility('hidden');records.push({seq:2,text:'Received while phone was asleep'});
  assert.deepEqual(displayed,['Already visible'],'frozen carrier has not delivered the message');
  r.visibility('visible');r.fire('focus');await tick();
  assert.equal(failure,undefined);assert.equal(followCount,2);
  assert.deepEqual(displayed,['Already visible','Received while phone was asleep']);
  assert.equal(r.dom.window.document.querySelector('textarea').value,'Keep my draft');
});

test('wake recovery skips hidden/offline pages and reconnects once when foreground network returns',async t=>{
  const r=await runtime(t);r.visibility('hidden');r.fire('focus');r.fire('pageshow',{persisted:true});await tick();assert.equal(r.opens(),1);
  r.online(false);r.visibility('visible');r.fire('focus');await tick();assert.equal(r.opens(),1);
  r.online(true);r.fire('focus');await tick();assert.equal(r.opens(),2);
});

test('disposing plugin cancels scheduled recovery and withdraws every wake listener',async t=>{
  const r=await runtime(t);r.visibility('hidden');r.visibility('visible');r.dispose();await tick();assert.equal(r.opens(),1);
  r.visibility('hidden');r.visibility('visible');r.fire('focus');r.fire('pageshow',{persisted:true});r.online(true);await tick();assert.equal(r.opens(),1);
});

test('composer receives the live native connection source rather than conflating GPU ready with connection',async t=>{
  const r=await runtime(t);assert.equal(r.docks.length,1);
  const props=r.docks[0].def.inject('test-session');assert.equal(props.connection,r.connection);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {keepCompletedMediaVisible} from '../src/client/media-visibility.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('completed video reveals both native process folds and then respects manual collapse',async()=>{
  const dom=new JSDOM('<div data-step-process hidden="until-found"><button aria-expanded="false">Called tools</button><div data-step-process-body hidden="until-found"><div data-chat-flow-kind="tool-call" hidden="until-found"><section class="dsh-director-card"><video></video></section></div></div></div>');
  const {document,MutationObserver,Event}=dom.window;
  const root=document.querySelector('[data-step-process]');
  const body=document.querySelector('[data-step-process-body]');
  const flow=document.querySelector('[data-chat-flow-kind]');
  const card=document.querySelector('.dsh-director-card');
  const revealed=[];
  for(const element of [root,body,flow])element.addEventListener('beforematch',()=>{revealed.push(element);element.removeAttribute('hidden');});
  const stop=keepCompletedMediaVisible(card,{MutationObserver,Event});
  await tick();
  assert.deepEqual(revealed,[root,body,flow]);
  assert.equal(card.closest('[hidden]'),null);
  body.setAttribute('hidden','until-found');
  await tick();
  assert.equal(body.hasAttribute('hidden'),true,'a deliberate later collapse remains closed');
  assert.equal(revealed.length,3);
  stop();dom.window.close();
});

test('completed video waits for native automatic fold before revealing it',async()=>{
  const dom=new JSDOM('<div data-step-process><div data-step-process-body><section class="dsh-director-card"><video></video></section></div></div>');
  const {document,MutationObserver,Event}=dom.window;
  const root=document.querySelector('[data-step-process]');
  let count=0;root.addEventListener('beforematch',()=>{count++;root.removeAttribute('hidden');});
  const stop=keepCompletedMediaVisible(document.querySelector('.dsh-director-card'),{MutationObserver,Event});
  root.setAttribute('hidden','until-found');
  await tick();
  assert.equal(count,1);
  assert.equal(root.hasAttribute('hidden'),false);
  stop();dom.window.close();
});

test('reveal waits until Harness parent effects have registered beforematch listeners',async()=>{
  const dom=new JSDOM('<div data-step-process hidden="until-found"><div data-step-process-body hidden="until-found"><section class="dsh-director-card"><video></video></section></div></div>');
  const {document,MutationObserver,Event}=dom.window;
  const root=document.querySelector('[data-step-process]');
  const body=document.querySelector('[data-step-process-body]');
  const stop=keepCompletedMediaVisible(document.querySelector('.dsh-director-card'),{MutationObserver,Event});
  root.addEventListener('beforematch',()=>root.removeAttribute('hidden'));
  body.addEventListener('beforematch',()=>body.removeAttribute('hidden'));
  await tick();
  assert.equal(root.hasAttribute('hidden'),false);
  assert.equal(body.hasAttribute('hidden'),false);
  stop();dom.window.close();
});

test('a completed card that was already visible respects the first manual collapse',async()=>{
  const dom=new JSDOM('<div data-step-process><button aria-expanded="true">Called tools</button><div data-step-process-body><section class="dsh-director-card"><video></video></section></div></div>');
  const {document}=dom.window,body=document.querySelector('[data-step-process-body]');
  body.addEventListener('beforematch',()=>body.removeAttribute('hidden'));
  const button=document.querySelector('button');
  button.addEventListener('click',()=>{button.setAttribute('aria-expanded','false');body.setAttribute('hidden','until-found');});
  const stop=keepCompletedMediaVisible(document.querySelector('.dsh-director-card'));
  await tick();button.click();await tick();await tick();
  assert.equal(body.hasAttribute('hidden'),true,'the first user fold is an explicit choice, even when no automatic fold happened');
  stop();dom.window.close();
});

test('an initially visible card respects its outer native turn disclosure',async()=>{
  const dom=new JSDOM('<main data-chat-flow><div data-chat-turn="7" data-chat-flow-kind="turn-process"><button data-turn-process="7" aria-expanded="true"><span>Completed in 4s</span></button></div><div data-step-process data-chat-turn="7"><div data-step-process-body><section class="dsh-director-card"><video></video></section></div></div></main>');
  const {document}=dom.window,group=document.querySelector('[data-step-process]'),button=document.querySelector('button');
  group.addEventListener('beforematch',()=>group.removeAttribute('hidden'));
  button.addEventListener('click',()=>{button.setAttribute('aria-expanded','false');group.setAttribute('hidden','until-found');});
  const stop=keepCompletedMediaVisible(document.querySelector('.dsh-director-card'));
  await tick();button.querySelector('span').click();await tick();await tick();
  assert.equal(group.hasAttribute('hidden'),true,'the outer turn button is a sibling of the group, not its descendant');
  stop();dom.window.close();
});

test('turn disclosures from other turns or other chat views do not suppress automatic media reveal',async()=>{
  const dom=new JSDOM('<main data-chat-flow><div data-chat-turn="8"><button data-turn-process="8" aria-expanded="true">Other turn</button></div><div data-step-process data-chat-turn="7"><div data-step-process-body><section class="dsh-director-card"><video></video></section></div></div></main><aside data-chat-flow><button data-turn-process="7" aria-expanded="true">Another conversation</button></aside>');
  const {document}=dom.window,group=document.querySelector('[data-step-process]');
  group.addEventListener('beforematch',()=>group.removeAttribute('hidden'));
  const stop=keepCompletedMediaVisible(document.querySelector('.dsh-director-card'));
  await tick();for(const button of document.querySelectorAll('button'))button.click();
  group.setAttribute('hidden','until-found');await tick();await tick();
  assert.equal(group.hasAttribute('hidden'),false,'unrelated disclosures must not disable this card’s own reveal');
  stop();dom.window.close();
});

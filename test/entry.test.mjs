import test from 'node:test';import assert from 'node:assert/strict';
import {harnessRequire} from './harness.mjs';
import {createBundledProvider} from '../src/skills.mjs';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('real registry gives project skills priority over the bundled provider',async()=>{
  const {Context}=harnessRequire('@deepseek-ai/cordis');
  const {default:SkillRegistry}=harnessRequire('@deepseek-ai/dsh-skill');
  const ctx=new Context();const registry=new SkillRegistry(ctx);
  const bundled=await createBundledProvider();const remove=registry.registerProvider(()=>bundled);
  assert.equal((await registry.get('director')).source,'bundled');
  const project={name:'director',description:'project',content:'# Project version',source:'project-agents',provider:'project',rank:200,locator:'director',invocation:{modelInvocable:true,userInvocable:true}};
  const removeProject=registry.registerProvider(()=>({name:'project',async list(){return {complete:true,candidates:[project]};},async get(){return project;}}));
  assert.equal((await registry.get('director')).content,'# Project version');
  remove();assert.equal(await registry.get('h3-prompt-writing'),undefined);removeProject();
});
test('host entry owns reference staging, media and both submit tools with declared dependencies',async()=>{
  const entry=await import('../src/index.mjs');const names=[],effects=[];
  await entry.apply({skills:{registerProvider(fn){fn();return ()=>{};}},tools:{register(t){names.push(t.name);return ()=>{};}},
    jobs:{start(){}},fs:{},connection:{requestRejection(){}},webServer:{register(){return ()=>{};}},inject(){},effect(fn){const d=fn();effects.push(d);}});
  assert.deepEqual(names.sort(),['director_assets','director_edit_review','director_show_media','director_stage_images','submit_comfy_job','submit_comfy_video']);
  assert.deepEqual(entry.inject,['tools','jobs','skills','fs','connection','webServer','attachments']);
  for(const dispose of effects)dispose?.();
});

test('real Cordis lifecycle keeps H3 setup optional and registers it when a human UI exists',async()=>{
  const {Context}=harnessRequire('@deepseek-ai/cordis');
  const entry=await import('../src/index.mjs');
  for(const withQuestions of [false,true]){
    const ctx=new Context(),names=new Set();
    ctx.provide('tools',{register(tool){names.add(tool.name);return ()=>names.delete(tool.name);}});
    ctx.provide('jobs',{start(){throw Error('No job should start');}});
    ctx.provide('skills',{registerProvider(){return ()=>{};}});
    ctx.provide('fs',{});ctx.provide('attachments',{});
    ctx.provide('connection',{requestRejection(){}});
    ctx.provide('webServer',{register(){return ()=>{};}});
    if(withQuestions)ctx.provide('userQuestions',{ask(){throw Error('Startup must not ask questions');}});
    const cacheRoot=await mkdtemp(join(tmpdir(),'director-entry-cache-'));
    const fiber=await ctx.plugin(entry,{skillCacheRoot:cacheRoot});
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(names.has('submit_comfy_job'));
    assert.equal(names.has('director_h3_skill'),withQuestions);
    await fiber.dispose();
    assert.equal(names.size,0,'Disposal removes optional and core tools');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createBundledProvider} from '../src/skills.mjs';
import {apply as registerSubmit} from '../src/submit-comfy-video.mjs';
import {proposalSchema} from '../src/shot-proposal.mjs';

test('Director exposes both Motion Context routes without a single-frame continuation option',()=>{
  const tools=[];
  registerSubmit({jobs:{},effect:fn=>fn(),tools:{register:tool=>tools.push(tool)}});
  for(const tool of tools)assert.deepEqual(tool.parameters.properties.continuity_requirement.enum,['sampler_latent','video_frames']);
  assert.deepEqual(proposalSchema.properties.clip_workflows.items.properties.continuity_mode.enum,['none','video_frames','sampler_latent']);
});

test('bundled and workspace guidance removes frame extraction fallback and keeps latent handoff',async()=>{
  const base=resolve(import.meta.dirname,'../skills/director');
  for(const name of ['SKILL.md','references/continuity.md']){
    const text=await readFile(resolve(base,name),'utf8');
    assert.doesNotMatch(text,/reviewed tail frame|Layouts or tail frames|take the last frame|A decoded-tail route replaces|offer the available decoded-video route/iu);
    assert.match(text,/continuity_requirement[^\n]*sampler_latent/);
    assert.match(text,/video_frames/);
    assert.doesNotMatch(text,/not a supported Director continuation option|not offered as a production route|or use decoded frames as a continuation fallback/);
    assert.equal(await readFile(resolve(base,'../../../../.agents/skills/director',name),'utf8'),text);
  }
});

async function continuityResource(content,base){
  const targets=[...content.matchAll(/\]\(([^)]+)\)/g)].map(m=>m[1]);
  assert.ok(targets.includes('references/continuity.md'),'director must route dependent clips to its continuity reference');
  const path=resolve(base,'references/continuity.md');
  assert.equal(await access(path).then(()=>true,()=>false),true,'linked continuity guidance must be readable');
  assert.ok((await readFile(path,'utf8')).trim().length>0,'a routed reference must not be empty');
}

test('bundled director can resolve its dependent-clip guidance through its resource base',async()=>{
  const provider=await createBundledProvider();const {candidates}=await provider.list();
  const skill=await provider.get(candidates.find(c=>c.name==='director'));
  await continuityResource(skill.content,skill.resourceBase.path);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createBundledProvider} from '../src/skills.mjs';

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

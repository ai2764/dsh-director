import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';

test('packaged submit preserves tool ownership and dependency exports', async () => {
  const entry = await import('../src/submit-comfy-video.mjs');
  const names=[];
  entry.apply({jobs:{start(){}},tools:{register(t){names.push(t.name);return ()=>{};}},effect(fn){fn();}});
  assert.deepEqual(names.sort(),['submit_comfy_job','submit_comfy_video']);
  assert.deepEqual(entry.inject,['tools','jobs']);
});
test('bundled skills expose directory resources and stripped frontmatter', async () => {
  const {createBundledProvider}=await import('../src/skills.mjs');
  const provider=await createBundledProvider();
  const {candidates}=await provider.list({});
  assert.deepEqual(candidates.map(c=>c.name).sort(),['director','h3-prompt-writing']);
  const h3=await provider.get(candidates.find(c=>c.name==='h3-prompt-writing'));
  assert.ok(h3.content.startsWith('# H3'));
  assert.equal(h3.source,'bundled');
  await access(h3.resourceBase.path+'/references/ref-en.txt');
});

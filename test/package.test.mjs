import test from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('packaged submit preserves tool ownership and dependency exports', async () => {
  const entry = await import('../src/submit-comfy-video.mjs');
  const names=[];
  entry.apply({jobs:{start(){}},tools:{register(t){names.push(t.name);return ()=>{};}},effect(fn){fn();}});
  assert.deepEqual(names.sort(),['submit_comfy_job','submit_comfy_video']);
  assert.deepEqual(entry.inject,['tools','jobs']);
});
test('bundled skills expose directory resources and stripped frontmatter', async () => {
  const {createBundledProvider,createH3GuideStore}=await import('../src/skills.mjs');
  const cacheRoot=await mkdtemp(join(tmpdir(),'director-empty-guides-'));
  const provider=await createBundledProvider(undefined,{guideStore:createH3GuideStore({cacheRoot})});
  const {candidates}=await provider.list({});
  assert.deepEqual(candidates.map(c=>c.name).sort(),['director','h3-prompt-writing']);
  const h3=await provider.get(candidates.find(c=>c.name==='h3-prompt-writing'));
  assert.ok(!h3.content.startsWith('---'));
  assert.equal(h3.source,'bundled');
  assert.match(h3.content,/director_h3_skill/);
  await access(h3.path);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

// Catch forced-width + height-cap regression, which adds player-owned bars
// to portrait videos. Browser verification additionally checks decoded media
// against actual rendered bounds; jsdom has no media/layout engine.
async function styles(t){
  const css=await readFile(new URL('../src/client/media.css',import.meta.url),'utf8');
  const dom=new JSDOM(`<style>${css}</style><figure class="dsh-director-item dsh-director-video"><video></video></figure><dialog class="dsh-director-dialog"><div class="dsh-director-stage"><video></video></div></dialog>`);
  t.after(()=>dom.window.close());
  return {inline:dom.window.getComputedStyle(dom.window.document.querySelector('figure video')),expanded:dom.window.getComputedStyle(dom.window.document.querySelector('dialog video')),stage:dom.window.getComputedStyle(dom.window.document.querySelector('.dsh-director-stage'))};
}

test('inline video leaves both dimensions intrinsic while bounding preview size',async t=>{
  const {inline}=await styles(t);
  assert.equal(inline.width,'auto');
  assert.equal(inline.height,'auto');
  assert.equal(inline.maxWidth,'100%');
  assert.equal(inline.maxHeight,'420px');
  assert.equal(inline.marginInline,'auto');
});

test('enlarged video keeps intrinsic ratio with width and viewport-height limits',async t=>{
  const {expanded}=await styles(t);
  assert.equal(expanded.width,'auto');
  assert.equal(expanded.height,'auto');
  assert.equal(expanded.maxWidth,'100%');
  assert.notEqual(expanded.maxHeight,'none');
  assert.equal(expanded.objectFit,'contain');
});

test('unused enlargement stage space does not look like encoded black bars',async t=>{
  const {stage}=await styles(t);
  assert.notEqual(stage.background,'rgb(0, 0, 0)');
  assert.equal(stage.justifyContent,'center');
});

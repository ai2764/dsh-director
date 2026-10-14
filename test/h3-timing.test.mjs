import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtemp,readdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const script=fileURLToPath(new URL('../src/h3-timing.mjs',import.meta.url));

test('timing CLI corrects the observed 204/221/255-frame planning errors without deleting shots',()=>{
  const run=spawnSync(process.execPath,[script,'--shots','5.5,3','--shots','5.208,4','--shots','4.625,6'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout);
  assert.deepEqual(result.clips.map(c=>c.frames),[209,226,260]);
  assert.deepEqual(result.clips.map(c=>c.shots.map(s=>[s.start_frame,s.end_frame_exclusive])),[[[0,132],[132,209]],[[0,125],[125,226]],[[0,111],[111,260]]]);
  assert.deepEqual(result.clips.map(c=>c.alignment_padding_frames),[5,5,5]);
  assert.equal(result.total_frames,695);
  assert.equal(result.total_duration_s,695/24);
});

test('five-clip timing preserves count and boundaries and sums to the audited 1147 frames',()=>{
  const run=spawnSync(process.execPath,[script,'--shots','5.5,3','--shots','5.208,4','--shots','4.625,6','--shots','2.333,7','--shots','3.833,5.583'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);
  assert.equal(result.fps,24);assert.equal(result.clips.length,5);assert.equal(result.total_frames,1147);
  assert.equal(result.total_duration_s,1147/24);
  assert.deepEqual(result.clips.slice(3).map(c=>c.shots.map(s=>[s.start_frame,s.end_frame_exclusive])),[[[0,56],[56,226]],[[0,92],[92,226]]]);
  assert.deepEqual(result.clips.map(c=>c.requested_duration_s),[8.5,9.208,10.625,9.333,9.416]);
});

test('whole-frame boundaries survive floating-point conversion without adding an extra H3 block',()=>{
  const run=spawnSync(process.execPath,[script,'--shots',`${1/24},${123/24}`],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);
  assert.equal(result.clips[0].frames,124);assert.equal(result.clips[0].alignment_padding_frames,0);
  assert.deepEqual(result.clips[0].shots.map(s=>[s.start_frame,s.end_frame_exclusive]),[[0,1],[1,124]]);
});

test('sub-frame shots remain nonzero and padding is assigned only to the last shot',()=>{
  const run=spawnSync(process.execPath,[script,'--shots','0.001,0.001'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);
  assert.deepEqual(result.clips[0].shots.map(s=>s.frames),[1,4]);
  assert.equal(result.clips[0].frames,5);assert.equal(result.clips[0].alignment_padding_frames,3);
});

test('invalid requests fail with useful errors and no successful JSON',()=>{
  for(const args of [[],['--shots',''],['--shots','1,'],['--shots','0'],['--shots','-1'],['--shots','Infinity'],['--shots','NaN'],['--shots','0x10'],['--shots','150'],['--fps','30'],['--shots'],['--shots','1','--context','22']]){
    const run=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
    assert.equal(run.status,1,JSON.stringify(args));assert.equal(run.stdout,'');
    assert.match(run.stderr,/H3 timing:.*(?:seconds|shots|frames|argument|usage)/i);
    assert.doesNotMatch(run.stderr,/MODULE_NOT_FOUND|stack|at file:/);
  }
});

test('clips beyond the known trained range are disclosed rather than promised feasible',()=>{
  const run=spawnSync(process.execPath,[script,'--shots','20'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);
  assert.equal(result.clips[0].frames,481);assert.match(result.clips[0].warnings.join(' '),/trained|untested/i);
  assert.match(result.scope,/fresh|independent/i);assert.match(result.scope,/context|continuation/i);
});

test('CLI usage is available without inspecting machine workflows or loading models',()=>{
  const run=spawnSync(process.execPath,[script,'--help'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/--shots/);assert.match(run.stdout,/24/);assert.equal(run.stderr,'');
});

test('timing calculation does not modify input arrays, files or the current workspace',async()=>{
  const {compileH3Timing}=await import('../src/h3-timing.mjs');
  const request=[[1,1],[2]],before=structuredClone(request);
  assert.equal(compileH3Timing(request).total_frames,112);assert.deepEqual(request,before);
  const folder=await mkdtemp(join(tmpdir(),'h3-timing-'));
  await writeFile(join(folder,'workflow.json'),'DO NOT CHANGE');
  const run=spawnSync(process.execPath,[script,'--shots','1,1'],{cwd:folder,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);assert.deepEqual(await readdir(folder),['workflow.json']);
  assert.equal(await readFile(join(folder,'workflow.json'),'utf8'),'DO NOT CHANGE');
});

test('programmatic callers cannot produce a success from empty or nonnumeric shot plans',async()=>{
  const {compileH3Timing}=await import('../src/h3-timing.mjs');
  for(const input of [null,{},[],[[]],['1,2'],[[null]],[[NaN]],[[Infinity]],[[-1]],[[0]],[['1']],[[Number.MAX_VALUE]]]){
    assert.throws(()=>compileH3Timing(input),/H3 timing:/);
  }
});

test('sparse programmatic plans fail instead of reporting zero duration or null frame bounds',async()=>{
  const {compileH3Timing}=await import('../src/h3-timing.mjs');
  const holeThenShot=Array(2);holeThenShot[1]=1;
  for(const input of [Array(1),[Array(1)],[holeThenShot]])assert.throws(()=>compileH3Timing(input),/H3 timing:/);
});

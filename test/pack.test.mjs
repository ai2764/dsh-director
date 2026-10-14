import test from 'node:test';import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';import {mkdtemp,readFile,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createRequire} from 'node:module';
test('release archive excludes personal media and works without workspace skills',async()=>{
  const metadata=JSON.parse(await readFile(join(process.cwd(),'package.json'),'utf8'));
  const tarball=join(process.cwd(),`dsh-director-${metadata.version}.tgz`);
  const files=execFileSync('tar',['-tzf',tarball],{encoding:'utf8'}).trim().split(/\r?\n/);
  for(const file of ['lib/index.mjs','lib/client.js','skills/director/SKILL.md','skills/director/references/continuity.md','skills/h3-prompt-writing/references/ref-en.txt','LICENSE','LICENSE.minimax-h3','NOTICE','THIRD_PARTY_NOTICES.md'])assert.ok(files.includes('package/'+file));
  assert.equal(files.some(f=>/\.(jpg|jpeg|png|webp|gif|mp4|webm|mkv|wav|mp3|gguf|safetensors|jsonl)$|session|settings|\.env|\/templates\/|\/workflows\//i.test(f)),false);
  const runtime = new Set((await readdir('src')).filter(name=>name.endsWith('.mjs')&&!name.endsWith('.test.mjs')).map(name=>'package/lib/'+name));
  const rootFiles = new Set(['package.json','README.md','LICENSE','LICENSE.minimax-h3','NOTICE','THIRD_PARTY_NOTICES.md','SECURITY.md','cordis.patch.yml'].map(name=>'package/'+name));
  for (const file of files) assert.ok(runtime.has(file)||rootFiles.has(file)||file==='package/lib/client.js'||/^package\/skills\/(director|h3-prompt-writing)\/(SKILL\.md|references\/[^/]+\.(md|txt))$/.test(file),`Unexpected release content: ${file}`);
  const root=await mkdtemp(join(tmpdir(),"dsh pack $literal's-"));execFileSync('tar',['-xzf',tarball,'-C',root]);
  const {createBundledProvider}=await import(new URL('file:///'+join(root,'package/lib/skills.mjs').replaceAll('\\','/')));
  const provider=await createBundledProvider();const result=await provider.list();assert.equal(result.candidates.length,2);
  const pkg=JSON.parse(await readFile(join(root,'package/package.json'),'utf8'));
  assert.equal(pkg.dsh.bundle.patch,'./cordis.patch.yml');
  assert.match(await readFile(join(root,'package/cordis.patch.yml'),'utf8'),/name: dsh-director/);
  // A shared archive must advertise a runnable helper in its own installation,
  // not a source-checkout path or a dependency supplied only by this machine.
  const definitions=[];
  const submit=await import(new URL('file:///'+join(root,'package/lib/submit-comfy-video.mjs').replaceAll('\\','/')));
  submit.apply({tools:{register(d){definitions.push(d);}},jobs:{start(){}},effect:fn=>fn()});
  const description=definitions.find(d=>d.name==='submit_comfy_job').description;
  const match=/run (node .*?) \(repeat --shots/.exec(description);
  assert.ok(match,'The installed submission tool must expose its own offline timing helper');
  // Exercise the exact advertised command through a real shell. JSON parsing
  // plus spawn(argv) would conceal expansion of $ or quotes in install paths.
  const timing=process.platform==='win32'
    ?spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',match[1]],{cwd:root,encoding:'utf8'})
    :spawnSync('sh',['-c',match[1]],{cwd:root,encoding:'utf8'});
  assert.equal(timing.status,0,timing.stderr);
  assert.equal(JSON.parse(timing.stdout).clips[0].frames,209);
  const {validateProposal}=await import(new URL('file:///'+join(root,'package/lib/shot-proposal.mjs').replaceAll('\\','/')));
  const reviewed={version:'packed',clip_references:[{clip_id:'C1',reference_numbers:[2,1]}],shots:[{shot_id:'S1',clip_id:'C1',duration_seconds:4,content:'Silent close-up.',dialogue:'',reference_numbers:[1]}]};
  assert.deepEqual(validateProposal(reviewed,2).clip_references,[{clip_id:'C1',reference_numbers:[2,1]}]);
});

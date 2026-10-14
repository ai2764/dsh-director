import test from 'node:test';import assert from 'node:assert/strict';import YAML from 'yaml';
test('profile migration preserves LAN/no-token entries and replaces only recognized submit owner',async()=>{
  const {planProfileMigration}=await import('../scripts/profile-migration.mjs');
  const packageText=JSON.stringify({name:'profile',dependencies:{lan:'1'},dsh:{profile:{bundles:['base','lan'],patchReload:'live'}}},null,2);
  const patchText='# no-token config\n- insert:\n    - id: no-token-auth\n      name: ./plugins/no-token-auth.mjs\n\n# old submit\n- insert:\n    - id: submit-comfy-video\n      name: ./plugins/submit-comfy-video-h3-reviewed.mjs\n';
  const next=planProfileMigration({packageText,patchText});
  const pkg=JSON.parse(next.packageText);assert.deepEqual(pkg.dsh.profile.bundles,['base','lan','dsh-director']);assert.equal(pkg.dsh.profile.patchReload,'live');assert.deepEqual(pkg.dependencies,{lan:'1'});
  assert.deepEqual(YAML.parse(next.patchText),[{insert:[{id:'no-token-auth',name:'./plugins/no-token-auth.mjs'}]}]);
  const again=planProfileMigration(next);assert.equal(again.packageText,next.packageText);assert.equal(again.patchText,next.patchText);
  assert.throws(()=>planProfileMigration({packageText,patchText:patchText.replace('./plugins/submit-comfy-video-h3-reviewed.mjs','some-other-plugin')}),/unknown/i);
});

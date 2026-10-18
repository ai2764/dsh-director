import test from 'node:test';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import {readFile} from 'node:fs/promises';import vm from 'node:vm';import {createRequire} from 'node:module';
test('built lazy browser factory exposes activation without executing UI side effects',async()=>{
  execFileSync(process.execPath,['scripts/build.mjs']);
  let factory;const require=createRequire(import.meta.url);
  vm.runInNewContext(await readFile('lib/client.js','utf8'),{window:{__ModuleLoader__:{load(row){assert.equal(row.id,'dsh-director');factory=row.factory;}}}});
  const client=factory(require);assert.equal(typeof client.apply,'function');assert.deepEqual(Array.from(client.inject),['slots','conversation','connection','sessions']);
});

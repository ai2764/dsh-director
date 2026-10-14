import test from 'node:test';
import assert from 'node:assert/strict';
import {apply, createSubmitComfyVideo} from '../src/submit-comfy-video.mjs';

test('removed bundled builder fails before any file, network or generation side effects', async () => {
  let effects = 0;
  const submit = createSubmitComfyVideo({
    readFileImpl: async () => { effects++; throw new Error('Unexpected file read'); },
    fetchImpl: async () => { effects++; throw new Error('Unexpected network request'); },
  });
  for (const args of [
    {h3_ref2av: {}},
    {h3_ref2av: {}, workflow: {'1': {class_type: 'SyntheticNode', inputs: {}}}},
  ]) {
    await assert.rejects(submit(args, {concludeTurn() { effects++; }}), /no bundled workflow.*workflow.*workflow_path/i);
  }
  assert.equal(effects, 0);
});

test('both registered submit tools expose caller-selected workflows, not a preset builder', () => {
  const definitions = [];
  apply({tools: {register(value) { definitions.push(value); }}, jobs: {start() {}}, effect: fn => fn()});
  assert.equal(definitions.length, 2);
  for (const tool of definitions) {
    assert.ok(tool.parameters.properties.workflow);
    assert.ok(tool.parameters.properties.workflow_path);
    assert.equal(tool.parameters.properties.h3_ref2av, undefined);
  }
});

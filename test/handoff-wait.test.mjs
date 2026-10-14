import test from 'node:test'
import assert from 'node:assert/strict'
import {harnessRequire} from './harness.mjs'
import {createSubmitComfyVideo} from '../src/submit-comfy-video.mjs'

const GiB = 1024 ** 3
const idle = {queue_running: [], queue_pending: []}
const stats = free => ({devices: [{type: 'cuda', index: 0, vram_total: 24 * GiB,
  vram_free: free, torch_vram_total: 0, torch_vram_free: 0}]})
const flush = () => new Promise(resolve => setImmediate(resolve))

// Real Harness registry, fake external HTTP and a manually advanced clock only.
async function fixture(t, mode = 'memory', failed = false) {
  const {Context} = harnessRequire('@deepseek-ai/cordis')
  const {LocalJobRegistry} = harnessRequire('@deepseek-ai/dsh-jobs-local')
  const jobs = new LocalJobRegistry(new Context(), {maxConcurrentJobsPerOwner: 10})
  jobs.attachController('handoff-test')
  const notices = [], calls = [], pauses = []
  jobs.onJobDone(snapshot => {if (!snapshot.reported) notices.push(snapshot.id)})
  let clock = 0, recovered = false
  const submit = createSubmitComfyVideo({
    startJob: spec => jobs.start(spec),
    now: () => clock, releaseTimeoutMs: mode === 'free-hang' ? 10_000 : 2, historyPollIntervalMs: 1,
    handoffRetryIntervalMs: 5_000,
    sleep: ms => {
      if (mode === 'monitor-fault' && ms === 5_000) throw new Error('retry timer failed')
      clock += ms
      return new Promise(resolve => pauses.push({ms, resolve}))
    },
    fetchImpl: async (url, init = {}) => {
      const path = new URL(url).pathname
      calls.push({path, body: init.body})
      if (path === '/prompt') return Response.json({prompt_id: 'p'})
      if (path === '/history/p') {
        if (mode === 'history' && !recovered) return new Response('', {status: 503})
        return Response.json({p: {
          status: failed ? {completed: false, status_str: 'error', messages: [['execution_error', {exception_message: 'CUDA OOM'}]]}
            : {completed: true, status_str: 'success'},
          outputs: {1: {videos: [{filename: 'clip.mp4', type: 'output'}]}},
        }})
      }
      if (path === '/queue') return Response.json(mode === 'busy' && !recovered
        ? {queue_running: [], queue_pending: [[0, 'other']]} : idle)
      if (path === '/free') {
        if (mode === 'free-hang') return new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), {once: true})
        })
        return new Response('', {status: mode === 'free' && !recovered ? 503 : 200})
      }
      if (path === '/system_stats') {
        if (recovered) return Response.json(stats(23 * GiB))
        if (mode === 'malformed') return Response.json({devices: []})
        if (mode === 'cache') return Response.json({devices: [{type: 'cuda', index: 0,
          vram_total: 24 * GiB, vram_free: 24 * GiB * 0.9 + 16 * 1024**2,
          torch_vram_total: 32 * 1024**2, torch_vram_free: 32 * 1024**2}]})
        return Response.json(stats(8 * GiB))
      }
      if (path === '/api/models/unload' || path === '/running') return Response.json({})
      throw new Error(`Unexpected ${path}`)
    },
  })
  const result = await submit({workflow: {1: {class_type: 'Test', inputs: {}}}}, {concludeTurn() {}})
  const id = result.job_id
  t.after(async () => {jobs.kill(id); await flush()})
  await flush()
  // Exhaust the first release attempt, but leave the slow retry suspended.
  for (let i = 0; i < 4 && pauses[0]?.ms !== 5_000; i++) {
    pauses.shift()?.resolve()
    await flush()
  }
  return {jobs, id, notices, calls, recover: async () => {
    recovered = true
    pauses.shift()?.resolve()
    await flush()
  }}
}

for (const mode of ['memory', 'busy', 'free', 'malformed', 'cache']) {
  test(`${mode}: unverified release never settles or emits a completion notice`, async t => {
    // Returning the old terminal result after a timeout must fail this test.
    const f = await fixture(t, mode)
    assert.equal(f.jobs.get(f.id).status, 'running')
    assert.deepEqual(f.notices, [])
    const output = JSON.parse(f.jobs.read(f.id).text)
    assert.equal(output.phase, 'waiting_for_vram')
    assert.equal(output.execution_status, 'completed')
    assert.equal(output.output_files[0], 'clip.mp4')
    assert.equal(output.comfy_release.verified, false)
    assert.match(output.handoff_instruction, /do not.*resubmit/i)
    if (mode === 'busy') assert.equal(f.calls.some(c => c.path === '/free'), false)
    assert.equal(f.calls.some(c => c.path === '/interrupt'), false)
    assert.equal(f.calls.filter(c => c.path === '/prompt').length, 1)
    await f.recover()
    assert.equal(f.jobs.get(f.id).status, 'completed')
    assert.deepEqual(f.notices, [f.id])
    const final = f.jobs.read(f.id).text
    assert.equal(JSON.parse(final).comfy_release.verified, true)
    assert.equal(JSON.parse(final).phase, 'ready_for_review')
    assert.equal(f.jobs.read(f.id).text, final, 'terminal output remains idempotently readable')
    assert.equal(f.calls.filter(c => c.path === '/history/p').length, 1)
  })
}

test('failed generation also waits for safe handoff, preserving its original error', async t => {
  const f = await fixture(t, 'memory', true)
  assert.equal(f.jobs.get(f.id).status, 'running')
  const pending = JSON.parse(f.jobs.read(f.id).text)
  assert.equal(pending.execution_status, 'failed')
  assert.match(pending.execution_detail, /CUDA OOM/)
  await f.recover()
  assert.equal(f.jobs.get(f.id).status, 'failed')
  assert.match(f.jobs.get(f.id).detail, /CUDA OOM/)
  assert.deepEqual(f.notices, [f.id])
})

test('cancelling a waiting handoff preserves artifacts without a model wake or queue deletion', async t => {
  const f = await fixture(t)
  assert.equal(f.jobs.get(f.id).status, 'running')
  f.jobs.kill(f.id)
  await flush()
  assert.equal(f.jobs.get(f.id).status, 'killed')
  assert.equal(f.jobs.get(f.id).reported, true)
  assert.deepEqual(f.notices, [])
  const output = JSON.parse(f.jobs.read(f.id).text)
  assert.equal(output.output_files[0], 'clip.mp4')
  assert.equal(output.execution_status, 'completed')
  assert.equal(output.phase, 'cancelled')
  assert.equal(f.calls.some(c => c.path === '/queue' && c.body), false)
  assert.equal(f.calls.some(c => c.path === '/interrupt'), false)
})

test('unrelated jobs still settle normally while Comfy handoff is waiting', async t => {
  const f = await fixture(t)
  const other = f.jobs.start({kind: 'other', label: 'Unrelated', run: () => ({cancel() {}, done: Promise.resolve({status: 'completed'})})})
  await flush()
  assert.equal(f.jobs.get(f.id).status, 'running')
  assert.equal(f.jobs.get(other).status, 'completed')
  assert.deepEqual(f.notices, [other])
})

test('history transport errors remain readable and cannot wake a model before handoff', async t => {
  const f = await fixture(t, 'history')
  assert.equal(f.jobs.get(f.id).status, 'running')
  assert.deepEqual(f.notices, [])
  const output = JSON.parse(f.jobs.read(f.id).text)
  assert.equal(output.phase, 'waiting_for_history')
  assert.match(output.monitor_error, /503/)
  await f.recover()
  assert.equal(f.jobs.get(f.id).status, 'completed')
  assert.deepEqual(f.notices, [f.id])
})

test('cancelling before initial LLM unload finishes immediately stops the monitor', async t => {
  const {Context} = harnessRequire('@deepseek-ai/cordis')
  const {LocalJobRegistry} = harnessRequire('@deepseek-ai/dsh-jobs-local')
  const jobs = new LocalJobRegistry(new Context(), {maxConcurrentJobsPerOwner: 10})
  jobs.attachController('handoff-test')
  let id, finishUnload, concluded = false
  const unload = new Promise(resolve => {finishUnload = resolve})
  const calls = [], notices = []
  jobs.onJobDone(snapshot => {if (!snapshot.reported) notices.push(snapshot.id)})
  const submit = createSubmitComfyVideo({
    startJob(spec) {id = jobs.start(spec); return id},
    fetchImpl: async (url, init = {}) => {
      const path = new URL(url).pathname
      calls.push({path, body: init.body})
      if (path === '/prompt') return Response.json({prompt_id: 'p'})
      if (path === '/api/models/unload') {await unload; return Response.json({})}
      if (path === '/running' || path === '/queue') return Response.json({})
      throw new Error(`Unexpected ${path}`)
    },
  })
  const submission = submit({workflow: {1: {class_type: 'Test', inputs: {}}}}, {concludeTurn() {concluded = true}})
  t.after(async () => {finishUnload(); await submission; jobs.kill(id); await flush()})
  await flush()
  jobs.kill(id)
  await flush()
  assert.equal(concluded, false, 'unload is still stalled during cancellation')
  assert.equal(jobs.get(id).status, 'killed', 'monitor must not depend on unload completing to stop')
  assert.equal(jobs.get(id).reported, true)
  assert.deepEqual(notices, [])
  assert.equal(calls.some(c => c.path.startsWith('/history') || c.path === '/free'), false)
  assert.deepEqual(JSON.parse(calls.find(c => c.path === '/queue').body), {delete: ['p']})
})

for (const [mode, phase] of [['free-hang', 'waiting_for_vram'], ['monitor-fault', 'monitor_error']]) {
  test(`${mode}: cancellation releases a blocked monitor without losing generated output`, async t => {
    const f = await fixture(t, mode)
    assert.equal(f.jobs.get(f.id).status, 'running')
    assert.deepEqual(f.notices, [])
    const waiting = JSON.parse(f.jobs.read(f.id).text)
    assert.equal(waiting.phase, phase)
    assert.equal(waiting.output_files[0], 'clip.mp4', 'artifacts are readable even before cleanup returns')
    if (mode === 'monitor-fault') assert.match(waiting.monitor_error, /retry timer failed/)
    f.jobs.kill(f.id)
    await flush()
    assert.equal(f.jobs.get(f.id).status, 'killed')
    assert.equal(f.jobs.get(f.id).reported, true)
    assert.deepEqual(f.notices, [])
    const cancelled = JSON.parse(f.jobs.read(f.id).text)
    assert.equal(cancelled.phase, 'cancelled')
    assert.equal(cancelled.output_files[0], 'clip.mp4')
    assert.equal(f.calls.some(c => c.path === '/queue' && c.body), false)
  })
}

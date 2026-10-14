import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, createSubmitComfyVideo, inject } from './submit-comfy-video.mjs'

const H3_SECTIONS_TEXT = [
  'subject_definitions: <Picture 1> defines the actor.',
  'summary: The actor crosses the room.',
  'retention_analysis: Preserve identity and wardrobe.',
  'detailed_description: 0-5s: the actor crosses the room.',
  'overall_soundscape: Footsteps and room tone.',
  'non_diegetic_music: None.',
].join('\n')

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function releasedComfyResponse(url) {
  if (String(url).endsWith('/queue')) return jsonResponse(200, {queue_running: [], queue_pending: []})
  if (String(url).endsWith('/free')) return jsonResponse(200, {})
  if (String(url).endsWith('/system_stats')) return jsonResponse(200, {devices: [{type: 'cuda', index: 0,
    vram_total: 24 * 1024**3, vram_free: 23 * 1024**3, torch_vram_total: 0, torch_vram_free: 0}]})
}

test('submits a raw graph, unloads llama-swap, and concludes the turn', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/prompt')) {
      return jsonResponse(200, { prompt_id: 'prompt-123', number: 7 })
    }
    if (String(url).endsWith('/api/models/unload')) {
      return jsonResponse(200, { unloaded: true })
    }
    if (String(url).endsWith('/running')) {
      return jsonResponse(200, {})
    }
    throw new Error(`Unexpected request: ${url}`)
  }
  let concluded = 0
  const submit = createSubmitComfyVideo({ fetchImpl, sleep: async () => {} })

  const result = await submit(
    { workflow: { '1': { class_type: 'TestNode', inputs: {} } } },
    { signal: undefined, concludeTurn: () => { concluded += 1 } },
  )

  assert.deepEqual(JSON.parse(calls[0].init.body), {
    prompt: { '1': { class_type: 'TestNode', inputs: {} } },
  })
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[1].url, 'http://127.0.0.1:11435/api/models/unload')
  assert.equal(concluded, 1)
  assert.equal(result.prompt_id, 'prompt-123')
  assert.equal(result.llm_unloaded, true)
  assert.equal(result.terminal, true)
})

test('parses a string prompt wrapper without nesting it again', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/prompt')) return jsonResponse(200, { prompt_id: 'p2' })
    if (String(url).endsWith('/api/models/unload')) return jsonResponse(200, {})
    if (String(url).endsWith('/running')) return jsonResponse(200, {})
    throw new Error(`Unexpected request: ${url}`)
  }
  const submit = createSubmitComfyVideo({ fetchImpl, sleep: async () => {} })

  await submit(
    { workflow: { prompt: JSON.stringify({ '9': { class_type: 'Node', inputs: {} } }) } },
    { concludeTurn() {} },
  )

  assert.deepEqual(JSON.parse(calls[0].init.body), {
    prompt: { '9': { class_type: 'Node', inputs: {} } },
  })
})

test('still concludes after Comfy accepts the job when unload fails', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/prompt')) return jsonResponse(200, { prompt_id: 'accepted' })
    if (String(url).endsWith('/api/models/unload')) return jsonResponse(500, { error: 'busy' })
    if (String(url).endsWith('/unload')) return jsonResponse(500, { error: 'still busy' })
    throw new Error(`Unexpected request: ${url}`)
  }
  let concluded = 0
  const submit = createSubmitComfyVideo({ fetchImpl, sleep: async () => {} })

  const result = await submit(
    { workflow: { a: { class_type: 'Node', inputs: {} } } },
    { concludeTurn: () => { concluded += 1 } },
  )

  assert.equal(concluded, 1)
  assert.equal(result.llm_unloaded, false)
  assert.match(result.warning, /unload/i)
})

test('does not unload or conclude when Comfy rejects the workflow', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return jsonResponse(400, { error: 'invalid prompt' })
  }
  let concluded = 0
  const submit = createSubmitComfyVideo({ fetchImpl, sleep: async () => {} })

  await assert.rejects(
    submit(
      { workflow: { bad: true } },
      { concludeTurn: () => { concluded += 1 } },
    ),
    /ComfyUI rejected/i,
  )

  assert.equal(calls.length, 1)
  assert.equal(concluded, 0)
})

test('registers an owned background job that completes with Comfy output paths', async () => {
  const owner = { id: 'session-1' }
  let registered
  let hooks
  const startJob = (spec) => {
    registered = spec
    hooks = spec.run()
    return 'comfy-1'
  }
  const fetchImpl = async (url) => {
    const cleanup = releasedComfyResponse(url)
    if (cleanup) return cleanup
    if (String(url).endsWith('/prompt')) return jsonResponse(200, { prompt_id: 'watched-prompt' })
    if (String(url).endsWith('/history/watched-prompt')) {
      return jsonResponse(200, {
        'watched-prompt': {
          status: { status_str: 'success', completed: true, messages: [] },
          outputs: {
            '42': {
              videos: [{ filename: 'shot-01.mp4', subfolder: 'directed', type: 'output' }],
            },
          },
        },
      })
    }
    if (String(url).endsWith('/api/models/unload')) return jsonResponse(200, {})
    if (String(url).endsWith('/running')) return jsonResponse(200, {})
    throw new Error(`Unexpected request: ${url}`)
  }
  const submit = createSubmitComfyVideo({
    fetchImpl,
    sleep: async () => {},
    startJob,
  })

  const result = await submit(
    { workflow: { '1': { class_type: 'TestNode', inputs: {} } } },
    { agent: owner, concludeTurn() {} },
  )
  const outcome = await hooks.done

  assert.equal(result.job_id, 'comfy-1')
  assert.equal(registered.kind, 'comfy')
  assert.equal(registered.owner, owner)
  assert.equal(outcome.status, 'completed')
  assert.match(outcome.output, /directed\/shot-01\.mp4/)
  assert.match(outcome.output, /http:\/\/127\.0\.0\.1:8188\/view\?filename=shot-01\.mp4&subfolder=directed&type=output/)
})

test('rejects an H3-intent raw graph whose prompt has no reference connections', async () => {
  let requests = 0
  const submit = createSubmitComfyVideo({
    fetchImpl: async () => {
      requests += 1
      throw new Error('validation should happen before network requests')
    },
  })
  const prompt = H3_SECTIONS_TEXT

  await assert.rejects(
    submit({
      intent: 'h3_ref2av',
      workflow: {
        '6': { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { prompt } },
      },
    }, { concludeTurn() {} }),
    /reference connections/i,
  )

  assert.equal(requests, 0)
})

test('rejects noncontiguous H3 reference bindings before submission', async () => {
  let requests = 0
  const submit = createSubmitComfyVideo({
    fetchImpl: async () => {
      requests += 1
      throw new Error('validation should happen before network requests')
    },
  })

  await assert.rejects(
    submit({
      intent: 'h3_ref2av',
      workflow: {
        '2': { class_type: 'LoadImage', inputs: { image: 'actor.png' } },
        '3': { class_type: 'LoadImage', inputs: { image: 'layout.png' } },
        '6': {
          class_type: 'MiniMaxH3ReferenceToVideo',
          inputs: {
            prompt: H3_SECTIONS_TEXT,
            'ref_images.ref_image_0': ['2', 0],
            'ref_images.ref_image_2': ['3', 0],
          },
        },
      },
    }, { concludeTurn() {} }),
    /contiguous/i,
  )

  assert.equal(requests, 0)
})

test('plugin wiring registers Comfy monitoring through the Harness jobs service', async () => {
  const originalFetch = globalThis.fetch
  let registeredTool
  let registeredJob
  let hooks
  globalThis.fetch = async (url) => {
    const cleanup = releasedComfyResponse(url)
    if (cleanup) return cleanup
    if (String(url).endsWith('/prompt')) return jsonResponse(200, { prompt_id: 'wired-prompt' })
    if (String(url).endsWith('/history/wired-prompt')) {
      return jsonResponse(200, {
        'wired-prompt': {
          status: { status_str: 'success', completed: true, messages: [] },
          outputs: {},
        },
      })
    }
    if (String(url).endsWith('/api/models/unload')) return jsonResponse(200, {})
    if (String(url).endsWith('/running')) return jsonResponse(200, {})
    throw new Error(`Unexpected request: ${url}`)
  }
  const ctx = {
    tools: {
      register(definition) {
        registeredTool = definition
        return () => {}
      },
    },
    jobs: {
      start(spec) {
        registeredJob = spec
        hooks = spec.run()
        return 'comfy-9'
      },
    },
    effect(callback) {
      return callback()
    },
  }

  try {
    apply(ctx)
    const result = await registeredTool.execute(
      { workflow: { '1': { class_type: 'Node', inputs: {} } } },
      { agent: { id: 'owner-9' }, concludeTurn() {} },
    )
    const outcome = await hooks.done

    assert.deepEqual(inject, ['tools', 'jobs'])
    assert.equal(result.job_id, 'comfy-9')
    assert.equal(registeredJob.owner.id, 'owner-9')
    assert.equal(outcome.status, 'completed')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('settles a Comfy execution error even when completed is false', async () => {
  let hooks
  let historyCalls = 0
  const submit = createSubmitComfyVideo({
    startJob(spec) {
      hooks = spec.run()
      return 'comfy-error-1'
    },
    sleep: async () => {},
    fetchImpl: async (url) => {
      const cleanup = releasedComfyResponse(url)
      if (cleanup) return cleanup
      if (String(url).endsWith('/prompt')) return jsonResponse(200, { prompt_id: 'failed-prompt' })
      if (String(url).endsWith('/history/failed-prompt')) {
        historyCalls += 1
        if (historyCalls > 1) throw new Error('monitor polled again after terminal error')
        return jsonResponse(200, {
          'failed-prompt': {
            status: {
              status_str: 'error',
              completed: false,
              messages: [['execution_error', { exception_type: 'OutOfMemoryError', exception_message: 'CUDA OOM' }]],
            },
            outputs: {},
          },
        })
      }
      if (String(url).endsWith('/api/models/unload')) return jsonResponse(200, {})
      if (String(url).endsWith('/running')) return jsonResponse(200, {})
      throw new Error(`Unexpected request: ${url}`)
    },
  })

  await submit(
    { workflow: { '1': { class_type: 'Node', inputs: {} } } },
    { agent: { id: 'owner-error' }, concludeTurn() {} },
  )
  const outcome = await hooks.done

  assert.equal(outcome.status, 'failed')
  assert.match(outcome.detail, /CUDA OOM/)
  assert.equal(historyCalls, 1)
})

test('cancelling monitoring deletes only its exact queued Comfy prompt', async () => {
  let hooks
  const cancellationRequests = []
  const submit = createSubmitComfyVideo({
    startJob(spec) {
      hooks = spec.run()
      return 'comfy-cancel-1'
    },
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith('/prompt')) return jsonResponse(200, { prompt_id: 'cancel-me' })
      if (String(url).endsWith('/history/cancel-me')) {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        })
      }
      if (String(url).endsWith('/queue')) {
        cancellationRequests.push({ url: String(url), init })
        return jsonResponse(200, {})
      }
      if (String(url).endsWith('/interrupt')) {
        cancellationRequests.push({ url: String(url), init })
        return jsonResponse(200, {})
      }
      if (String(url).endsWith('/api/models/unload')) return jsonResponse(200, {})
      if (String(url).endsWith('/running')) return jsonResponse(200, {})
      throw new Error(`Unexpected request: ${url}`)
    },
  })

  await submit(
    { workflow: { '1': { class_type: 'Node', inputs: {} } } },
    { agent: { id: 'owner-cancel' }, concludeTurn() {} },
  )
  hooks.cancel('no longer needed')
  const outcome = await hooks.done

  assert.equal(outcome.status, 'killed')
  assert.equal(cancellationRequests.length, 1)
  assert.equal(cancellationRequests[0].url, 'http://127.0.0.1:8188/queue')
  assert.deepEqual(JSON.parse(cancellationRequests[0].init.body), { delete: ['cancel-me'] })
})

test('registers a generic Comfy job tool while preserving the legacy video tool', () => {
  const registered = []
  const ctx = {
    tools: {
      register(definition) {
        registered.push(definition)
        return () => {}
      },
    },
    jobs: { start() {} },
    effect(callback) {
      return callback()
    },
  }

  apply(ctx)

  assert.deepEqual(registered.map((tool) => tool.name), [
    'submit_comfy_job',
    'submit_comfy_video',
  ])
  assert.match(registered[0].description, /image.*video/i)
  assert.match(registered[0].description, /instead of manually/i)
  assert.match(registered[0].description, /never retry an identical failed workflow/i)
  assert.match(registered[0].description, /output_artifacts.*do not search/i)
  assert.match(registered[0].description, /Invoke-WebRequest.*never use web_fetch/i)
  assert.match(registered[0].description, /object_info.*recursive filesystem/i)
})

import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { H3_REVIEW_SCHEMA, validateH3Preflight } from './h3-preflight.mjs'
import {entriesFromEvents,assertProposalSubmission} from './proposal-state.mjs'

const COMFY_PROMPT_URL = 'http://127.0.0.1:8188/prompt'
const LLAMA_SWAP_BASE_URL = 'http://127.0.0.1:11435'
const DEFAULT_UNLOAD_TIMEOUT_MS = 15_000
const DEFAULT_POLL_INTERVAL_MS = 250
const DEFAULT_HISTORY_POLL_INTERVAL_MS = 1_000
const H3_TIMING_PATH = fileURLToPath(new URL('./h3-timing.mjs', import.meta.url))
// Tool descriptions are copied into native shell calls: JSON quotes would
// expand $ and $(...) in valid installation paths. Match the host shell.
const H3_TIMING_SHELL_PATH = "'" + H3_TIMING_PATH.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''") + "'"
const H3_PROMPT_SECTIONS = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
]

export const name = 'submit-comfy-video'
export const inject = ['tools', 'jobs']

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

async function responseBody(response) {
  const text = await response.text()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function normalizePrompt(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('submit_comfy_video: workflow JSON must be an object')
  }

  if (!Object.hasOwn(value, 'prompt')) return { prompt: value }

  const prompt = value.prompt
  if (typeof prompt === 'string') {
    let parsed
    try {
      parsed = JSON.parse(prompt)
    } catch (error) {
      throw new Error(`submit_comfy_video: workflow.prompt is not valid JSON: ${errorText(error)}`)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('submit_comfy_video: parsed workflow.prompt must be an object')
    }
    return { ...value, prompt: parsed }
  }

  if (typeof prompt !== 'object' || prompt === null || Array.isArray(prompt)) {
    throw new Error('submit_comfy_video: workflow.prompt must be an object or a JSON string')
  }
  return value
}

function onlyNode(graph, classType) {
  const matches = Object.values(graph).filter((node) => node?.class_type === classType)
  if (matches.length !== 1) {
    throw new Error(`submit_comfy_video: H3 workflow must contain exactly one ${classType} node`)
  }
  return matches[0]
}

function h3PromptText(sections, label = 'h3_prompt') {
  if (typeof sections !== 'object' || sections === null || Array.isArray(sections)) {
    throw new Error(`submit_comfy_video: ${label} must contain the six H3 prompt sections`)
  }
  const unknown = Object.keys(sections).filter(key => !H3_PROMPT_SECTIONS.includes(key))
  if (unknown.length) throw new Error(`submit_comfy_video: ${label} has unknown sections: ${unknown.join(', ')}`)
  return H3_PROMPT_SECTIONS.map((key) => {
    const value = sections[key]
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`submit_comfy_video: ${label}.${key} must be a non-empty string`)
    }
    return `${key}: ${value.trim()}`
  }).join('\n')
}

function h3Generation(graph) {
  const nodes = Object.values(graph).filter(node => node?.class_type === 'MiniMaxH3ReferenceToVideo')
  if (nodes.length !== 1) return undefined
  const { width, height, length } = nodes[0].inputs ?? {}
  const resolved = Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0
  const orientation = resolved ? (width === height ? 'square' : width > height ? 'landscape' : 'portrait') : 'dynamic'
  return { width, height, orientation, length }
}

function h3CanvasLines(value) {
  const settings = value.h3_generation
  if (!settings) return []
  return [`H3 workflow canvas: ${JSON.stringify(settings.width) ?? 'unresolved'} × ${JSON.stringify(settings.height) ?? 'unresolved'} (${settings.orientation}), length ${JSON.stringify(settings.length) ?? 'unresolved'}. These are graph settings; verify decoded video dimensions after completion.`]
}

async function loadWorkflow(args, options) {
  const hasWorkflow = typeof args.workflow === 'object' && args.workflow !== null
  const hasPath = typeof args.workflow_path === 'string' && args.workflow_path.trim() !== ''
  if (Object.hasOwn(args, 'h3_ref2av')) throw new Error('submit_comfy_video: no bundled workflow is supplied. Use workflow or workflow_path from the local ComfyUI setup; h3_ref2av builder arguments are no longer supported.')
  if (Number(hasWorkflow) + Number(hasPath) !== 1) {
    throw new Error('submit_comfy_video: provide exactly one of workflow or workflow_path. h3_prompt/h3_prompt_path is only a prompt override, not a workflow. Pass the selected local workflow_path plus h3_prompt_path. Do not switch workflows just to fix this argument error.')
  }

  if (hasWorkflow) return normalizePrompt(args.workflow)

  const requested = args.workflow_path.trim()
  const path = isAbsolute(requested) ? requested : resolve(process.cwd(), requested)
  let parsed
  try {
    parsed = JSON.parse(await options.readFileImpl(path, 'utf8'))
  } catch (error) {
    throw new Error(`submit_comfy_video: cannot read workflow ${path}: ${errorText(error)}`)
  }
  return normalizePrompt(parsed)
}

async function applyH3Prompt(payload, args, readFileImpl) {
  const inline = args.h3_prompt !== undefined
  const file = args.h3_prompt_path !== undefined
  if (!inline && !file) return payload
  if (inline && file) throw new Error('submit_comfy_video: provide exactly one of h3_prompt or h3_prompt_path, not both')
  let sections = args.h3_prompt
  if (file) {
    if (typeof args.h3_prompt_path !== 'string' || !args.h3_prompt_path.trim()) throw new Error('submit_comfy_video: h3_prompt_path must be a non-empty path')
    const path = resolve(process.cwd(), args.h3_prompt_path.trim())
    try { sections = JSON.parse(await readFileImpl(path, 'utf8')) }
    catch (error) { throw new Error(`submit_comfy_video: cannot read H3 prompt ${path}: ${errorText(error)}`) }
  }
  const text = h3PromptText(sections, 'h3_prompt')
  const copy = structuredClone(payload)
  const node = onlyNode(copy.prompt, 'MiniMaxH3ReferenceToVideo')
  if (!node.inputs || typeof node.inputs !== 'object') throw new Error('submit_comfy_video: H3 node requires inputs')
  node.inputs.prompt = text
  return copy
}

function validateConnectionIndices(graph) {
  const errors=[]
  for (const [nodeId, node] of Object.entries(graph)) for (const [inputName, binding] of Object.entries(node?.inputs ?? {})) {
    if (!Array.isArray(binding) || binding.length !== 2 || !Object.hasOwn(graph, String(binding[0]))) continue
    if (Number.isInteger(binding[1]) && binding[1] >= 0) continue
    const index=Number.isInteger(Number(binding[1]))&&Number(binding[1])>=0?Number(binding[1]):0
    errors.push(`node ${nodeId} input ${inputName} has ${JSON.stringify(binding)}; use [${JSON.stringify(String(binding[0]))}, ${index}]`)
  }
  if(errors.length)throw new Error(`submit_comfy_job: ${errors.length} invalid ComfyUI connection index(es); output indices must be numeric non-negative integers, not strings. PowerShell JSON rewrites can turn 0 into "0".\n${errors.slice(0,12).join('\n')}${errors.length>12?`\n...and ${errors.length-12} more`:''}`)
}

function validateH3Ref2AVGraph(graph) {
  const matches = Object.values(graph).filter((node) => node?.class_type === 'MiniMaxH3ReferenceToVideo')
  if (matches.length !== 1) {
    throw new Error('submit_comfy_video: h3_ref2av intent requires exactly one MiniMaxH3ReferenceToVideo node')
  }
  const h3 = matches[0]
  for (const group of ['ref_images', 'ref_audios', 'ref_videos', 'ref_video_audios']) {
    if (Object.hasOwn(h3.inputs ?? {}, group)) {
      throw new Error(`submit_comfy_video: nested ${group} is not a ComfyUI API connection; use flat top-level sockets such as "ref_images.ref_image_0": ["node_id", 0]. ComfyUI ignores nested reference dictionaries.`)
    }
  }
  const prompt = h3.inputs?.prompt
  if (typeof prompt !== 'string') {
    throw new Error('submit_comfy_video: H3 prompt must be a string with all six sections')
  }
  for (const section of H3_PROMPT_SECTIONS) {
    const pattern = new RegExp(`(?:^|\\n)${section}:\\s*\\S`, 'm')
    if (!pattern.test(prompt)) {
      throw new Error(`submit_comfy_video: H3 prompt section ${section} is missing or empty`)
    }
  }

  const references = new Map()
  for (const [key, binding] of Object.entries(h3.inputs ?? {})) {
    if (key.startsWith('ref_images.')) references.set(key.slice('ref_images.'.length), binding)
  }
  if (references.size < 1 || references.size > 9) {
    throw new Error('submit_comfy_video: H3 requires 1-9 actual reference connections')
  }

  const ordered = [...references.entries()].map(([key, binding]) => {
    const match = /^ref_image_(\d+)$/.exec(key)
    if (!match) throw new Error(`submit_comfy_video: invalid H3 reference key ${key}`)
    return { index: Number(match[1]), binding }
  }).sort((a, b) => a.index - b.index)
  if (ordered.some((item, index) => item.index !== index)) {
    throw new Error('submit_comfy_video: H3 reference connections must be contiguous from ref_image_0')
  }

  const sourceIds = new Set()
  for (const { index, binding } of ordered) {
    if (!Array.isArray(binding) || binding.length < 2) {
      throw new Error(`submit_comfy_video: ref_image_${index} is not a ComfyUI node connection`)
    }
    const sourceId = String(binding[0])
    const source = graph[sourceId]
    if (source?.class_type !== 'LoadImage' || typeof source.inputs?.image !== 'string' || source.inputs.image.trim() === '') {
      throw new Error(`submit_comfy_video: ref_image_${index} must connect to a LoadImage node with a staged filename`)
    }
    if (isAbsolute(source.inputs.image) || /^[a-z]:[\\/]|^[a-z]+:\/\//i.test(source.inputs.image)) {
      throw new Error(`submit_comfy_video: LoadImage.inputs.image for Picture ${index+1} is a local absolute path or URL, not a staged filename. Call director_stage_images with the original source_path; put its returned image into this LoadImage and h3_review.references[].image, keeping source_path unchanged.`)
    }
    if (sourceIds.has(sourceId)) {
      throw new Error('submit_comfy_video: every H3 Picture must use a distinct LoadImage connection')
    }
    sourceIds.add(sourceId)
  }
}

function runningModelNames(body) {
  if (Array.isArray(body)) {
    return body.map((item) => typeof item === 'string' ? item : item?.model ?? item?.name).filter(Boolean)
  }
  if (typeof body !== 'object' || body === null) return []
  if (Array.isArray(body.running)) return runningModelNames(body.running)
  if (Array.isArray(body.models)) return runningModelNames(body.models)
  return Object.keys(body).filter((key) => body[key] !== false && body[key] !== null)
}

async function unloadLlamaSwap(fetchImpl, signal, sleep, timeoutMs, pollIntervalMs) {
  let unloadResponse = await fetchImpl(`${LLAMA_SWAP_BASE_URL}/api/models/unload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal,
  })

  if (!unloadResponse.ok) {
    unloadResponse = await fetchImpl(`${LLAMA_SWAP_BASE_URL}/unload`, {
      method: 'GET',
      signal,
    })
  }
  if (!unloadResponse.ok) {
    const body = await responseBody(unloadResponse)
    throw new Error(`llama-swap unload failed (${unloadResponse.status}): ${JSON.stringify(body)}`)
  }

  const deadline = Date.now() + timeoutMs
  let lastRunning = []
  while (Date.now() <= deadline) {
    const response = await fetchImpl(`${LLAMA_SWAP_BASE_URL}/running`, { signal })
    if (!response.ok) {
      const body = await responseBody(response)
      throw new Error(`llama-swap running check failed (${response.status}): ${JSON.stringify(body)}`)
    }
    lastRunning = runningModelNames(await responseBody(response))
    if (lastRunning.length === 0) return { unloaded: true, runningModels: [] }
    await sleep(pollIntervalMs)
  }

  throw new Error(`llama-swap unload timed out; still running: ${lastRunning.join(', ') || 'unknown'}`)
}

function comfyOutputArtifacts(outputs, comfyBaseUrl = 'http://127.0.0.1:8188') {
  const artifacts = []
  for (const nodeOutput of Object.values(outputs ?? {})) {
    if (typeof nodeOutput !== 'object' || nodeOutput === null) continue
    for (const value of Object.values(nodeOutput)) {
      if (!Array.isArray(value)) continue
      for (const item of value) {
        if (typeof item?.filename !== 'string' || item.filename === '') continue
        const subfolder = typeof item.subfolder === 'string' ? item.subfolder : ''
        const type = typeof item.type === 'string' && item.type !== '' ? item.type : 'output'
        artifacts.push({
          relative_path: [subfolder, item.filename].filter(Boolean).join('/'),
          view_url: `${comfyBaseUrl}/view?filename=${encodeURIComponent(item.filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`,
        })
      }
    }
  }
  return [...new Map(artifacts.map((artifact) => [artifact.view_url, artifact])).values()]
}

function comfyFailureDetail(entry) {
  const messages = entry?.status?.messages
  if (!Array.isArray(messages)) return 'ComfyUI execution failed'
  const error = [...messages].reverse().find((message) => message?.[0] === 'execution_error')
  const detail = error?.[1]
  return String(detail?.exception_message ?? detail?.exception_type ?? 'ComfyUI execution failed').slice(0, 1_000)
}

async function releaseComfyMemory({fetchImpl, sleep, signal, pollIntervalMs, releaseTimeoutMs, now}) {
  const deadline = now() + releaseTimeoutMs
  let requested = false, lastReason = 'ComfyUI queue did not become idle', devices
  const request = async (path, init = {}) => {
    signal.throwIfAborted()
    const timeout = AbortSignal.timeout(Math.max(1, Math.min(5_000, deadline - now())))
    const response = await fetchImpl(`http://127.0.0.1:8188${path}`, {...init, signal: AbortSignal.any([signal, timeout])})
    if (!response.ok) throw new Error(`ComfyUI cleanup ${path} failed (${response.status})`)
    return responseBody(response)
  }
  const queueIdle = async () => {
    const queue = await request('/queue')
    if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new Error('ComfyUI cleanup received invalid queue evidence')
    return queue.queue_running.length === 0 && queue.queue_pending.length === 0
  }
  try {
    while (now() < deadline) {
      if (!await queueIdle()) {
        requested = false
        lastReason = 'ComfyUI queue did not become idle; no other jobs were interrupted'
      } else {
        if (!requested) {
          await request('/free', {method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({unload_models:true,free_memory:true})})
          requested = true
        }
        const stats = await request('/system_stats')
        if (!Array.isArray(stats.devices) || stats.devices.length === 0) throw new Error('ComfyUI cleanup received invalid system_stats device evidence')
        devices = stats.devices.map(device => {
          if (device.type === 'cpu') return {type:'cpu'}
          const {vram_total:total,vram_free:free,torch_vram_total:reserved,torch_vram_free:cached} = device
          if (device.type !== 'cuda' || ![total,free,reserved,cached].every(value=>typeof value==='number' && Number.isFinite(value) && value>=0) || total===0 || free>total || cached>reserved || reserved>total) {
            throw new Error('ComfyUI cleanup received unsupported or invalid system_stats device evidence')
          }
          return {type:device.type,index:device.index,vram_total:total,physical_free_bytes:Math.max(0,free-cached),torch_reserved_bytes:reserved}
        })
        // Torch reserved bytes alone omit allocations such as Dynamic VRAM/aimdo.
        // This is conservative headroom evidence, not proof that a particular LLM fits.
        const cleared = devices.every(device=>device.type==='cpu' || (device.torch_reserved_bytes<=64*1024**2 && device.physical_free_bytes>=device.vram_total*0.9))
        if (cleared && await queueIdle()) return {verified:true,devices}
        lastReason = 'ComfyUI VRAM release/headroom was not confirmed (requires <=64 MiB Torch reserved and >=90% physical free)'
      }
      await monitorSleep(Math.min(pollIntervalMs, Math.max(1,deadline-now())), {sleep, signal})
    }
    return {verified:false,warning:`${lastReason}; cleanup timed out`,...(devices ? {devices} : {})}
  } catch (error) {
    if (signal.aborted) throw error
    return {verified:false,warning:errorText(error),...(devices ? {devices} : {})}
  }
}

// Both the initial handoff gate and retry timers must observe cancellation.
async function monitorWait(start, signal) {
  signal.throwIfAborted()
  let onAbort
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, {once: true})
  })
  try { await Promise.race([start(), aborted]) }
  finally { signal.removeEventListener('abort', onAbort) }
  signal.throwIfAborted()
}

function monitorSleep(ms, {sleep, signal}) {
  return monitorWait(() => sleep(ms), signal)
}

async function monitorComfyPrompt(promptId, options) {
  const { fetchImpl, signal, pollIntervalMs, comfyBaseUrl, publish, handoffRetryIntervalMs } = options
  // A cached/fast workflow must not wake the model before the submitting turn yields.
  await monitorWait(() => options.handoffReady, signal)
  while (!signal.aborted) {
    let entry
    try {
      const response = await fetchImpl(`http://127.0.0.1:8188/history/${encodeURIComponent(promptId)}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(`ComfyUI history failed (${response.status}): ${JSON.stringify(body)}`)
      entry = body?.[promptId]
    } catch (error) {
      signal.throwIfAborted()
      // A transport failure says nothing about whether Comfy still owns the GPU.
      publish({prompt_id: promptId, phase: 'waiting_for_history', monitor_error: errorText(error),
        handoff_instruction: 'Monitoring is waiting for ComfyUI history; do not resubmit this prompt or assume GPU release.'})
      await monitorSleep(handoffRetryIntervalMs, options)
      continue
    }
    const status = String(entry?.status?.status_str ?? '').toLowerCase()
    const failed = status === 'error' || status === 'failed'
    if (failed || entry?.status?.completed === true) {
      const artifacts = comfyOutputArtifacts(entry.outputs, comfyBaseUrl)
      const files = artifacts.map((artifact) => artifact.relative_path)
      const detail = failed ? comfyFailureDetail(entry) : files.length > 0 ? `${files.length} output file(s)` : 'completed without reported output files'
      const output = {prompt_id: promptId, execution_status: failed ? 'failed' : 'completed', execution_detail: detail,
        output_files: files, output_artifacts: artifacts,
        review_instruction: 'Download the exact recorded output_artifacts view_url files into this session workspace. Inspect the actual result for visual QC, then call director_show_media with the local file paths to show images/videos in the conversation. Display does not establish acceptance. Do not generate extra clips automatically.'}
      const pending = release => publish({...output, phase: 'waiting_for_vram', comfy_release: release,
        handoff_instruction: 'ComfyUI execution has ended. Waiting for verified GPU handoff; do not resubmit or regenerate this prompt. Read saved output_artifacts without waiting for the job to finish, or cancel only this monitor. A new user message can still load the LLM.'})
      // Publish artifacts before cleanup, but do not settle the registry job: any
      // unreported terminal outcome would wake the model, including failures.
      pending({verified: false, warning: 'VRAM release verification pending'})
      while (!signal.aborted) {
        const release = await releaseComfyMemory({...options, pollIntervalMs: Math.max(pollIntervalMs, handoffRetryIntervalMs)})
        signal.throwIfAborted()
        if (release.verified) {
          const final = {...output, phase: 'ready_for_review', comfy_release: release}
          publish(final)
          return {status: output.execution_status, detail, output: JSON.stringify(final)}
        }
        pending(release)
        await monitorSleep(handoffRetryIntervalMs, options)
      }
      signal.throwIfAborted()
    }
    await monitorSleep(pollIntervalMs, options)
  }
  return { status: 'killed', detail: 'ComfyUI monitoring cancelled' }
}

function startComfyMonitor(startJob, promptId, owner, options) {
  if (typeof startJob !== 'function') return undefined
  return startJob({
    kind: 'comfy',
    label: `ComfyUI prompt ${promptId}`,
    owner,
    outputLimitBytes: 16_384,
    run() {
      const controller = new AbortController()
      let cancelled = false
      let current, unread = '', terminal = false
      const publish = value => {current = value; unread = JSON.stringify(value);options.onGpuState?.(value)}
      const done = monitorComfyPrompt(promptId, {
        ...options,
        signal: controller.signal,
        publish,
      }).catch(async (error) => {
        if (cancelled || error?.name === 'AbortError') {
          publish({...current, prompt_id: promptId, phase: 'cancelled'})
          return { status: 'killed', detail: 'ComfyUI monitoring cancelled', output: JSON.stringify(current) }
        }
        // Unexpected monitor errors must fail closed, not wake an LLM into an
        // unknown GPU state. Keep evidence readable until explicitly cancelled.
        publish({...current, prompt_id: promptId, phase: 'monitor_error', monitor_error: errorText(error).slice(0, 1_000)})
        if (!controller.signal.aborted) await new Promise(resolve => controller.signal.addEventListener('abort', resolve, {once: true}))
        publish({...current, phase: 'cancelled'})
        return {status: 'killed', detail: 'ComfyUI monitoring cancelled', output: JSON.stringify(current)}
      }).then(outcome => {
        terminal = true
        return outcome
      })
      return {
        readOutput() {
          const text = terminal && current ? JSON.stringify(current) : unread
          unread = ''
          return text
        },
        cancel() {
          if (cancelled) return
          cancelled = true
          controller.abort()
          // Once execution ended, cancelling means stopping only the monitor.
          if (current?.execution_status) return
          void options.fetchImpl('http://127.0.0.1:8188/queue', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ delete: [promptId] }),
          }).catch(() => {})
        },
        done,
      }
    },
  })
}

export function createSubmitComfyVideo({
  fetchImpl: suppliedFetch = globalThis.fetch,
  comfyBaseUrl = 'http://127.0.0.1:8188',
  llamaSwapBaseUrl = 'http://127.0.0.1:11435',
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  readFileImpl = readFile,
  unloadTimeoutMs = DEFAULT_UNLOAD_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  historyPollIntervalMs = DEFAULT_HISTORY_POLL_INTERVAL_MS,
  releaseTimeoutMs = 120_000,
  handoffRetryIntervalMs = 5_000,
  now = Date.now,
  startJob,
  onGpuState: observeGpuState,
} = {}) {
  // UI observation must never alter the managed submission/handoff protocol.
  const onGpuState=value=>{try{observeGpuState?.(value)}catch{}};
  // One transport boundary covers preflight/monitor/cancel/unload.
  const origins = new Map([['http://127.0.0.1:8188', new URL(comfyBaseUrl).origin], ['http://127.0.0.1:11435', new URL(llamaSwapBaseUrl).origin]])
  comfyBaseUrl = origins.get('http://127.0.0.1:8188')
  const fetchImpl = (input, init) => {
    const url = new URL(input)
    const origin = origins.get(url.origin)
    return suppliedFetch(origin ? origin + url.pathname + url.search : input, { ...init, redirect: 'error' })
  }
  return async function submitComfyVideo(args, exec) {
    const loaded = await loadWorkflow(args, {
      readFileImpl,
    })
    const payload = await applyH3Prompt(loaded, args, readFileImpl)
    validateConnectionIndices(payload.prompt)
    const generation = h3Generation(payload.prompt)
    let preflight
    if (args.intent === 'h3_ref2av' || Object.values(payload.prompt).some(node => node?.class_type === 'MiniMaxH3ReferenceToVideo')) {
      validateH3Ref2AVGraph(payload.prompt)
      const entries=entriesFromEvents(exec.agent?.session?.snapshotEvents?.()??[])
      if(args.validate_only!==true)assertProposalSubmission(entries)
      preflight = await validateH3Preflight(payload.prompt, args.h3_review, exec, { readFileImpl, fetchImpl })
      if(args.validate_only!==true)assertProposalSubmission(entriesFromEvents(exec.agent?.session?.snapshotEvents?.()??[]),preflight.references)
    }
    if (args.validate_only === true) {
      const submission_blockers=[];
      if(preflight)try{assertProposalSubmission(entriesFromEvents(exec.agent?.session?.snapshotEvents?.()??[]),preflight.references)}catch(error){submission_blockers.push(error.message)}
      return { validated: true, submission_ready:submission_blockers.length===0, submission_blockers, terminal: false, ...(generation ? { h3_generation: generation } : {}), ...(preflight ? { h3_preflight: preflight } : {}) }
    }
    const response = await fetchImpl(COMFY_PROMPT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: exec.signal,
    })
    const queued = await responseBody(response)
    if (!response.ok) {
      throw new Error(`ComfyUI rejected workflow (${response.status}): ${JSON.stringify(queued)}`)
    }
    if (typeof queued.prompt_id !== 'string' || queued.prompt_id === '') {
      throw new Error(`ComfyUI accepted no prompt id: ${JSON.stringify(queued)}`)
    }
    onGpuState?.({prompt_id:queued.prompt_id,phase:'unloading_llm'});

    let jobId
    let jobWarning
    let resolveHandoff
    const handoffReady = new Promise(resolve => { resolveHandoff = resolve })
    try {
      jobId = startComfyMonitor(startJob, queued.prompt_id, exec.agent, {
        fetchImpl,
        sleep,
        pollIntervalMs: historyPollIntervalMs,
        comfyBaseUrl,
        handoffReady,
        releaseTimeoutMs,
        handoffRetryIntervalMs,
        now,
        onGpuState,
      })
    } catch (error) {
      jobWarning = `ComfyUI job was queued, but Harness monitoring could not start: ${errorText(error)}`
    }

    let unload = { unloaded: false, runningModels: [] }
    let warning
    try {
      unload = await unloadLlamaSwap(
        fetchImpl,
        exec.signal,
        sleep,
        unloadTimeoutMs,
        pollIntervalMs,
      )
    } catch (error) {
      warning = `ComfyUI job was queued, but LLM unload failed: ${errorText(error)}`
    } finally {
      onGpuState?.({prompt_id:queued.prompt_id,phase:jobId===undefined?'unmonitored':'generating',llm_unloaded:unload.unloaded,...(warning?{warning}:{})});
      try { exec.concludeTurn() } finally { resolveHandoff() }
    }

    return {
      prompt_id: queued.prompt_id,
      ...(jobId !== undefined ? { job_id: jobId } : {}),
      ...(queued.number !== undefined ? { number: queued.number } : {}),
      llm_unloaded: unload.unloaded,
      running_models: unload.runningModels,
      ...((warning ?? jobWarning) !== undefined ? { warning: [jobWarning, warning].filter(Boolean).join(' ') } : {}),
      terminal: true,
      ...(generation ? { h3_generation: generation } : {}),
      ...(preflight ? { h3_preflight: preflight } : {}),
    }
  }
}

function toolDefinition({ startJob, toolName = 'submit_comfy_job', ...options } = {}) {
  const isLegacyVideoName = toolName === 'submit_comfy_video'
  return {
    name: toolName,
    description: isLegacyVideoName?'Legacy alias of submit_comfy_job with identical arguments and checks. Prefer submit_comfy_job for all new calls.':[
      isLegacyVideoName
        ? 'Compatibility name for submit_comfy_job; submit exactly one prepared ComfyUI workflow as a managed background job.'
        : 'Submit exactly one prepared ComfyUI API workflow for image, video, preprocessing, or another ComfyUI task as a managed background job.',
      'Use this instead of manually posting to /prompt or polling /history. It monitors completion, unloads llama-swap, and ends the current turn.',
      'Reuse a previously verified workflow for the same task unless the user requests a change or its capabilities no longer fit. Check only relevant installed nodes/models when needed; do not print full object_info responses or perform recursive filesystem model searches when a targeted query answers the check.',
      `For fresh-H3 timing-only planning, run node ${H3_TIMING_SHELL_PATH} --shots 5.5,3 (repeat --shots per clip). This offline helper computes 24-fps shot boundaries and 17k+5 clip lengths; no workflow/creative-guide lookup is needed for that calculation. Review its actual durations before approval. It does not rewrite workflows or handle latent-context overlap.`,
      'Stage selected local references with director_stage_images; reuse its returned image bindings and original source_path. Do not implement multipart uploads or enumerate the full LoadImage library in model-visible shell output.',
      'No workflow is bundled. Select or adapt a local ComfyUI API graph through native coding tools. For continuity use director continuity guidance and a capable workflow_path. Set the actual graph canvas for portrait; inspect h3_generation and decoded output dimensions.',
      'For H3 load h3-prompt-writing and its official guides, inspect all actual references with read_image, and provide h3_review with their observed responsibilities and exact dialogue. The latest shot/ref proposal needs human confirmation. Use director_assets to recover source paths after compaction.',
      'Raw H3 graphs receive the same preflight even with intent=generic. Use intent=generic for other workflows.',
      'For an existing H3 graph use workflow_path plus h3_prompt_path or h3_prompt to replace only its six-section prompt. Flat ref_images.ref_image_0...N sockets bind staged Pictures; see h3-prompt-writing.',
      'A failed background job is terminal for that submission. Never retry an identical failed workflow automatically; inspect the error and change the workflow before submitting again.',
      'After completion, use job output_artifacts and its ComfyUI view_url to retrieve outputs for review. For a loopback view_url, download it to the workspace with a shell HTTP client such as PowerShell Invoke-WebRequest or curl, then inspect that exact file; never use web_fetch for localhost and do not search entire drives.',
      'This tool concludes the turn after an accepted submission.',
      'Monitoring waits for verified GPU release before waking the Agent. waiting_for_vram means handoff, not new generation: inspect job_output, never resubmit a completed/failed prompt.',
      'Use validate_only=true before submission. Check submission_ready and submission_blockers as well as graph checks; validation never queues, unloads or ends the turn.',
      'Provide exactly one of workflow_path or workflow. Raw node graphs and {prompt: ...} wrappers are accepted.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        validate_only: { type: 'boolean', description: 'Check only; do not queue or unload. Defaults to false.' },
        h3_review: H3_REVIEW_SCHEMA,
        h3_prompt: {
          type: 'object', description: 'Optional six-section prompt for an existing H3 workflow; only its H3 prompt input changes. Mutually exclusive with h3_prompt_path.',
          properties: Object.fromEntries(H3_PROMPT_SECTIONS.map(key=>[key,{type:'string'}])),
          required: H3_PROMPT_SECTIONS, additionalProperties: false,
        },
        h3_prompt_path: {type:'string',description:'Optional absolute or working-directory-relative JSON file containing exactly the six H3 section strings; for existing workflows only.'},
        intent: {
          type: 'string',
          enum: ['generic', 'h3_ref2av'],
          description: 'Validation intent. h3_ref2av fails closed on prompt sections and real reference wiring; generic preserves arbitrary ComfyUI graphs.',
        },
        workflow_path: {
          type: 'string',
          description: 'Absolute path, or path relative to the Harness working directory, to a ComfyUI API-format JSON file.',
        },
        workflow: {
          type: 'object',
          description: 'Inline ComfyUI API workflow. Prefer workflow_path for large video graphs.',
        },
      },
      required: [],
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        if (value.validated) return [{ type: 'text', text: ['ComfyUI graph/reference checks passed. Nothing queued; LLM and turn unchanged.',value.submission_ready?'Submission checks currently clear.':'Submission blocked: '+value.submission_blockers.join('; '), ...h3CanvasLines(value)].join('\n') }]
        const lines = [
          `ComfyUI queued prompt ${value.prompt_id}.`,
          ...h3CanvasLines(value),
          ...(value.job_id ? [`Harness background job: ${value.job_id}. Completion will wake this Agent for review only after verified GPU handoff; unverified release keeps the job waiting with saved outputs readable via job_output.`] : []),
          value.llm_unloaded
            ? 'llama-swap model unloaded; Harness turn concluded.'
            : 'Harness turn concluded, but llama-swap unload needs attention.',
        ]
        if (value.warning) lines.push(value.warning)
        return [{ type: 'text', text: lines.join('\n') }]
      },
      presentationMeta(_args, value) {
        return value
      },
    },
    timeoutMs: 30_000,
    execute: createSubmitComfyVideo({ startJob, ...options }),
  }
}

export function apply(ctx, options = {}) {
  const startJob = (spec) => ctx.jobs.start(spec)
  ctx.effect(
    () => ctx.tools.register(toolDefinition({ startJob, toolName: 'submit_comfy_job', ...options })),
    'submit-comfy-video: generic terminal submit tool',
  )
  ctx.effect(
    () => ctx.tools.register(toolDefinition({ startJob, toolName: 'submit_comfy_video', ...options })),
    'submit-comfy-video: legacy terminal submit tool',
  )
}

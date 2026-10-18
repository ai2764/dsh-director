import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { nativeToolContents } from './native-tool-result.mjs'

export const SECTION_KEYS = [
  'subject_definitions', 'summary', 'retention_analysis', 'detailed_description',
  'overall_soundscape', 'non_diegetic_music',
]

function fail(message) {
  throw new Error(`H3 preflight: ${message}`)
}

function sectionsFromText(text) {
  const headers = [...text.matchAll(/^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music):/gm)]
  if (headers.length !== 6 || headers.some((h,i) => h[1] !== SECTION_KEYS[i]) || text.slice(0,headers[0].index).trim()) {
    fail('exactly six sections are required, once each, in the documented order')
  }
  return Object.fromEntries(headers.map((h,i) => {
    const body = text.slice(h.index+h[0].length,headers[i+1]?.index ?? text.length).trim()
    if (!body) fail(`${h[1]} must not be empty`)
    return [h[1],body]
  }))
}

function spokenText(value) {
  return value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]+/gu,' ').trim().toLowerCase()
}

function validateDialogue(sections, dialogue) {
  if (!Array.isArray(dialogue) || dialogue.some(d => !d || ['speaker','language','text'].some(k=>typeof d[k] !== 'string' || !d[k].trim()))) {
    fail('h3_review.dialogue must list exact {speaker, language, text} lines in script order, or [] for a silent shot')
  }
  const detail=sections.detailed_description
  const blocks=[...detail.matchAll(/<d>(.*?)<\/d>/gs)]
  const outside=detail.replace(/<d>.*?<\/d>/gs,'')
  if (/<\/?d\b/i.test(outside)) fail('malformed dialogue <d> block')
  if (blocks.length !== dialogue.length) fail(`dialogue blocks must match the scripted line count: h3_review.dialogue has ${dialogue.length} line(s), detailed_description has ${blocks.length} <d> block(s). Pass only this clip's scripted lines in h3_review.dialogue and put exactly one <d>[Language] words</d> block per line; use [] and no blocks for a silent clip.`)
  blocks.forEach((b,i) => {
    const match=/^\[([^\]\n]+)\]\s*(.+)$/s.exec(b[1].trim())
    if (!match || /<\/?d\b/i.test(b[1])) fail('each dialogue block must contain [Language] and exact spoken words only')
    if (match[1] !== dialogue[i].language || match[2].trim().replace(/\s+/g,' ') !== dialogue[i].text.trim().replace(/\s+/g,' ')) {
      fail(`dialogue line ${i+1} does not match h3_review.dialogue[${i}]: expected <d>[${dialogue[i].language}] ${dialogue[i].text}</d>, found ${b[0]}. Align this clip's prompt and review to the displayed card; do not change approved dialogue merely to pass preflight.`)
    }
    const prefix=detail.slice(i ? blocks[i-1].index+blocks[i-1][0].length : 0,b.index)
    if (!prefix.includes(dialogue[i].speaker)) fail(`dialogue line ${i+1} needs its speaker ${dialogue[i].speaker} outside <d>. Put the exact h3_review.dialogue[${i}].speaker before this line's <d>[${dialogue[i].language}] words</d>, not inside the spoken words; do not change the approved dialogue.`)
  })
  for (const [key,body] of Object.entries(sections)) {
    if(key !== 'detailed_description' && /<\/?d\b/i.test(body)) fail(`dialogue misplaced in ${key}`)
    const plain=spokenText(key === 'detailed_description' ? outside : body)
    for(const line of dialogue) {
      const words=spokenText(line.text)
      if(words && (` ${plain} `).includes(` ${words} `)) fail(`dialogue repeated outside <d> in ${key}`)
    }
  }
}

// This verifies real image-bearing native tool results in current context, not
// an agent's boolean claim. It proves availability before a model response,
// not correct visual reasoning or identity fidelity in the generated video.
function visualReadEvidence(session, sourcePath) {
  if(typeof session?.snapshotEvents !== 'function' || !Array.isArray(session.surface?.nodes)) {
    fail('live Harness session is required to verify native read_image visual evidence')
  }
  const events=session.snapshotEvents()
  const active=new Set(session.surface.nodes)
  const calls=new Map(events.filter(e=>e.type==='tool/call').map(e=>[e.data.callId,e.data]))
  for(const e of events) {
    if(e.type !== 'tool/result' || !active.has(e.seq)) continue
    for(const content of nativeToolContents(e,calls,'read_image')) {
      const image=content.find(b=>b.type==='image' && b.attachment?.attachmentId)
      const envelope=content.filter(b=>b.type==='text').map(b=>b.text).join('\n')
      const actual=/<path>(.*?)<\/path>/s.exec(envelope)?.[1]
      if(!image || !actual || resolve(actual) !== resolve(sourcePath)) continue
      if(!events.some(next=>next.seq>e.seq && active.has(next.seq) && next.type==='assistant/message' && next.data.message?.source?.kind==='model')) continue
      return {read_event_seq:e.seq,attachment_id:image.attachment.attachmentId}
    }
  }
  fail(`read_image must return ${sourcePath} as visual image content in this session, followed by a model response; read it again if it was compacted away. Next: call read_image(${JSON.stringify({file_path:sourcePath})}), inspect its pixels in the next model step, then retry. A staging record or text summary is not visual evidence.`)
}

export async function validateH3Preflight(graph, review, exec, {readFileImpl,fetchImpl}) {
  if(!review || !Array.isArray(review.references)) fail('h3_review is required: read the actual images with native read_image, then record observations and responsibilities before writing the prompt')
  const node=Object.values(graph).find(n=>n?.class_type==='MiniMaxH3ReferenceToVideo')
  const sections=sectionsFromText(node.inputs.prompt)
  const bindings={}
  for(const [key,value] of Object.entries(node.inputs)) if(key.startsWith('ref_images.')) bindings[key.slice(11)]=value
  const names=Object.entries(bindings).sort((a,b)=>Number(a[0].slice(10))-Number(b[0].slice(10))).map(([,value])=>graph[String(value[0])].inputs.image)
  // Official Ref2AV retains Subjects; their definitions carry Picture provenance.
  // Keep legacy direct-Picture retention compatible without dropping the check.
  const definitions=[...sections.subject_definitions.matchAll(/^\s*<(Subject|Picture) (\d+)>[^\n]*(?:\n(?!\s*<(?:Subject|Picture) \d+>)[^\n]*)*/gm)]
  const subjects=new Map(definitions.filter(d=>d[1]==='Subject').map(d=>[`<Subject ${d[2]}>`,d[0]]))
  for(const section of Object.values(sections)) for(const m of section.matchAll(/<Subject (\d+)>/g)) {
    if(!subjects.has(m[0])) fail(`undefined ${m[0]}; define its reference provenance in subject_definitions. Each <Subject N> definition must start on its own line (use a real newline, not literal \\n). Example: ${m[0]} is the subject from <Picture N>. If already mentioned mid-paragraph, move that definition to a new line; do not invent or renumber references.`)
  }
  if(review.references.length !== names.length) fail('h3_review.references must describe every submitted Picture in connection order')
  review.references.forEach((ref,i)=>{
    if(ref?.picture_index !== i+1 || ref.image !== names[i]) fail(`Picture ${i+1} review image filename/index does not match its actual connection`)
    for(const key of ['source_path','observation','responsibility']) if(typeof ref[key] !== 'string' || !ref[key].trim()) fail(`Picture ${i+1} needs ${key} grounded in the inspected pixels`)
    if(!isAbsolute(ref.source_path)) fail(`Picture ${i+1} source_path must be absolute`)
    const picture=`<Picture ${i+1}>`
    if(!sections.subject_definitions.includes(picture)) fail(`subject_definitions must bind ${picture} to its observed responsibility`)
    const retained=sections.retention_analysis.includes(picture) || [...subjects].some(([subject,definition])=>
      definition.includes(picture) && sections.retention_analysis.includes(subject))
    if(!retained) fail(`retention_analysis must bind ${picture} directly or through its defined <Subject N> provenance`)
  })
  const text=node.inputs.prompt
  for(const m of text.matchAll(/<Picture (\d+)>/g)) if(Number(m[1])<1 || Number(m[1])>names.length) fail(`unsubmitted <Picture ${m[1]}> tag`)
  if(/\bPicture\s*\d+\b/i.test(text.replace(/<Picture \d+>/g,''))) fail('use exact <Picture N> delimiters for every reference mention')
  // Count Audio references in the caller-selected graph.
  const audioCount=Object.keys(node.inputs).filter(k=>k.startsWith('ref_audios.')).length
  for(const m of text.matchAll(/<Audio (\d+)>/g)) if(Number(m[1])<1 || Number(m[1])>audioCount) fail(`unsubmitted <Audio ${m[1]}> tag`)
  validateDialogue(sections,review.dialogue)
  const requested=Number(node.inputs.length)
  if(!Number.isFinite(requested) || requested<5) fail('graph needs a valid H3 frame length to check duration')
  const duration=(Math.ceil((requested-5)/17)*17+5)/24
  for(const m of sections.detailed_description.matchAll(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)(?:\s*(?:seconds?|secs?|s)\b|\s*:)/g)) {
    if(Number(m[1])>Number(m[2]) || Number(m[2])>duration+0.01) fail(`timing ${m[0]} exceeds or conflicts with graph duration ${duration.toFixed(3)} seconds`)
  }
  const inspected=[],visualErrors=[];
  for(const ref of review.references)try{inspected.push({...ref,...visualReadEvidence(exec.agent?.session,ref.source_path)})}catch(error){visualErrors.push(error.message)}
  if(visualErrors.length)fail(visualErrors.join('\n'));
  for(const ref of inspected) {
    const slash=ref.image.replace(/\\/g,'/').lastIndexOf('/')
    const filename=slash<0 ? ref.image : ref.image.slice(slash+1)
    const subfolder=slash<0 ? '' : ref.image.slice(0,slash).replace(/\\/g,'/')
    const response=await fetchImpl(`http://127.0.0.1:8188/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=input`,{signal:exec.signal})
    if(!response.ok) fail(`cannot verify staged input ${ref.image}: HTTP ${response.status}. For a missing image, call director_stage_images with source_paths: [${JSON.stringify(ref.source_path)}], then update only this reference's image binding and matching LoadImage; keep its source_path. For connectivity/access errors, check the configured ComfyUI service rather than repeatedly uploading.`)
    const staged=Buffer.from(await response.arrayBuffer())
    const local=Buffer.from(await readFileImpl(ref.source_path))
    if(!local.equals(staged)) fail(`staged reference bytes differ from the inspected file: ${ref.image}. Call director_stage_images with source_paths: [${JSON.stringify(ref.source_path)}]; use its byte-verified image binding in LoadImage and h3_review, keeping source_path unchanged. If the local source changed, inspect it again and review that reference change before production; do not disable this check.`)
    ref.sha256=createHash('sha256').update(local).digest('hex')
  }
  return {references:inspected,dialogue:review.dialogue,duration_s:duration,visual_evidence:'native read_image result present before a model response; not a semantic QC guarantee'}
}

export const H3_REVIEW_SCHEMA={
  type:'object',
  properties:{
    references:{type:'array',minItems:1,maxItems:9,items:{type:'object',properties:{
      picture_index:{type:'integer',minimum:1,maximum:9},image:{type:'string'},source_path:{type:'string'},
      observation:{type:'string'},responsibility:{type:'string'},
    },required:['picture_index','image','source_path','observation','responsibility']}},
    dialogue:{type:'array',items:{type:'object',properties:{speaker:{type:'string'},language:{type:'string'},text:{type:'string'}},required:['speaker','language','text']}},
  },required:['references','dialogue'],
}

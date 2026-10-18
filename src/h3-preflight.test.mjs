import assert from 'node:assert/strict'
import test from 'node:test'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import { createSubmitComfyVideo } from './submit-comfy-video.mjs'

const bytes = Buffer.from('controlled reference bytes')
const fixturePath = name => join(tmpdir(),'dsh-director-synthetic',name).replaceAll('\\','/')
const source = fixturePath('actor.png')
const sections = {
  subject_definitions: '<Picture 1> defines Alex identity and cream cardigan.',
  summary: 'Alex gives a brief deadpan reaction.',
  retention_analysis: '<Picture 1> retains Alex identity and cream cardigan; it does not establish the cafe.',
  detailed_description: '0-5 seconds: Alex (S1) from <Picture 1> smiles and says <d>[English] Sample accepted.</d>',
  overall_soundscape: 'Quiet cafe ambience.',
  non_diegetic_music: 'N/A',
}
function graph(prompt = sections) {
  return {
    '1': { class_type: 'LoadImage', inputs: { image: 'actor.png' } },
    '6': { class_type: 'MiniMaxH3ReferenceToVideo', inputs: {
      prompt: typeof prompt === 'string' ? prompt : Object.entries(prompt).map(([k,v]) => `${k}: ${v}`).join('\n'),
      'ref_images.ref_image_0': ['1',0], width:1280, height:704, length:124,
    } },
  }
}
function review() {
  return { references: [{ picture_index:1, image:'actor.png', source_path:source,
    observation:'One woman with long dark hair in a cream cardigan.',
    responsibility:'Alex identity and visible wardrobe; not scene geometry.' }],
    dialogue:[{speaker:'Alex',language:'English',text:'Sample accepted.'}] }
}
function officialSections() {
  return {...sections,
    subject_definitions: '<Subject 1> is Alex, with identity and cream cardigan from <Picture 1>.',
    summary: '[reference generation] <Subject 1> gives a brief deadpan reaction.',
    retention_analysis: '<Subject 1>: fully_preserved; retain identity and cream cardigan.',
    detailed_description: 'Natural live-action comedy. [Shot 1] 0-5 seconds: <Subject 1> (S1) smiles and says <d>[English] Sample accepted.</d>',
  }
}

test('validation reports unconfirmed review before any real submission',async()=>{
  const h=harness(),r=review();r.dialogue[0].speaker='<Subject 1> (S1)';
  const events=h.exec.agent.session.snapshotEvents();
  events.push({seq:9,type:'tool/call',data:{callId:'review-card',name:'director_show_media',arguments:'{}'}},{seq:10,type:'tool/result',data:{message:{role:'tool',toolCallId:'review-card',isError:false,content:[{type:'text',text:JSON.stringify({kind:'director-media',card_id:'review-card',proposal:{version:'v1',shots:[{clip_id:'c1',reference_numbers:[1]}]},items:[{sha256:'a'.repeat(64),type:'image'}]})}]}}});
  h.exec.agent.session.snapshotEvents=()=>events;
  const result=await h.submit({workflow:graph(officialSections()),h3_review:r,validate_only:true},h.exec);
  assert.equal(result.submission_ready,false);
  assert.match(result.submission_blockers.join(' '),/confirm/i);
  assert.equal(h.requests.some(r=>r.url.endsWith('/prompt')),false);
});

test('official Subject provenance retains a Picture without repeating its tag in retention', async () => {
  const h=harness(), r=review(); r.dialogue[0].speaker='<Subject 1> (S1)'
  const result=await h.submit({workflow:graph(officialSections()),h3_review:r,validate_only:true},h.exec)
  assert.equal(result.validated,true)
  assert.equal(h.requests.some(r=>r.url.endsWith('/prompt')),false)
})

test('dialogue preflight identifies the clip-local line count and exact mismatch',async()=>{
  const h=harness(),r=review()
  r.dialogue.push({speaker:'Alex',language:'English',text:'Second line.'})
  await assert.rejects(h.submit({workflow:graph(),h3_review:r,validate_only:true},h.exec),/h3_review\.dialogue has 2 line\(s\).*detailed_description has 1 <d> block\(s\).*only this clip/s)
  const wrong=review()
  wrong.dialogue[0].text='Different approved line.'
  await assert.rejects(h.submit({workflow:graph(),h3_review:wrong,validate_only:true},h.exec),/expected <d>\[English\] Different approved line\.<\/d>, found <d>\[English\] Sample accepted\.<\/d>/s)
})

test('same-paragraph Subject definitions report the exact newline repair without weakening provenance checks',async()=>{
  const h=harness(),s=officialSections(),r=review();r.dialogue[0].speaker='<Subject 1> (S1)'
  s.subject_definitions+=' <Subject 2> is the room from <Picture 1>.'
  s.summary+=' <Subject 2> is visible.'
  await assert.rejects(h.submit({workflow:graph(s),h3_review:r,validate_only:true},h.exec),error=>{
    assert.match(error.message,/Subject 2/);assert.match(error.message,/new line|own line|newline/i);assert.match(error.message,/subject_definitions/);return true;
  });
  assert.equal(h.requests.length,0)
})

test('a prompt path without workflow explains that it is an override rather than a workflow',async()=>{
  const h=harness()
  await assert.rejects(h.submit({h3_prompt_path:'sections.json',validate_only:true},h.exec),error=>{
    assert.match(error.message,/h3_prompt_path/);assert.match(error.message,/workflow_path/);assert.match(error.message,/override|not a workflow/i);return true;
  });
  assert.equal(h.requests.length,0)
})

test('missing visual evidence specifies the exact next read_image argument',async()=>{
  const h=harness();h.exec.agent.session=session({image:false})
  await assert.rejects(h.submit({workflow:graph(),h3_review:review(),validate_only:true},h.exec),error=>{
    assert.match(error.message,/file_path/);assert.match(error.message,/actor\.png/);return true;
  });
  assert.equal(h.requests.length,0)
});

test('Harness 0.2 direct read_image result satisfies H3 visual preflight',async()=>{
  const h=harness();
  const events=[
    {seq:0,type:'tool/call',data:{callId:'read-1',name:'read_image',arguments:JSON.stringify({file_path:source})}},
    {seq:1,type:'tool/result',data:{message:{role:'tool',source:{kind:'tool',callId:'read-1'},toolCallId:'read-1',isError:false,content:[
      {type:'text',text:`<path>${source}</path>\n<type>image</type>`},
      {type:'image',attachment:{attachmentId:'sha256:'+'a'.repeat(64),mediaType:'image/png'}},
    ]}}},
    {seq:2,type:'assistant/message',data:{message:{source:{kind:'model'},content:[]}}},
  ];
  h.exec.agent.session={snapshotEvents:()=>events,surface:{nodes:[1,2]}};
  const result=await h.submit({workflow:graph(),h3_review:review(),validate_only:true},h.exec);
  assert.equal(result.validated,true);
  assert.equal(result.h3_preflight.references[0].read_event_seq,1);
});

test('all missing reference inspections are reported together',async()=>{
  const h=harness(),g=graph(),r=review();
  g['2']={class_type:'LoadImage',inputs:{image:'scene.png'}};
  g['6'].inputs['ref_images.ref_image_1']=['2',0];
  g['6'].inputs.prompt=g['6'].inputs.prompt.replace('subject_definitions:','subject_definitions: <Picture 2> defines the room. ').replace('retention_analysis:','retention_analysis: Preserve <Picture 2>. ');
  r.references.push({...r.references[0],picture_index:2,image:'scene.png',source_path:fixturePath('scene.png')});
  h.exec.agent.session=session({image:false});
  await assert.rejects(h.submit({workflow:g,h3_review:r,validate_only:true},h.exec),e=>{
    assert.match(e.message,/actor\.png/);assert.match(e.message,/scene\.png/);return true;
  });
});

test('raw H3 reference rejects a local absolute path with explicit staging repair',async()=>{
  const h=harness(),g=graph();g['1'].inputs.image=source
  await assert.rejects(h.submit({workflow:g,h3_review:review(),validate_only:true},h.exec),error=>{
    assert.match(error.message,/director_stage_images/);assert.match(error.message,/LoadImage/);assert.match(error.message,/source_path/);return true;
  });
  assert.equal(h.requests.length,0)
})

test('staged-byte mismatch tells the caller to restage without disabling inspection',async()=>{
  const submit=createSubmitComfyVideo({readFileImpl:async()=>Buffer.from('different bytes'),fetchImpl:async()=>new Response(bytes)})
  await assert.rejects(submit({workflow:graph(),h3_review:review(),validate_only:true},harness().exec),error=>{
    assert.match(error.message,/staged reference bytes differ/);assert.match(error.message,/director_stage_images/);assert.match(error.message,/source_path/);return true;
  })
})

test('one official Subject can combine two Pictures with a single retention entry', async () => {
  const h=harness(),r=review(),s=officialSections(),g=graph(s)
  s.subject_definitions='<Subject 1> is Alex, with identity from <Picture 1> and wardrobe from <Picture 2>.'
  g['6'].inputs.prompt=Object.entries(s).map(([k,v])=>`${k}: ${v}`).join('\n')
  g['2']={class_type:'LoadImage',inputs:{image:'outfit.png'}}
  g['6'].inputs['ref_images.ref_image_1']=['2',0]
  r.references.push({...r.references[0],picture_index:2,image:'outfit.png',source_path:fixturePath('outfit.png')})
  r.dialogue[0].speaker='<Subject 1> (S1)'
  const events=session().snapshotEvents()
  const second=session().snapshotEvents().map(e=>JSON.parse(JSON.stringify(e).replaceAll(source,fixturePath('outfit.png')).replaceAll('read-1','read-2').replaceAll('image-1','image-2')))
  for(const e of second)e.seq+=3
  events.push(...second)
  h.exec.agent.session={snapshotEvents:()=>events,surface:{nodes:[1,2,4,5]}}
  const result=await h.submit({workflow:g,h3_review:r,validate_only:true},h.exec)
  assert.equal(result.h3_preflight.references.length,2)
  assert.equal(h.requests.length,2)
})

for(const [name,mutate] of [
  ['different retained Subject',s=>s.retention_analysis='<Subject 2>: fully_preserved; retain identity.'],
  ['Picture mentioned outside its Subject definition',s=>{
    s.subject_definitions='<Subject 1> is Alex. <Picture 1> defines a separate background.'
    s.retention_analysis='<Subject 2>: fully_preserved; retain background.'
  }],
]) test(`official provenance rejects ${name}`,async()=>{
  const h=harness(),r=review(),s=officialSections();r.dialogue[0].speaker='<Subject 1> (S1)';mutate(s)
  await assert.rejects(h.submit({workflow:graph(s),h3_review:r,validate_only:true},h.exec),/retention_analysis|undefined.*Subject/)
  assert.equal(h.requests.length,0)
})
function session({ image = true, response = true, pruned = false, error = false } = {}) {
  const events = [
    {seq:0,type:'tool/call',data:{callId:'read-1',name:'read_image',arguments:JSON.stringify({file_path:source})}},
    {seq:1,type:'tool/result',data:{message:{content:[{type:'tool-result',toolCallId:'read-1',isError:error,content:[
      {type:'text',text:`<path>${source}</path><type>image</type>`},
      ...(image ? [{type:'image',attachment:{attachmentId:'image-1'}}] : []),
    ]}]}}},
    ...(response ? [{seq:2,type:'assistant/message',data:{message:{source:{kind:'model'},content:[]}}}] : []),
  ]
  return {snapshotEvents:()=>events,surface:{nodes:pruned ? [2] : events.filter(e=>e.type!=='tool/call').map(e=>e.seq)}}
}
function harness() {
  const requests = []
  let concluded = 0
  const submit = createSubmitComfyVideo({
    readFileImpl:async()=>bytes,
    fetchImpl:async(url,init={})=>{
      requests.push({url:String(url),init})
      if(String(url).includes('/view?')) return new Response(bytes)
      if(String(url).endsWith('/prompt')) return Response.json({prompt_id:'accepted'})
      if(String(url).endsWith('/api/models/unload') || String(url).endsWith('/running')) return Response.json({})
      throw new Error(`Unexpected ${url}`)
    },
    sleep:async()=>{},
  })
  return {requests,submit,exec:{agent:{session:session()},concludeTurn(){concluded++}},get concluded(){return concluded}}
}

test('structured H3 sections serialize safely into an existing Turbo4 latent graph', async () => {
  const h = harness(), g = graph(), original = structuredClone(g)
  g['10'] = {class_type:'BasicScheduler', inputs:{steps:4, scheduler:'beta', denoise:1}}
  g['6'].inputs.latent_context = ['77',0]
  g['77'] = {class_type:'LoadLatent',inputs:{latent:'context.safetensors'}}
  g['6'].inputs.prompt = 'old prompt'
  const before = structuredClone(g)
  const s = Object.fromEntries(Object.entries({...sections, summary:'A "deadpan" reaction.\nNo horror. 中文', non_diegetic_music:'N/A'}).reverse())
  const result = await h.submit({workflow:g,h3_prompt:s,h3_review:review()},h.exec)
  assert.equal(result.prompt_id,'accepted')
  const submitted = JSON.parse(h.requests.find(r=>r.url.endsWith('/prompt')).init.body).prompt
  assert.equal(result.h3_effective_prompt.source,'override')
  assert.equal(result.h3_effective_prompt.summary,'A "deadpan" reaction.\nNo horror. 中文')
  assert.equal(result.h3_effective_prompt.sha256,createHash('sha256').update(submitted['6'].inputs.prompt).digest('hex'))
  assert.equal(submitted['6'].inputs.prompt,
    'subject_definitions: <Picture 1> defines Alex identity and cream cardigan.\nsummary: A "deadpan" reaction.\nNo horror. 中文\nretention_analysis: <Picture 1> retains Alex identity and cream cardigan; it does not establish the cafe.\ndetailed_description: 0-5 seconds: Alex (S1) from <Picture 1> smiles and says <d>[English] Sample accepted.</d>\noverall_soundscape: Quiet cafe ambience.\nnon_diegetic_music: N/A')
  const unchanged = structuredClone(submitted); unchanged['6'].inputs.prompt = 'old prompt'
  assert.deepEqual(unchanged,before)
  assert.deepEqual(g,before, 'caller graph must not be mutated')
  assert.deepEqual(original['1'],submitted['1'])
})

test('structured prompt file is usable with workflow_path without rewriting the graph file', async () => {
  const h=harness(),g=graph();g['6'].inputs.prompt='old prompt'
  const submit=createSubmitComfyVideo({
    readFileImpl:async path=>String(path).endsWith('workflow.json') ? JSON.stringify(g) : String(path).endsWith('sections.json') ? JSON.stringify(sections) : bytes,
    fetchImpl:async()=>new Response(bytes),
  })
  const result=await submit({workflow_path:'workflow.json',h3_prompt_path:'sections.json',h3_review:review(),validate_only:true},h.exec)
  assert.equal(result.validated,true)
  assert.equal(result.h3_effective_prompt.source,'override')
  assert.equal(result.h3_effective_prompt.summary,sections.summary)
  assert.equal(g['6'].inputs.prompt,'old prompt')
})

for(const [label,extra,pattern] of [
  ['missing section',{h3_prompt:{summary:'only summary'}},/section|subject_definitions/i],
  ['unknown section',{h3_prompt:{...sections,unknown:'typo'}},/unknown|unexpected/i],
  ['two prompt sources',{h3_prompt:sections,h3_prompt_path:'sections.json'},/exactly one|both/i],
]) test(`structured prompt rejects ${label} before any external action`,async()=>{
  const h=harness()
  await assert.rejects(h.submit({workflow:graph(),h3_review:review(),...extra},h.exec),pattern)
  assert.equal(h.requests.length,0)
})

test('structured prompt does not bypass native image inspection',async()=>{
  const h=harness();h.exec.agent.session=session({image:false})
  const g=graph();g['6'].inputs.prompt='old prompt'
  await assert.rejects(h.submit({workflow:g,h3_prompt:sections,h3_review:review()},h.exec),/read_image|visual/i)
  assert.equal(h.requests.some(r=>r.url.endsWith('/prompt')),false)
})

for (const group of ['ref_images', 'ref_audios', 'ref_videos', 'ref_video_audios']) {
  test(`H3 rejects nested ${group} sockets before any external action`, async () => {
    const h = harness(), g = graph()
    g['6'].inputs[group] = { [group === 'ref_images' ? 'ref_image_0' : 'ref_audio_0']: ['1', 0] }
    await assert.rejects(h.submit({workflow:g, h3_review:review()}, h.exec), /flat.*socket|top-level|nested/i)
    assert.equal(h.requests.length, 0)
    assert.equal(h.concluded, 0)
  })
}

test('H3 rejects the formerly accepted nested-only Picture graph', async () => {
  const h = harness(), g = graph()
  delete g['6'].inputs['ref_images.ref_image_0']
  g['6'].inputs.ref_images = { ref_image_0: ['1', 0] }
  await assert.rejects(h.submit({workflow:g, h3_review:review(), validate_only:true}, h.exec), /flat.*socket|top-level|nested/i)
  assert.equal(h.requests.length, 0)
})
test('H3 submission requires a reference observation record before queueing',async()=>{
  const h=harness()
  await assert.rejects(h.submit({workflow:graph(),intent:'h3_ref2av'},h.exec),/h3_review/)
  assert.equal(h.requests.length,0)
  assert.equal(h.concluded,0)
})
for(const [name,options] of [['text-only result',{image:false}],['failed read',{error:true}],['no subsequent model response',{response:false}],['compacted-away image',{pruned:true}]]) {
  test(`H3 rejects ${name} even when caller claims to have observed it`,async()=>{
    const h=harness();h.exec.agent.session=session(options)
    await assert.rejects(h.submit({workflow:graph(),h3_review:review()},h.exec),/read_image|model|visual/i)
    assert.equal(h.requests.some(r=>r.url.endsWith('/prompt')),false)
    assert.equal(h.concluded,0)
  })
}
for(const [name,mutate,pattern] of [
  ['missing Picture binding',s=>s.retention_analysis='Preserve the actor.',/retention_analysis/],
  ['invented Picture',s=>s.subject_definitions+=' <Picture 2> defines the set.',/unsubmitted/],
  ['bare Picture tag',s=>s.detailed_description=s.detailed_description.replace('<Picture 1>','Picture 1'),/exact|delimiter/],
  ['dialogue repeated in summary',s=>s.summary+=' Sample accepted.',/dialogue.*summary/],
  ['dialogue without language',s=>s.detailed_description=s.detailed_description.replace('[English] ',''),/Language/],
  ['changed dialogue',s=>s.detailed_description=s.detailed_description.replace('Sample accepted.','Bad math.'),/dialogue/],
  ['missing speaker',s=>s.detailed_description=s.detailed_description.replace('Alex (S1)','The woman'),/exact h3_review\.dialogue\[0\]\.speaker.*before.*not inside.*do not change/],
  ['extra unplanned speech',s=>s.detailed_description+=' <d>[English] Hello.</d>',/dialogue/],
  ['out-of-bounds timing',s=>s.detailed_description=s.detailed_description.replace('0-5 seconds','0-8 seconds'),/duration/],
]) {
  test(`H3 blocks ${name} before ComfyUI POST`,async()=>{
    const h=harness(),s=structuredClone(sections);mutate(s)
    await assert.rejects(h.submit({workflow:graph(s),h3_review:review()},h.exec),pattern)
    assert.equal(h.requests.some(r=>r.url.endsWith('/prompt')),false)
  })
}
test('generic intent cannot bypass H3 checks',async()=>{
  const h=harness()
  await assert.rejects(h.submit({workflow:graph(),intent:'generic'},h.exec),/h3_review/)
  assert.equal(h.requests.length,0)
})
test('review filename must match the actual Picture connection',async()=>{
  const h=harness(),r=review();r.references[0].image='other.png'
  await assert.rejects(h.submit({workflow:graph(),h3_review:r},h.exec),/image|filename|connection/)
  assert.equal(h.requests.some(r=>r.url.endsWith('/prompt')),false)
})
test('reviewed local file must have the same bytes as the staged ComfyUI input',async()=>{
  const h=harness(),submit=createSubmitComfyVideo({readFileImpl:async()=>Buffer.from('different bytes'),fetchImpl:async()=>new Response(bytes)})
  await assert.rejects(submit({workflow:graph(),h3_review:review()},h.exec),/staged reference bytes differ/)
})
test('valid reviewed H3 queues the exact graph and preserves unload and conclude behavior',async()=>{
  const h=harness()
  const result=await h.submit({workflow:graph(),h3_review:review()},h.exec)
  assert.equal(result.prompt_id,'accepted')
  assert.equal(result.llm_unloaded,true)
  assert.equal(h.concluded,1)
  assert.deepEqual(JSON.parse(h.requests.find(r=>r.url.endsWith('/prompt')).init.body).prompt,graph())
})

test('validation-only runs the real H3 checks without queueing, unloading or concluding',async()=>{
  const h=harness()
  const result=await h.submit({workflow:graph(),h3_review:review(),validate_only:true},h.exec)
  assert.equal(result.validated,true)
  assert.equal(result.h3_preflight.references.length,1)
  assert.equal(h.requests.every(r=>r.url.includes('/view?')),true)
  assert.equal(h.concluded,0)
})

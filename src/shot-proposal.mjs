const textFields=['dialogue','incoming_state','ending_state','transition'];
const string={type:'string',maxLength:4000};
const referenceNumbers={type:'array',maxItems:12,uniqueItems:true,items:{type:'integer',minimum:1,maximum:12}};
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max,required=true)=>typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0);
export const proposalSchema={type:'object',additionalProperties:false,properties:{
  version:{type:'string',minLength:1,maxLength:80},
  clip_references:{type:'array',minItems:1,maxItems:40,description:'Use for new cards: exactly one entry per clip. reference_numbers are displayed item numbers in the actual whole-clip Picture connection order, not shot order. All Pictures condition the entire clip; shot reference_numbers only describe relevance. Omission retains legacy first-encounter union order.',items:{type:'object',additionalProperties:false,properties:{clip_id:{type:'string',minLength:1,maxLength:80},reference_numbers:referenceNumbers},required:['clip_id','reference_numbers']}},
  pending_references:{type:'array',maxItems:12,items:{type:'string',minLength:1,maxLength:2000},description:'Blocking missing image files required to fulfill this shot. Use [] when selected reference files are available. An unspecified outfit or optional extra reference is a creative choice, not a missing file: put the chosen outfit in shot content. Every entry here blocks production.'},
  shots:{type:'array',minItems:1,maxItems:40,items:{type:'object',additionalProperties:false,properties:{
    shot_id:{type:'string',minLength:1,maxLength:80},clip_id:{type:'string',minLength:1,maxLength:80},
    duration_seconds:{type:'number',exclusiveMinimum:0,maximum:3600},content:{...string,minLength:1},
    ...Object.fromEntries(textFields.map(key=>[key,string])),
    dialogue:{...string,description:'Exact spoken words and speaker/language. Use an empty string for a silent shot. Include this even when content also describes speaking.'},
    reference_numbers:{...referenceNumbers,description:'Displayed image numbers relevant to this shot; must be included in this clip_references entry. This is not time-gated conditioning. Without clip_references, legacy cards infer Picture order by first encounter across shots.'}
  },required:['shot_id','clip_id','duration_seconds','content','dialogue','reference_numbers']}}
},required:['version','shots']};

function validReferences(refs,itemCount,items){
  return Array.isArray(refs)&&refs.length<=12&&new Set(refs).size===refs.length&&Array.from(refs).every(n=>Number.isInteger(n)&&n>=1&&n<=itemCount&&(!items||items[n-1]?.type==='image'));
}

// One connection-order contract for validation, display, edits and approval.
// Never sort reviewed Picture order or infer missing entries in an explicit
// map. Outer entry order is metadata; use first-shot clip order consistently.
export function clipReferenceLists(proposal,itemCount=12,items){
  const ids=[...new Set(proposal.shots.map(s=>s.clip_id))];
  if(proposal.clip_references===undefined)return ids.map(clip_id=>({clip_id,reference_numbers:[...new Set(proposal.shots.filter(s=>s.clip_id===clip_id).flatMap(s=>s.reference_numbers))]}));
  if(!Array.isArray(proposal.clip_references)||proposal.clip_references.length!==ids.length)throw new Error('clip_references must cover every clip exactly once.');
  const seen=new Set();
  const lists=Array.from(proposal.clip_references,clip=>{
    if(!record(clip)||!text(clip.clip_id,80)||!ids.includes(clip.clip_id)||seen.has(clip.clip_id))throw new Error('clip_references needs distinct existing clip IDs, exactly once each.');
    seen.add(clip.clip_id);
    if(!validReferences(clip.reference_numbers,itemCount,items))throw new Error(`Clip ${clip.clip_id} reference numbers must identify distinct actual displayed images in Picture connection order.`);
    if(proposal.shots.some(s=>s.clip_id===clip.clip_id&&s.reference_numbers.some(n=>!clip.reference_numbers.includes(n))))throw new Error(`Clip ${clip.clip_id} reference order must include every reference used by its shots.`);
    return {clip_id:clip.clip_id,reference_numbers:[...clip.reference_numbers]};
  });
  return ids.map(id=>lists.find(clip=>clip.clip_id===id));
}

// Shared host/browser validation keeps malformed durable results out of React.
// Reference numbers are one-based positions in the displayed items, not filenames.
export function validateProposal(value,itemCount,items){
  if(!record(value)||!text(value.version,80)||!Array.isArray(value.shots)||value.shots.length<1||value.shots.length>40)
    throw new Error('Proposal needs a version and 1–40 shots.');
  const ids=new Set();
  const shots=value.shots.map(shot=>{
    if(!record(shot)||!text(shot.shot_id,80)||!text(shot.clip_id,80)||ids.has(shot.shot_id))throw new Error('Shot IDs must be nonempty and unique; each shot needs a clip ID.');
    ids.add(shot.shot_id);
    if(!Number.isFinite(shot.duration_seconds)||shot.duration_seconds<=0||shot.duration_seconds>3600)throw new Error('Shot duration must be a positive number of seconds, at most 3600.');
    if(!text(shot.content,4000))throw new Error('Each shot needs readable content.');
    const refs=shot.reference_numbers;
    if(!validReferences(refs,itemCount,items))
      throw new Error('Shot reference numbers must point to actual displayed images, in the intended order.');
    const next={shot_id:shot.shot_id,clip_id:shot.clip_id,duration_seconds:shot.duration_seconds,content:shot.content};
    for(const key of textFields)if(shot[key]!==undefined){if(!text(shot[key],4000,false))throw new Error(`Invalid shot ${key}.`);next[key]=shot[key];}
    next.reference_numbers=[...refs];
    return next;
  });
  if(value.pending_references!==undefined&&(!Array.isArray(value.pending_references)||value.pending_references.length>12||value.pending_references.some(v=>!text(v,2000))))throw new Error('Pending references need readable labels, at most 12.');
  const clips=value.clip_references===undefined?{}:{clip_references:clipReferenceLists({...value,shots},itemCount,items)};
  return {version:value.version,shots,...clips,...value.pending_references?.length?{pending_references:[...value.pending_references]}:{}};
}

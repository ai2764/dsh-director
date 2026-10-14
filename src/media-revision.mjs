import {MediaError} from './media-store.mjs';
import {entriesFromEvents} from './proposal-state.mjs';
import {clipReferenceLists} from './shot-proposal.mjs';

export const mediaItemSchema={type:'object',properties:Object.fromEntries(['path','label','caption','shot_id','responsibility'].map(k=>[k,{type:'string'}])),required:['path'],additionalProperties:false};
const textFields=['content','dialogue','incoming_state','ending_state','transition'];
export const revisionSchema={type:'object',description:'Incremental edit ONLY: omit top-level items and proposal entirely. Inspect any new uploaded image with native read_image first.',properties:{
  base_card_id:{type:'string',description:'Copy card_id from the MOST RECENT successful card result. Never copy base_card_id from an earlier call: every edit returns a different card_id. Not the proposal version.'},version:{type:'string',minLength:1,maxLength:80,description:'Optional display label. Omit to allocate a fresh version; reused labels are replaced automatically. Use the version actually returned for confirmation.'},
  reference_changes:{type:'array',maxItems:12,description:'Update existing reference responsibilities using BASE card numbers; e.g. [{reference_number:1,responsibility:"Actor identity only"}] when a new costume takes over clothing. Cannot target the image being replaced/removed. Text uses the resulting Picture numbering.',items:{type:'object',properties:{reference_number:{type:'integer',minimum:1,maximum:12},responsibility:{type:'string',minLength:1,maxLength:2000}},required:['reference_number','responsibility'],additionalProperties:false}},
  change:{type:'object',description:'ADD: {"op":"add","item":{"path":"...","responsibility":"Costume"},"shot_ids":["S1"]}. REPLACE: {"op":"replace","reference_number":3,"item":{"path":"..."}}. REMOVE: {"op":"remove","reference_number":3}.',properties:{op:{type:'string',enum:['add','replace','remove']},reference_number:{type:'integer',minimum:1,maximum:12,description:'Required for replace/remove only; omit for add (it appends automatically).'},item:{...mediaItemSchema,description:'Required for add AND replace. Put the new image path here, not in top-level items.'},shot_ids:{type:'array',items:{type:'string'},minItems:1,description:'Required for add only: existing shot IDs to bind the appended image.'}},required:['op'],additionalProperties:false},
  shot_changes:{type:'array',maxItems:40,items:{type:'object',properties:{shot_id:{type:'string'},duration_seconds:{type:'number'},...Object.fromEntries(textFields.map(k=>[k,{type:'string'}]))},required:['shot_id'],additionalProperties:false}}
},required:['base_card_id'],additionalProperties:false};

// Resolve against the durable latest card, never the model's reconstructed list.
// A single reference operation per revision keeps numbering unambiguous.
export async function prepareRevision(args,{session,store,signal}){
  if(args.items!==undefined||args.proposal!==undefined)throw new MediaError('Use either revision or full items/proposal; do not mix them.');
  const r=args.revision;
  const cards=entriesFromEvents(session.snapshotEvents?.()??[]).filter(e=>e.kind==='proposal');
  const base=cards.at(-1)?.value;
  if(!r?.base_card_id||!base?.card_id||r.base_card_id!==base.card_id)throw new MediaError(`Stale or unavailable base card. Use the latest card_id${base?.card_id?': '+base.card_id: ' or present a full proposal first'}.`,409);
  if(r.version!==undefined&&(typeof r.version!=='string'||!r.version.trim()||r.version.length>80))throw new MediaError('Proposal version must be a nonempty string of at most 80 characters, or omitted.');
  // Labels are bookkeeping, not creative choices. Avoid another model round
  // for a missing/repeated label; card identity and fresh approval still gate.
  const used=new Set(cards.map(e=>e.value.proposal.version).filter(v=>typeof v==='string').map(v=>v.trim().toLowerCase()));
  let version=r.version;
  if(version===undefined||used.has(version.trim().toLowerCase())){
    let n=cards.length+1;
    while(used.has('v'+n))n++;
    version='v'+n;
  }
  const proposal=structuredClone(base.proposal);proposal.version=version;
  const clipRefs=new Map(clipReferenceLists(base.proposal,base.items.length,base.items).map(c=>[c.clip_id,c.reference_numbers]));
  const changes=r.shot_changes??[];
  if(!Array.isArray(changes)||changes.length>40)throw new MediaError('Invalid shot_changes.');
  const seen=new Set();
  for(const patch of changes){
    const shot=proposal.shots.find(s=>s.shot_id===patch?.shot_id);
    if(!shot||seen.has(patch.shot_id)||Object.keys(patch).some(k=>!['shot_id','duration_seconds',...textFields].includes(k)))throw new MediaError('shot_changes must name distinct existing shots and editable fields.');
    seen.add(patch.shot_id);Object.assign(shot,patch);
  }
  const items=base.items.map(item=>({original:item})),op=r.change;
  const referenceChanges=r.reference_changes??[],patchedResponsibilities=new Set();
  if(!Array.isArray(referenceChanges)||referenceChanges.length>12)throw new MediaError('Invalid reference_changes.');
  for(const patch of referenceChanges){
    const n=patch?.reference_number,entry=items[n-1];
    if(!Number.isInteger(n)||!entry||patchedResponsibilities.has(entry.original.id)||typeof patch.responsibility!=='string'||!patch.responsibility.trim()||patch.responsibility.length>2000||Object.keys(patch).some(k=>!['reference_number','responsibility'].includes(k))||op&&['replace','remove'].includes(op.op)&&op.reference_number===n)
      throw new MediaError('reference_changes must name distinct retained base-card references and a nonempty responsibility; set the replacement responsibility on the new item.');
    patchedResponsibilities.add(entry.original.id);
    entry.original={...entry.original,responsibility:patch.responsibility};
  }
  if(!op&&!changes.length&&!referenceChanges.length)throw new MediaError('Provide change, shot_changes or reference_changes.');
  if(op){
    if(!['add','replace','remove'].includes(op.op))throw new MediaError('Unknown reference change operation.');
    if(op.op==='add'){
      if(op.reference_number!==undefined||!Array.isArray(op.shot_ids)||!op.shot_ids.length||new Set(op.shot_ids).size!==op.shot_ids.length||op.shot_ids.some(id=>!proposal.shots.some(s=>s.shot_id===id)))throw new MediaError('Add appends an item; provide existing shot_ids, not reference_number.');
      if(items.length>=12)throw new MediaError('Provide at most 12 media items.');
      items.push({item:op.item});
      for(const shot of proposal.shots)if(op.shot_ids.includes(shot.shot_id))shot.reference_numbers.push(items.length);
      if(proposal.clip_references){
        const affected=new Set(proposal.shots.filter(s=>op.shot_ids.includes(s.shot_id)).map(s=>s.clip_id));
        for(const clip of proposal.clip_references)if(affected.has(clip.clip_id))clip.reference_numbers.push(items.length);
      }
      // Explicit clip orders append without disturbing existing Pictures.
      // Legacy cards retain the early-shot insertion/remapping contract.
      const afterClips=new Map(clipReferenceLists(proposal).map(c=>[c.clip_id,c.reference_numbers]));
      const mappings=new Map([...clipRefs].map(([clip,before])=>{
        const after=afterClips.get(clip);
        return [clip,before.map(n=>after.indexOf(n)+1)];
      }));
      const remap=(text,map)=>text.replace(/\bPicture\s*#?\s*(\d+)\b/gi,(match,n)=>map[Number(n)-1]?match.replace(/\d+$/,String(map[Number(n)-1])):match);
      for(const shot of proposal.shots){
        const patch=changes.find(p=>p.shot_id===shot.shot_id);
        for(const field of textFields.filter(f=>f!=='dialogue'))if(typeof shot[field]==='string'&&!Object.hasOwn(patch??{},field))shot[field]=remap(shot[field],mappings.get(shot.clip_id));
      }
      for(const [i,entry] of items.entries())if(entry.original)for(const field of ['label','caption','responsibility'])if(typeof entry.original[field]==='string'){
        if(field==='responsibility'&&patchedResponsibilities.has(entry.original.id))continue;
        const variants=new Set([...clipRefs].filter(([,refs])=>refs.includes(i+1)).map(([clip])=>remap(entry.original[field],mappings.get(clip))));
        if(variants.size>1)throw new MediaError('Shared item caption has ambiguous clip Picture numbering; present a full revised proposal.');
        if(variants.size)entry.original={...entry.original,[field]:[...variants][0]};
      }
    }else{
      const n=op.reference_number;
      if(!Number.isInteger(n)||n<1||n>items.length)throw new MediaError('reference_number must identify an existing card item (one-based).');
      if(op.shot_ids!==undefined)throw new MediaError('Replace/remove affects existing bindings; omit shot_ids.');
      if(op.op==='replace')items[n-1]={item:op.item};
      else{
        if(op.item!==undefined)throw new MediaError('Remove takes no item.');
        if(items.length===1)throw new MediaError('Cannot remove the last reference from a proposal.');
        items.splice(n-1,1);
        if(proposal.clip_references)for(const clip of proposal.clip_references)clip.reference_numbers=clip.reference_numbers.filter(i=>i!==n).map(i=>i>n?i-1:i);
        for(const shot of proposal.shots){
          shot.reference_numbers=shot.reference_numbers.filter(i=>i!==n).map(i=>i>n?i-1:i);
          // User-supplied patches use NEW numbering. Unchanged prose with a
          // deleted reference needs an explicit creative repair, not a guess.
          const patch=changes.find(p=>p.shot_id===shot.shot_id);
          const removedPicture=clipRefs.get(shot.clip_id).indexOf(n)+1;
          // dialogue is exact speech, not structural Picture markup.
          for(const field of textFields.filter(f=>f!=='dialogue'))if(removedPicture&&typeof shot[field]==='string'&&!Object.hasOwn(patch??{},field))shot[field]=remapPictures(shot[field],removedPicture);
        }
        for(const entry of items)for(const field of ['label','caption','responsibility'])if(typeof entry.original?.[field]==='string'){
          if(field==='responsibility'&&patchedResponsibilities.has(entry.original.id))continue;
          const sourceIndex=base.items.findIndex(i=>i.id===entry.original.id)+1;
          const owners=[...clipRefs.values()].filter(refs=>refs.includes(sourceIndex));
          const variants=new Set(owners.map(refs=>{const picture=refs.indexOf(n)+1;return picture?remapPictures(entry.original[field],picture):entry.original[field];}));
          if(variants.size>1)throw new MediaError('Shared item caption has ambiguous clip Picture numbering; present a full revised proposal.');
          entry.original={...entry.original,[field]:variants.size?[...variants][0]:entry.original[field]};
        }
      }
    }
    if(op.op!=='remove'&&(typeof op.item?.path!=='string'||!op.item.path.trim()))throw new MediaError('Add/replace requires item.path.');
  }
  const expectedHashes=new Map(),resolved=[];
  for(const [i,entry] of items.entries()){
    if(entry.item){resolved.push(entry.item);continue;}
    const old=entry.original,record=await store.openVerified(old.id,session.id,signal);
    try{
      if(record.sha256!==old.sha256)throw new MediaError('Stored reference changed.',409);
      resolved.push({path:record.source,...Object.fromEntries(['label','caption','shot_id','responsibility'].filter(k=>typeof old[k]==='string').map(k=>[k,old[k]]))});
      expectedHashes.set(i,record.sha256);
    }finally{await record.handle.close();}
  }
  return {args:{title:args.title??base.title,items:resolved,proposal},expectedHashes};
}
function remapPictures(text,removed){
  return text.replace(/\bPicture\s*#?\s*(\d+)\b/gi,(match,digits)=>{
    const n=Number(digits);
    if(n===removed)throw new MediaError(`Deleted Picture ${removed} is still mentioned. Provide shot_changes (new numbering), or a full revised proposal for item captions.`);
    return n>removed?match.replace(/\d+$/,String(n-1)):match;
  });
}

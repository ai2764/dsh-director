import {clipReferenceLists} from './shot-proposal.mjs';
const textOf=content=>(content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
function mediaValue(block){
  if(block?.isError)return null;
  try{const value=JSON.parse(textOf(block.content));return value.kind==='director-media'&&value.proposal?value:null;}catch{return null;}
}
function boundHashes(value,clipId){
  const indices=new Set(clipReferenceLists(value.proposal,value.items.length,value.items).filter(c=>!clipId||c.clip_id===clipId).flatMap(c=>c.reference_numbers));
  return [...indices].map(n=>value.items[n-1]?.sha256?.toLowerCase()).filter(Boolean);
}
// A flat/dotted socket is a graph input, not a new visual asset. Remove only
// this unnumbered technical clause, never the rest of a mixed user request.
function withoutSocketRewrite(text){
  return text.replace(/\b(?:replace|swap)\s+(?:(?:the|old|stale|existing)\s+)*(?:refs|references)\s+with\s+((?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|real|new|flat|dotted|h3|input|reference)\s+)+)sockets?\b/giu,
    (match,attributes)=>/\b(?:flat|dotted)\b/iu.test(attributes)?'rewire graph sockets':match);
}
// A "no" list can continue through nominal technical items, but never through
// an imperative, a numbered target, an unknown clause, or a semicolon.
function withoutReferenceProhibitions(text){
  let noList=false;
  return text.split(/([,，;；]|\s+(?:and|or)\s+)/iu).map((part,i)=>{
    if(i%2){if(/[;；]/u.test(part))noList=false;return part;}
    const explicit=/^\s*no\s+/iu.test(part);
    const noun=part.replace(/^\s*no\s+/iu,'').trim();
    const referenceEdit=/^(?:refs?|references?|images?|pictures?|layouts?)\s+(?:changes?|edits?|replacements?|additions?|removals?|deletions?)$/iu.test(noun);
    const technicalItem=/^(?:(?:script|workflow) rebuild|(?:prompt|wording) rewrite|card|new generation mode)s?$/iu.test(noun);
    noList=(explicit||noList)&&(referenceEdit||technicalItem);
    return noList&&referenceEdit?'unchanged bindings':part;
  }).join('');
}
// A mechanical operation/binding guard, not visual or general language QC.
// Bare 换图/加图/删图 count as explicit reference mutations; mere mentions and
// prohibitions do not. Numbered targets refer to the card's Reference #N.
function referenceMutations(text){
  const requests=[];
  for(const originalLine of text.split(/[\n。.!！;；]/u)){
    const line=withoutSocketRewrite(withoutReferenceProhibitions(originalLine)).replace(/`[^`]*`/gu,'').replace(/\bshot\s*\/\s*ref(?:erence)?\s+review\s+card\b/giu,'review card');
    if(/^\s*(?:your|the|that)\b.*\bcall was not an authorized reference edit\b|^\s*it attempted to\b/iu.test(line))continue;
    if(/(?:不要|不需要|不用|禁止|勿|别|do not|don't|no new|without)/iu.test(line))continue;
    // Production instructions and schema declarations are not edits to the
    // reference list displayed on a review card.
    if(/^\s*h3_review\s+references\s+include\b/iu.test(line))continue;
    // The operation must target an image/reference, not merely coexist with
    // that word. Do not cross a workflow/model/prompt object to find an image.
    const object='(?:ref(?:erence)?s?(?:\\b|\\d+)|参考(?:图|素材)?(?!图|素材)|图片|\\b(?:image|picture|layout)s?\\b|图(?!片))';
    // Exclude the reference's textual property, not a descriptor elsewhere
    // in the request ("reference #2 with unknown provenance: remove it").
    // Compound visual nouns such as "reference provenance image" stay visual.
    const proseProperty='\\s+(?:wording|provenance)\\b(?![-\\w]|\\s+(?:image|picture|reference|ref|file)s?\\b)';
    const visualObject=`${object}(?!${proseProperty})`;
    const codingObject='(?:工作流|模型|提示词|节点|分辨率|\\b(?:workflow|model|prompt|node|resolution|generator|loaders?\\d*|sockets?)\\b)';
    const span=`(?:(?!${codingObject}|\\bunchanged\\b|\\bunless\\b|不变|保持)[^,，;；]){0,80}?`;
    const notCodingObject=`(?!\\s*(?:的)?${codingObject})`;
    const targets=action=>new RegExp(`${action}${span}${visualObject}${notCodingObject}|${visualObject}${span}${action}${notCodingObject}`,'iu').test(line);
    const operations=[];
    if(targets('(?:删除|删|移除|去掉|\\b(?:remove|delete|drop)\\b)'))operations.push('remove');
    if(targets('(?:替换|换成|更换|换|改成|修改|\\b(?:replace|change|update|swap)\\b)'))operations.push('replace');
    if(targets('(?:加入|添加|增加|新增|补充|补上|加|\\badd\\b)')||new RegExp(`^\\s*(?:please\\s+)?include${span}${visualObject}${notCodingObject}`,'iu').test(line))operations.push('add');
    if(!operations.length)continue;
    const target=/第\s*([一二三四五六七八九十\d]+)\s*(?:张|个|幅)?/u.exec(line)?.[1]??/(?:ref(?:erence)?(?:\s*(?:image|picture))?|picture|image)\s*#?\s*(\d+)\b/iu.exec(line)?.[1]??/#\s*(\d+)/u.exec(line)?.[1];
    const clipOrdinal=/\b(?:clip|c)\s*[-#]?\s*(\d+)\b/iu.exec(line)?.[1];
    const chinese={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,十一:11,十二:12};
    requests.push({text:originalLine.trim(),operations,target:target===undefined?undefined:chinese[target]??Number(target),clipOrdinal:clipOrdinal===undefined?undefined:Number(clipOrdinal)});
  }
  return requests;
}
const referenceRequest=text=>referenceMutations(text).length>0;
function fulfilled(request,hashes){
  // A malformed card is not an empty baseline. Never infer that an edit was
  // fulfilled when its original conditioning could not be resolved.
  if(!Array.isArray(request.baseline))return false;
  const before=request.baseline,old=new Set(before),next=new Set(hashes);
  const added=[...next].filter(h=>!old.has(h)),removed=[...old].filter(h=>!next.has(h));
  const add=request.operations.includes('add'),replace=request.operations.includes('replace'),remove=request.operations.includes('remove');
  if(added.length<Number(add)+Number(replace)||removed.length<Number(remove)+Number(replace))return false;
  if(!add&&!replace&&added.length||!remove&&!replace&&removed.length)return false;
  if(replace&&!add&&!remove&&added.length!==removed.length)return false;
  if(add&&!remove&&hashes.length<=before.length||remove&&!add&&hashes.length>=before.length)return false;
  // Retained references keep their relative order, even when a new image is
  // inserted between them. A relabel, duplicate, or unrelated removal fails.
  const kept=before.filter(h=>next.has(h)),actualKept=hashes.filter(h=>old.has(h));
  if(kept.length!==actualKept.length||kept.some((h,i)=>h!==actualKept[i]))return false;
  if(request.target!==undefined&&(replace||remove)){
    if(!request.targetHash||!old.has(request.targetHash)||!removed.includes(request.targetHash))return false;
    if(request.operations.length===1&&removed.length!==1)return false;
    if(replace&&!add&&!remove&&!added.includes(hashes[before.indexOf(request.targetHash)]))return false;
  }
  return true;
}
function readOnlyReply(text){
  if(/^(?:请|帮我)?(?:改|换|加|去掉|删除|调整|重新|让|用)|^(?:please\s+)?(?:change|replace|remove|add|revise|use)\b/iu.test(text))return false;
  return /[?？]|(?:跑完|进度|状态|谢谢)|^(?:thanks|thank you|what|how|why|is|has|did)\b/iu.test(text);
}
function confirmation(text,version){
  const normalized=text.trim().replace(/[.!。！]+$/u,'').toLowerCase();
  if(/^(ok|okay|yes|approved|confirm|confirmed|go ahead|好|好的|确认|同意|可以)$/u.test(normalized))return true;
  return [`confirm ${version}`,`approve ${version}`,`approved ${version}`,`确认 ${version}`,`确认${version}`].some(s=>normalized===s.toLowerCase());
}
export function entriesFromEvents(events){
  const entries=[];
  for(const event of events??[]){
    if(event.type==='user/message'&&event.data?.source?.kind==='user')entries.push({seq:event.seq,kind:'user',text:textOf(event.data.content)});
    if(event.type==='tool/result')for(const block of event.data?.message?.content??[]){const value=mediaValue(block);if(value)entries.push({seq:event.seq,callId:block.toolCallId,kind:'proposal',value});}
  }
  return entries;
}
export function entriesFromChat(snapshot){
  const entries=[];
  function tools(block){
    if(block?.kind==='tool-result'){const value=mediaValue(block);if(value)entries.push({seq:block.seq,callId:block.callId,kind:'proposal',value});}
    for(const child of block?.subCalls??[])tools(child);
  }
  for(const key of snapshot?.order??[]){const node=snapshot.nodes.get(key);
    if(['user','steering'].includes(node?.kind)&&node.data.source?.kind==='user')entries.push({seq:node.data.seq,kind:'user',text:textOf(node.data.content)});
    if(node?.kind==='tool-call')tools(node.data.root);
  }
  return entries;
}
export function proposalState(entries,version,card){
  let latest,approvedSeq,referenceError,latestHashes=[],status='awaiting_confirmation';const requests=[];
  const userLines=new Set(entries.filter(e=>e.kind==='user').flatMap(e=>e.text.split(/[\n。.!！]/u).map(t=>t.trim())));
  const clips=value=>[...new Set(value.proposal.shots.map(s=>s.clip_id))];
  const applies=(request,value)=>!request.clips.length||request.clips.some(id=>clips(value).includes(id));
  for(const entry of [...entries].sort((a,b)=>a.seq-b.seq)){
    if(entry.kind==='user'){
      for(const request of referenceMutations(entry.text)){
        const existingClips=latest?clips(latest.value):[];
        const clipId=request.clipOrdinal===undefined?undefined:existingClips[request.clipOrdinal-1];
        let baseline=latestHashes;
        if(request.clipOrdinal!==undefined){
          try{baseline=clipId?boundHashes(latest.value,clipId):null;}
          catch{baseline=null;}
        }
        requests.push({...request,clips:clipId?[clipId]:existingClips,clipId,baseline,targetHash:request.target===undefined?undefined:latest?.value.items?.[request.target-1]?.sha256?.toLowerCase()});
      }
      if(latest&&!referenceError&&confirmation(entry.text,latest.value.proposal.version)){approvedSeq=entry.seq;status='confirmed';}
      else if(latest&&!readOnlyReply(entry.text)){approvedSeq=undefined;status='changes_requested';}
    }else if(entry.kind==='proposal'){
      latest=entry;approvedSeq=undefined;referenceError=undefined;status='awaiting_confirmation';
      try{latestHashes=boundHashes(entry.value);}
      catch(error){latestHashes=null;referenceError=error.message;continue;}
      for(let i=requests.length-1;i>=0;i--)if(applies(requests[i],entry.value)){
        let hashes=latestHashes;
        if(requests[i].clipId)try{hashes=boundHashes(entry.value,requests[i].clipId);}catch{hashes=null;}
        if(Array.isArray(hashes)&&fulfilled(requests[i],hashes))requests.splice(i,1);
      }
    }
  }
  if(!latest)return {status:'unverified',pending:requests.map(r=>r.text)};
  // Old cards copied auto-detected requests into pending_references. Recompute
  // those from their human source; keep genuinely declared missing assets.
  const legacyInferred=t=>userLines.has(t)&&(referenceRequest(t)||!referenceRequest(t)&&/\b(?:director_edit_review|shot\s*\/\s*ref\s+review\s+card)\b/iu.test(t)||/^\s*(?:keep|preserve|retain)\b[^;；]{0,200}\b(?:refs?|references?|images?|pictures?|layouts?)\b[^;；]{0,80}\bunless\b/iu.test(t)||withoutSocketRewrite(t)!==t&&!referenceRequest(t)||withoutReferenceProhibitions(t)!==t&&!referenceRequest(t)||/^\s*h3_review\s+references\s+include\b/iu.test(t)||/^\s*THIS TURN\b.*\bgenerate\b.*\bLayouts?\b/iu.test(t)||/^\s*Remove\b.*\bloaders?\d*\b.*\bref sockets\b/iu.test(t));
  const relevant=requests.filter(r=>applies(r,latest.value));
  const pending=[...relevant.map(r=>r.text),...(latest.value.proposal.pending_references??[]).filter(t=>!legacyInferred(t))];
  const unverifiable=relevant.filter(r=>!Array.isArray(r.baseline)).map(r=>r.text);
  if(version!==latest.value.proposal.version||card?.seq!==undefined&&(card.seq!==latest.seq||card.callId!==undefined&&latest.callId!==undefined&&card.callId!==latest.callId))return {status:'superseded',pending:[],latestVersion:latest.value.proposal.version};
  return {status:referenceError?'invalid_references':pending.length?'references_pending':status,pending:[...new Set(pending)],approvedSeq,latestVersion:latest.value.proposal.version,value:latest.value,...referenceError?{referenceError}:{},...unverifiable.length?{unverifiable}:{}};
}
export function assertProposalSubmission(entries,references){
  const latest=[...entries].reverse().find(e=>e.kind==='proposal');
  if(!latest){if(entries.some(e=>e.kind==='user'&&referenceRequest(e.text)))throw Error('Director review: requested reference is pending. Show a proposal with the actual requested reference image and wait for user confirmation.');return;}
  const state=proposalState(entries,latest.value.proposal.version);
  if(state.status==='invalid_references')throw Error(`Director review: latest proposal has invalid references (${state.referenceError}). Show a NEW valid complete proposal and obtain fresh confirmation; an older approval cannot authorize this card.`);
  if(state.unverifiable?.length)throw Error(`Director review: reference edit has an invalid saved baseline (${state.unverifiable.join('; ')}). Its original image bindings cannot be verified. Another full card or confirmation cannot prove this edit was fulfilled. Reconcile the intended references with the user; do not retry unchanged cards or borrow an older approval.`);
  if(state.status==='references_pending')throw Error(`Director review: requested reference is pending (${state.pending.join('; ')}). The bound image differences must fulfill the requested operation: add keeps old images and binds new ones; replace removes the requested old image and binds its replacement; remove actually unbinds the requested image without adding others. Show a NEW complete proposal and wait for confirmation. Changing prose or relabeling identical bytes is not a reference update.`);
  if(state.status!=='confirmed')throw Error(`Director review: confirm the latest complete proposal ${state.latestVersion} before video submission. Model claims and approvals of an older version do not grant approval.`);
  if(references){
    const actual=references.map(r=>r.sha256?.toLowerCase());
    const clips=[...new Set(latest.value.proposal.shots.map(s=>s.clip_id))];
    if(!clips.some(clip=>{const expected=boundHashes(latest.value,clip);return expected.length===actual.length&&expected.every((h,i)=>h===actual[i]);}))throw Error('Director review: submitted reference bytes/order do not match any approved clip reference list. Show the changed actual references in a new proposal and obtain confirmation.');
  }
  return {version:state.latestVersion,approval_seq:state.approvedSeq};
}

import {clipDimensionLists,clipReferenceLists,clipWorkflowLists} from './shot-proposal.mjs';
const textOf=content=>(content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
const directorCalls=new Set(['director_show_media','director_edit_review']);
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
// URLs, registry IDs, version labels and workflow file locations are bookkeeping.
// Approval follows the reviewed plan, continuity route/source and ordered bytes.
export function sameProposalContents(a,b){
  const content=value=>({title:value.title,proposal:{...value.proposal,version:undefined,...Array.isArray(value.proposal.clip_workflows)?{clip_workflows:value.proposal.clip_workflows.map(({workflow_path,...route})=>route)}:{}},items:value.items?.map(item=>Object.fromEntries(['type','sha256','label','caption','shot_id','responsibility'].filter(key=>item[key]!==undefined).map(key=>[key,item[key]])))});
  return Boolean(a?.proposal&&b?.proposal)&&JSON.stringify(sorted(content(a)))===JSON.stringify(sorted(content(b)));
}
export const proposalConfirmationText=value=>value?.card_id?`确认卡片 ${value.card_id}`:`Confirm ${value?.proposal?.version??''}`;
export const latestProposal=entries=>[...entries].filter(entry=>entry.kind==='proposal'&&!entry.value?.replay).sort((a,b)=>a.seq-b.seq).at(-1);
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
// A repair report quotes the former classification; it is not an imperative.
// Strip only that diagnostic clause so a later real image edit remains visible.
const withoutReferenceDiagnostic=text=>text.replace(/修复(?:了)?把[^，,;；]{0,80}误判为[^，,;；]{0,80}的问题/gu,'已修复分类问题');
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
    const line=withoutReferenceDiagnostic(withoutSocketRewrite(withoutReferenceProhibitions(originalLine))).replace(/`[^`]*`/gu,'').replace(/\bshot\s*\/\s*ref(?:erence)?\s+review\s+card\b/giu,'review card');
    if(/^\s*(?:your|the|that)\b.*\bcall was not an authorized reference edit\b|^\s*it attempted to\b/iu.test(line))continue;
    if(/(?:不要|不需要|不用|禁止|勿|别|do not|don't|no new|without)/iu.test(line)||stoppedGraphEdit(line))continue;
    // Production instructions and schema declarations are not edits to the
    // reference list displayed on a review card.
    if(/^\s*h3_review\s+references\s+include\b/iu.test(line))continue;
    // The operation must target an image/reference, not merely coexist with
    // that word. Do not cross a workflow/model/prompt object to find an image.
    const object='(?:ref(?:erence)?s?(?:\\b|\\d+)|参考(?:图|素材)?(?!图|素材|视频|音频|帧|片段)|图片|\\b(?:image|picture|layout)s?\\b|图(?!片))';
    // Exclude the reference's textual property, not a descriptor elsewhere
    // in the request ("reference #2 with unknown provenance: remove it").
    // Compound visual nouns such as "reference provenance image" stay visual.
    const proseProperty='\\s+(?:wording|provenance)\\b(?![-\\w]|\\s+(?:image|picture|reference|ref|file)s?\\b)';
    const visualObject=`${object}(?!${proseProperty})`;
    const codingObject='(?:工作流|模型|提示词|节点|分辨率|输入|插槽|\\b(?:workflow|model|prompt|node|resolution|generator|loaders?\\d*|sockets?|inputs?|ports?)\\b)';
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
const stoppedGraphEdit=text=>/(?:停止|停下|暂停)(?:修改|改动|更换|替换|删除|添加|换|删)[^，,。;；]{0,35}(?:四张图|JSON|工作流|节点|接线)|\b(?:stop|cease)\s+(?:modifying|editing|changing)\b[^,.;]{0,35}\b(?:JSON|workflow|graph|node|wiring)\b/iu.test(text);
const referenceInputStatement=text=>/(?:参考(?:图)?(?:输入|插槽)|\b(?:refs?|references?|images?|pictures?)\s+(?:inputs?|sockets?|ports?)\b)/iu.test(text);
const videoContextStatement=text=>/(?:参考视频|上下文视频|\b(?:reference|context)\s+video\b)/iu.test(text)&&/(?:工作流|节点|\b(?:C|clip)\s*\d+\b|VHS_|MotionContext|context_frames)/iu.test(text);
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
  // A retry of an already approved card after a graph-only repair does not
  // change the user's visual decision. Keep the approval only when the reply
  // explicitly says that the prompt/refs/timing are unchanged; a new card
  // still resets approval in proposalState below.
  const retry=/^\s*(?:继续|重试|再试|恢复|retry\b|resume\b)/iu.test(text);
  const approved=/已确认|确认过|already approved|previously approved/iu.test(text);
  const unchanged=/(?:提示词|参考图|台词|时长|镜头|卡片|方案)[^。\n]{0,100}(?:未改|不变|不改|保持原样|unchanged)/iu.test(text);
  const creativeEdit=/(?:改|换|调整|增加|删除|替换|change|replace|revise|add|remove)[^。\n]{0,35}(?:剧情|对白|台词|服装|衣服|角色|动作|场景|镜头|时长|参考图|卡片)/iu.test(text);
  if(retry&&approved&&unchanged&&!creativeEdit&&!referenceRequest(text))return true;
  // A question mark does not turn an edit into a status question. Check the
  // requested creative change before recognizing conversational questions.
  if(text.replace(/\bremove\s+the\s+sample\b[^\n;；]{0,120}\bwording\b/giu,'reuse template structure').split(/[，,。;；\n]/u).some(clause=>!/(?:不要|不需要|不用|禁止|勿|别|不改|不变|do not|don't|unchanged)/iu.test(clause)&&/(?:改成|修改|更改|替换|调整|换|增加|删除|\b(?:change|replace|revise|add|remove)\b)[^。\n]{0,70}(?:剧情|对白|台词|服装|衣服|角色|动作|场景|镜头|时长|参考图|卡片|近景|远景|\b(?:dialogue|line|action|shot|duration|costume|scene|reference|plan)\b)|(?:剧情|对白|台词|服装|衣服|角色|动作|场景|镜头|时长|参考图|卡片)[^。\n]{0,35}(?:改|换|调整|增加|删除)/iu.test(clause)))return false;
  if(/^(?:请|帮我)?(?:改|换|加|去掉|删除|调整|重新|让|用)|^(?:please\s+)?(?:change|replace|remove|add|revise|use)\b/iu.test(text))return false;
  if(/^(?:好|弄好|完成|准备好)了吗[?？]?$/u.test(text.trim()))return true;
  return /[?？]|(?:跑完|进度|状态|谢谢)|^(?:thanks|thank you|what|how|why|is|has|did)\b/iu.test(text);
}
const confirmationNormalized=text=>text.trim().replace(/[.!。！]+$/u,'').toLowerCase();
function explicitConfirmation(text,version,cardId){
  const normalized=confirmationNormalized(text);
  return Boolean(cardId&&normalized===`确认卡片 ${cardId}`.toLowerCase())||[`confirm ${version}`,`approve ${version}`,`approved ${version}`,`确认 ${version}`,`确认${version}`].some(s=>normalized===s.toLowerCase());
}
function confirmation(text,version,cardId){
  const normalized=confirmationNormalized(text);
  if(explicitConfirmation(text,version,cardId))return true;
  if(/^(ok|okay|yes|approved|confirm|confirmed|go ahead|好|好的|确认|同意|可以)$/u.test(normalized))return true;
  if(/^(?:好|好的|确认|可以|同意)[，,\s]*(?:开始吧|开始|按这个生成|按这个做|生成吧|生成|继续吧)$|^继续(?:吧)?$|^(?:ok|okay|yes)[,\s]+(?:go ahead|start|proceed)$/iu.test(normalized))return true;
  return false;
}
export function entriesFromEvents(events){
  const entries=[],calls=new Map(),seen=new Set();
  for(const event of [...events??[]].sort((a,b)=>a.seq-b.seq)){
    if(event.type==='tool/call')calls.set(event.data?.callId,event.data);
    if(event.type==='user/message'&&event.data?.source?.kind==='user')entries.push({seq:event.seq,kind:'user',text:textOf(event.data.content)});
    if(event.type==='tool/result'){
      const message=event.data?.message;
      const blocks=message?.role==='tool'||message?.source?.kind==='tool'?[{...message,toolCallId:message.toolCallId??message.source?.callId}]:(message?.content??[]).filter(block=>block.type==='tool-result');
      for(const block of blocks){
        const callId=block.toolCallId;
        if(seen.has(callId)||!directorCalls.has(calls.get(callId)?.name))continue;
        const value=mediaValue(block);
        if(value){entries.push({seq:event.seq,callId,kind:'proposal',value});seen.add(callId);}
      }
    }
  }
  return entries;
}
export function entriesFromChat(snapshot){
  const entries=[],seen=new Set();
  function tools(block){
    if(block?.kind==='tool-result'&&directorCalls.has(block.call?.name)&&!seen.has(block.callId)){const value=mediaValue(block);if(value){entries.push({seq:block.seq,callId:block.callId,kind:'proposal',value});seen.add(block.callId);}}
    for(const child of block?.subCalls??[])tools(child);
  }
  for(const key of snapshot?.order??[]){const node=snapshot.nodes.get(key);
    if(['user','steering'].includes(node?.kind)&&node.data.source?.kind==='user')entries.push({seq:node.data.seq,kind:'user',text:textOf(node.data.content)});
    if(node?.kind==='tool-call')tools(node.data.root);
  }
  return entries;
}
export function proposalState(entries,version,card){
  let latest,displayed,approvedSeq,referenceError,latestHashes=[],status='awaiting_confirmation',equivalentCards=[];const requests=[];
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
      if(latest&&!referenceError&&equivalentCards.some(card=>confirmation(entry.text,card.value.proposal.version,card.value.card_id))){
        const showingCurrent=equivalentCards.some(card=>displayed===card||card.value.card_id&&displayed?.value.card_id===card.value.card_id);
        if(showingCurrent||equivalentCards.some(card=>explicitConfirmation(entry.text,card.value.proposal.version,card.value.card_id))){approvedSeq=entry.seq;status='confirmed';}
      }
      else if(latest&&!readOnlyReply(entry.text)){approvedSeq=undefined;status='changes_requested';}
    }else if(entry.kind==='proposal'){
      displayed=entry;
      if(entry.value.replay)continue;
      // Before replay existed, repeated display allocated a fresh UUID even
      // for the exact same reviewed bytes and plan. Recover those consecutive
      // aliases without inheriting approval across any genuine intervening edit.
      if(entry.value.card_id&&latest?.value.card_id&&sameProposalContents(entry.value,latest.value)){
        latest=entry;equivalentCards.push(entry);continue;
      }
      equivalentCards=[entry];
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
  const legacyInferred=t=>userLines.has(t)&&(referenceRequest(t)||stoppedGraphEdit(t)||videoContextStatement(t)||!referenceRequest(t)&&/\b(?:director_edit_review|shot\s*\/\s*ref\s+review\s+card)\b/iu.test(t)||/^\s*(?:keep|preserve|retain)\b[^;；]{0,200}\b(?:refs?|references?|images?|pictures?|layouts?)\b[^;；]{0,80}\bunless\b/iu.test(t)||withoutSocketRewrite(t)!==t&&!referenceRequest(t)||withoutReferenceDiagnostic(t)!==t&&!referenceRequest(t)||referenceInputStatement(t)&&!referenceRequest(t)||withoutReferenceProhibitions(t)!==t&&!referenceRequest(t)||/^\s*h3_review\s+references\s+include\b/iu.test(t)||/^\s*THIS TURN\b.*\bgenerate\b.*\bLayouts?\b/iu.test(t)||/^\s*Remove\b.*\bloaders?\d*\b.*\bref sockets\b/iu.test(t));
  const relevant=requests.filter(r=>applies(r,latest.value));
  const pending=[...relevant.map(r=>r.text),...(latest.value.proposal.pending_references??[]).filter(t=>!legacyInferred(t))];
  const unverifiable=relevant.filter(r=>!Array.isArray(r.baseline)).map(r=>r.text);
  const viewedCardId=card?.card_id??entries.find(entry=>entry.kind==='proposal'&&entry.seq===card?.seq&&(card?.callId===undefined||entry.callId===undefined||entry.callId===card.callId))?.value.card_id;
  const equivalentViewedCard=viewedCardId&&equivalentCards.some(entry=>entry.value.card_id===viewedCardId);
  if(!equivalentViewedCard&&(version!==latest.value.proposal.version||(viewedCardId?viewedCardId!==latest.value.card_id:card?.seq!==undefined&&(card.seq!==latest.seq||card.callId!==undefined&&latest.callId!==undefined&&card.callId!==latest.callId))))return {status:'superseded',pending:[],latestVersion:latest.value.proposal.version};
  return {status:referenceError?'invalid_references':pending.length?'references_pending':status,pending:[...new Set(pending)],approvedSeq,latestVersion:latest.value.proposal.version,value:latest.value,...referenceError?{referenceError}:{},...unverifiable.length?{unverifiable}:{}};
}
export function assertProposalSubmission(entries,references,generation,workflow,selection){
  const latest=latestProposal(entries);
  if(!latest){if(selection)throw Error('Director review: selected card is unavailable. Show a complete review card and obtain confirmation, then use its card_id and clip_id.');if(entries.some(e=>e.kind==='user'&&referenceRequest(e.text)))throw Error('Director review: requested reference is pending. Show a proposal with the actual requested reference image and wait for user confirmation.');return;}
  const proposal=latest.value.proposal;
  let matching=[...new Set(proposal.shots.map(shot=>shot.clip_id))];
  if(selection){
    if(!selection.card_id||!selection.clip_id)throw Error('Director review: submission requires both card_id and clip_id from the latest approved card.');
    if(selection.card_id!==latest.value.card_id)throw Error(`Director review: selected card_id is stale. Use the latest card_id ${latest.value.card_id} after confirmation.`);
    if(!matching.includes(selection.clip_id))throw Error(`Director review: clip_id ${selection.clip_id} is not on the selected card. Use one of: ${matching.join(', ')}.`);
    matching=[selection.clip_id];
  }
  const state=proposalState(entries,latest.value.proposal.version);
  if(state.status==='invalid_references')throw Error(`Director review: latest proposal has invalid references (${state.referenceError}). Show a NEW valid complete proposal and obtain fresh confirmation; an older approval cannot authorize this card.`);
  if(state.unverifiable?.length)throw Error(`Director review: reference edit has an invalid saved baseline (${state.unverifiable.join('; ')}). Its original image bindings cannot be verified. Another full card or confirmation cannot prove this edit was fulfilled. Reconcile the intended references with the user; do not retry unchanged cards or borrow an older approval.`);
  if(state.status==='references_pending')throw Error(`Director review: requested reference is pending (${state.pending.join('; ')}). The bound image differences must fulfill the requested operation: add keeps old images and binds new ones; replace removes the requested old image and binds its replacement; remove actually unbinds the requested image without adding others. Show a NEW complete proposal and wait for confirmation. Changing prose or relabeling identical bytes is not a reference update.`);
  if(state.status!=='confirmed')throw Error(`Director review: confirm the latest complete proposal ${state.latestVersion} before video submission. Model claims and approvals of an older version do not grant approval.`);
  const dimensions=generation?clipDimensionLists(proposal):null;
  if(generation&&!dimensions)throw Error('Director review: the approved card has no clip dimensions. Show a new card with planned width and height for every clip, then obtain fresh confirmation.');
  if(generation&&(!Number.isSafeInteger(generation.width)||generation.width<1||!Number.isSafeInteger(generation.height)||generation.height<1))throw Error('Director review: H3 graph dimensions are unresolved; use numeric width and height before submitting against an approved clip size.');
  if(references){
    const actual=references.map(r=>r.sha256?.toLowerCase());
    matching=matching.filter(clip=>{const expected=boundHashes(latest.value,clip);return expected.length===actual.length&&expected.every((h,i)=>h===actual[i]);});
    if(!matching.length)throw Error('Director review: submitted reference bytes/order do not match any approved clip reference list. Show the changed actual references in a new proposal and obtain confirmation.');
  }
  const approved=clipWorkflowLists(proposal);
  if(generation&&(approved||workflow&&['video_frames','sampler_latent','unverified_latent'].includes(workflow.continuity?.mode))){
    if(!approved)throw Error('Director review: dependent H3 clip needs workflow path and continuity route/source on a new approved card.');
    if(!workflow)throw Error('Director review: inspect the prepared workflow and continuity mode before submitting the approved clip.');
    // The card records the inspected template. Compiling its approved plan may
    // create a separate execution file; a pathname is provenance, not a visual
    // decision or proof of unchanged graph contents. Check the prepared route
    // and source, then all other reviewed fields against the same clip below.
    matching=matching.filter(id=>approved.find(clip=>clip.clip_id===id).continuity_mode===workflow.continuity?.mode);
    if(!matching.length)throw Error('Director review: continuity mode does not match the approved clip. Show the actual route on a new card.');
    matching=matching.filter(id=>(approved.find(clip=>clip.clip_id===id).continuity_source??null)===(workflow.continuity?.source??null));
    if(!matching.length)throw Error('Director review: continuity source does not match the approved clip. Show the actual source on a new card.');
  }
  if(generation){
    matching=matching.filter(id=>{const planned=dimensions.find(clip=>clip.clip_id===id);return planned?.width===generation.width&&planned?.height===generation.height;});
    if(!matching.length)throw Error(`Director review: H3 graph canvas ${generation.width} × ${generation.height} does not match the approved clip size. Revise the graph or show a new card and obtain fresh confirmation.`);
  }
  if(generation?.timing&&proposal.shots.every(shot=>Number.isFinite(shot.duration_seconds)&&shot.duration_seconds>0)){
    const {delivered_frames:frames,fps}=generation.timing;
    if(!Number.isSafeInteger(frames)||frames<1||!Number.isFinite(fps)||fps<=0)throw Error('Director review: delivered H3 duration is unresolved. Inspect the workflow timing before submission.');
    matching=matching.filter(id=>Math.abs(frames-Math.round(proposal.shots.filter(shot=>shot.clip_id===id).reduce((sum,shot)=>sum+shot.duration_seconds,0)*fps))<=1);
    if(!matching.length)throw Error(`Director review: delivered H3 duration ${(frames/fps).toFixed(3)} seconds (${frames} frames at ${fps} fps) does not match approved clip duration. All reference, canvas, workflow and duration fields must match the same clip. Change graph length or show a revised card and obtain fresh confirmation.`);
  }
  if(selection?.dialogue!==undefined){
    const expected=proposal.shots.filter(shot=>shot.clip_id===selection.clip_id).map(shot=>shot.dialogue??'').filter(text=>text.trim()&&!silenceLabel(text)).join('\n');
    if(!dialogueMatches(expected,selection.dialogue))throw Error('Director review: submitted dialogue does not match the selected approved clip. Use exact spoken text, or one line per utterance in the form Speaker [Language]: exact words on the card; use an empty string for silence. Preserve order, speaker/language when specified, and all words, or revise the card and obtain confirmation.');
  }
  const reviewedWorkflow=matching.length===1?approved?.find(clip=>clip.clip_id===matching[0]):undefined;
  return {version:state.latestVersion,approval_seq:state.approvedSeq,...latest.value.card_id?{card_id:latest.value.card_id}:{},...matching.length===1?{clip_id:matching[0]}:{},...reviewedWorkflow&&workflow?{reviewed_workflow_path:reviewedWorkflow.workflow_path,submitted_workflow_path:workflow.path??null}:{}};
}

const silenceLabel=text=>/^(?:无|无台词|无对白|无对话|no dialogue|no speech|silent|none)[。.!！]?$/iu.test(text.trim());
const quotePairs=[['"','"'],["'","'"],['“','”'],['‘','’'],['「','」'],['『','』']];
function unquote(text){
  const pair=quotePairs.find(([open,close])=>text.length>=2&&text.startsWith(open)&&text.endsWith(close));
  return pair?text.slice(1,-1).trim():text;
}
function displayDialogue(text){
  if(typeof text!=='string')return undefined;
  return text.trim().replace(/\r\n/gu,'\n').split('\n').map(line=>{
    const trimmed=line.trim(),plain=unquote(trimmed);
    if(plain!==trimmed)return plain;
    const colon=/[:：]/u.exec(trimmed)?.index;
    return colon===undefined?trimmed:trimmed.slice(0,colon+1)+trimmed.slice(colon+1).replace(/^(\s*)([\s\S]*)$/u,(_all,space,words)=>space+unquote(words));
  }).join('\n');
}
function dialogueMatches(expected,actual){
  if(typeof actual==='string')return displayDialogue(silenceLabel(actual)?'':actual)===displayDialogue(expected);
  if(!Array.isArray(actual))return false;
  let remaining=displayDialogue(expected);
  for(const line of actual){
    if(!line||typeof line.text!=='string'||!line.text.trim()||typeof line.speaker!=='string'||typeof line.language!=='string')return false;
    const text=displayDialogue(line.text),speaker=line.speaker.trim(),language=line.language.trim();
    const forms=[text,`${speaker}: ${text}`,`${speaker} [${language}]: ${text}`,`${speaker} (${language}): ${text}`,`${speaker}（${language}）：${text}`].sort((a,b)=>b.length-a.length);
    const matched=forms.find(form=>remaining===form||remaining.startsWith(form+'\n'));
    if(matched===undefined)return false;
    remaining=remaining.slice(matched.length).trimStart();
  }
  return remaining==='';
}

import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {MediaError} from './media-store.mjs';
import {proposalSchema,validateProposal} from './shot-proposal.mjs';
import {entriesFromEvents,proposalState,latestProposal,sameProposalContents,proposalConfirmationText} from './proposal-state.mjs';
import {mediaItemSchema,revisionSchema,prepareRevision} from './media-revision.mjs';
import {currentUploadEvidence} from './upload-evidence.mjs';
import {nativeToolContents} from './native-tool-result.mjs';

function reviewMetadata(value,entries){
  if(!value.proposal)return value;
  const review=proposalState(entries,value.proposal.version,{card_id:value.card_id});
  const {approval_seq:_oldApproval,...card}=value;
  return {...card,review_status:review.status,approval_message:proposalConfirmationText(value),...review.approvedSeq===undefined?{}:{approval_seq:review.approvedSeq}};
}

export function inspectedExternalImage(session,path,since=0){
  if(typeof session?.snapshotEvents!=='function')return false;
  const events=session.snapshotEvents();
  const calls=new Map(events.filter(e=>e.type==='tool/call').map(e=>[e.data.callId,e.data]));
  return events.some(e=>e.type==='tool/result'&&(!since||e.time>=since)&&nativeToolContents(e,calls,'read_image').some(contents=>{
    const actual=/<path>(.*?)<\/path>/s.exec(contents.filter(c=>c.type==='text').map(c=>c.text).join('\n'))?.[1];
    return !!actual&&resolve(actual)===resolve(path)&&contents.some(c=>c.type==='image'&&c.attachment?.attachmentId);
  }));
}
export function createMediaTool({store,fs,attachments}){
  return {
    name:'director_show_media',
    description:'Display local images/videos/audio (including FLAC/MP3/WAV) or create a complete shot/ref review card. To show an existing card again, pass only card_id; replay preserves approval and does not make an older card current. A proposal includes shots with actors/setting/framing/action, exact dialogue, continuity and duration. For final review set clip_dimensions:[{clip_id,width,height}] for every clip from the selected workflow canvas; never guess from the reference image. For dependent H3 clips set clip_workflows:[{clip_id,workflow_path,continuity_mode,continuity_source}] from the inspected graph; the path records the inspected template; submission checks the actual route and source and reports the execution-copy path. Missing dimensions are shown as unspecified and block reviewed H3 submission. For new cards set clip_references:[{clip_id,reference_numbers}] for every clip in actual Picture connection order, using displayed item numbers. Each shot reference_numbers is a relevance subset, not timed conditioning; all clip Pictures condition the whole clip. For small edits use director_edit_review. Actual local files only: current visible human uploads can be used directly; other external images need read_image first. This displays, never generates or approves. Show the card and request confirmation before writing detailed production prompts. Confirmation applies to the returned card_id; submission must identify its clip_id. An identical plan preserves the existing card and approval; changed content receives a fresh unique version.',
    // Keep the model-facing root flat: local constrained decoders can reduce
    // root oneOf/not branches to empty calls. Execute enforces the same modes.
    parameters:{type:'object',properties:{card_id:{type:'string',minLength:1,description:'Replay an existing card from this session without modifying approval; use latest to recover the current card and its current review_status/approval_seq. Use alone.'},title:{type:'string'},proposal:proposalSchema,items:{type:'array',minItems:1,maxItems:12,items:mediaItemSchema,description:'Required for new media or a new proposal; omit only when replaying with card_id.'}},additionalProperties:false},
    timeoutMs:60000,
    async execute(args,exec){
      const session=exec.agent?.session,cwd=session?.header?.cwd;
      if(args?.card_id!==undefined){
        if(Object.keys(args).some(key=>key!=='card_id'))throw new MediaError('Use either card_id replay or full items/proposal; do not mix them.');
        if(!session?.id||!cwd)throw new MediaError('A live session workspace is required.');
        const entries=entriesFromEvents(session.snapshotEvents?.()??[]);
        const base=(args.card_id==='latest'?latestProposal(entries):entries.findLast(entry=>entry.kind==='proposal'&&!entry.value.replay&&entry.value.card_id===args.card_id))?.value;
        if(!base||base.session_id!==session.id)throw new MediaError('Card unavailable in this session. Use a card_id returned by director_show_media or present a full proposal.',404);
        return reviewMetadata({...structuredClone(base),replay:true},entries);
      }
      let expectedHashes;const baseCardId=args?.revision?.base_card_id;
      if(args?.revision!==undefined){
        if(!session?.id||!cwd)throw new MediaError('A live session workspace is required.');
        ({args,expectedHashes}=await prepareRevision(args,{session,store,signal:exec.signal}));
      }
      if(!Array.isArray(args?.items)||!args.items.length||args.items.length>12)throw new MediaError('Provide 1–12 media items.');
      let proposal;
      if(args.proposal!==undefined)try{proposal=validateProposal(args.proposal,args.items.length);}catch(error){throw new MediaError(error.message);}
      if(!session?.id||!cwd)throw new MediaError('A live session workspace is required.');
      const records=[];
      for(const item of args.items){
        const path=typeof item?.path==='string'?item.path:'';
        const source=resolve(cwd,path),readEvidence=inspectedExternalImage(session,source);
        const upload=currentUploadEvidence(session,source,{attachments,fs});
        const record=await store.register({sessionId:session.id,cwd,path,fs,signal:exec.signal,externalEvidence:readEvidence||!!upload});
        if(!readEvidence&&upload&&record.sha256!==upload.sha256)throw new MediaError('Uploaded source changed since its visible attachment; use read_image on the actual current file.',409);
        const {id,type,mime,filename,sha256}=record;
        if(expectedHashes?.has(records.length)&&expectedHashes.get(records.length)!==sha256)throw new MediaError('Source changed during revision; inspect it and present a new full proposal.',409);
        const captions={};
        for(const key of ['label','caption','shot_id','responsibility'])if(typeof item[key]==='string')captions[key]=item[key].slice(0,2000);
        records.push({id,type,mime,filename,sha256,...captions,url:`/director-media/${id}?session=${encodeURIComponent(session.id)}`});
      }
      if(proposal)try{proposal=validateProposal(proposal,records.length,records);}catch(error){throw new MediaError(error.message);}
      const value={kind:'director-media',version:1,card_id:randomUUID(),session_id:session.id,title:typeof args.title==='string'?args.title.slice(0,2000):'Director media',items:records,...proposal?{proposal}:{}};
      if(proposal&&typeof session.snapshotEvents==='function'){
        const events=session.snapshotEvents(),entries=entriesFromEvents(events);
        const current=latestProposal(entries)?.value;
        if(baseCardId&&current?.card_id!==baseCardId)throw new MediaError('A newer card appeared during this revision; use the latest card_id.',409);
        if(current?.card_id&&sameProposalContents(current,value)){
          const paths=card=>JSON.stringify(card.proposal.clip_workflows?.map(clip=>[clip.clip_id,clip.workflow_path]));
          if(paths(current)===paths(value))return reviewMetadata({...structuredClone(current),replay:true},entries);
          // Preserve the approved creative identity while retaining the latest
          // technical path metadata. A replay flag would discard this update.
          const updated={...value,card_id:current.card_id,proposal:{...proposal,version:current.proposal.version}};
          return reviewMetadata(updated,[...entries,{seq:Math.max(0,...events.map(e=>e.seq))+1,kind:'proposal',value:updated}]);
        }
        const used=new Set(entries.filter(entry=>entry.kind==='proposal').map(entry=>entry.value.proposal.version.trim().toLowerCase()));
        if(used.has(proposal.version.trim().toLowerCase())){
          let n=used.size+1;while(used.has('v'+n))n++;
          proposal={...proposal,version:'v'+n};value.proposal=proposal;
        }
        const state=proposalState([...entries,{seq:Math.max(0,...events.map(e=>e.seq))+1,kind:'proposal',value}],proposal.version);
        if(state.pending.length)value.proposal={...proposal,pending_references:state.pending.slice(0,12).map(t=>t.slice(0,2000))};
        return reviewMetadata(value,[...entries,{seq:Math.max(0,...events.map(e=>e.seq))+1,kind:'proposal',value}]);
      }
      return proposal?reviewMetadata(value,[{seq:1,kind:'proposal',value}]):value;
    },
    output:{schema:{type:'object'},render(_args,value){return [{type:'text',text:JSON.stringify(value)}];},presentationMeta(_args,value){return value;}}
  };
}

export function createEditReviewTool(mediaTool){
  return {
    name:'director_edit_review',
    description:'Edit the latest shot/ref card using its card_id. Omit version: a fresh label is automatic (reused labels are also replaced). Use the returned version for confirmation. add appends path + responsibility to shot_ids; replace swaps reference_number for path + responsibility; remove deletes reference_number; shots patches text/roles, complete clip_dimensions or clip_workflows lists. Use visible current uploads directly; otherwise read_image first. A costume change includes the new responsibility, reference_changes narrowing an old Actor + Costume role to Actor only, and shot_changes replacing conflicting wardrobe text while preserving action/dialogue/timing. All changes are saved in one card. The returned card is authoritative and still needs user confirmation; summarize its actual changes and stop.',
    parameters:{type:'object',properties:{
      base_card_id:revisionSchema.properties.base_card_id,version:revisionSchema.properties.version,
      operation:{type:'string',enum:['add','replace','remove','shots']},
      reference_number:{type:'integer',minimum:1,maximum:12,description:'Card index to replace/remove; omit for add/shots.'},
      path:{type:'string',description:'REQUIRED for add or replace: exact path of the new inspected image.'},
      label:{type:'string'},responsibility:{type:'string',description:'For add/replace: the subject and visual fact controlled by this reference, e.g. Costume for Mia only; not actor identity.'},
      shot_ids:{type:'array',items:{type:'string'},minItems:1,description:'REQUIRED for add: existing shots receiving the appended image.'},
      clip_dimensions:revisionSchema.properties.clip_dimensions,
      clip_workflows:revisionSchema.properties.clip_workflows,
      reference_changes:revisionSchema.properties.reference_changes,
      shot_changes:{...revisionSchema.properties.shot_changes,description:'Affected shot fields only. When the new reference changes an explicit costume, replace the old wardrobe wording here, preserving action, dialogue and duration. Omitted fields remain exactly unchanged.'}
    },required:['base_card_id','operation'],additionalProperties:false},
    timeoutMs:60000,
    async execute(args,exec){
      if(!['add','replace','remove','shots'].includes(args?.operation))throw new MediaError('Use operation add, replace, remove or shots.');
      const {operation,base_card_id,version,reference_number,path,label,responsibility,shot_ids,shot_changes,reference_changes,clip_dimensions,clip_workflows}=args;
      if(operation==='shots'&&[path,label,responsibility,reference_number,shot_ids].some(x=>x!==undefined))throw new MediaError('Operation shots accepts only shot_changes, not image/path/reference arguments.');
      const item=[path,label,responsibility].some(x=>x!==undefined)?{path,label,responsibility}:undefined;
      return mediaTool.execute({revision:{base_card_id,version,shot_changes,reference_changes,clip_dimensions,clip_workflows,...operation==='shots'?{}:{change:{op:operation,reference_number,item,shot_ids}}}},exec);
    },
    output:mediaTool.output
  };
}

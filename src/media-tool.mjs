import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {MediaError} from './media-store.mjs';
import {proposalSchema,validateProposal} from './shot-proposal.mjs';
import {entriesFromEvents,proposalState} from './proposal-state.mjs';
import {mediaItemSchema,revisionSchema,prepareRevision} from './media-revision.mjs';
import {currentUploadEvidence} from './upload-evidence.mjs';

export function inspectedExternalImage(session,path,since=0){
  if(typeof session?.snapshotEvents!=='function')return false;
  const events=session.snapshotEvents();
  const calls=new Map(events.filter(e=>e.type==='tool/call').map(e=>[e.data.callId,e.data]));
  return events.some(e=>e.type==='tool/result'&&(!since||e.time>=since)&&(e.data.message?.content??[]).some(b=>{
    if(b.type!=='tool-result'||b.isError||calls.get(b.toolCallId)?.name!=='read_image')return false;
    const contents=b.content??[];
    const actual=/<path>(.*?)<\/path>/s.exec(contents.filter(c=>c.type==='text').map(c=>c.text).join('\n'))?.[1];
    return !!actual&&resolve(actual)===resolve(path)&&contents.some(c=>c.type==='image'&&c.attachment?.attachmentId);
  }));
}
export function createMediaTool({store,fs,attachments}){
  return {
    name:'director_show_media',
    description:'Display local images/videos or create a complete shot/ref review card. A proposal includes shots with actors/setting/framing/action, exact dialogue, continuity and duration. For new cards set clip_references:[{clip_id,reference_numbers}] for every clip in actual Picture connection order, using displayed item numbers. Each shot reference_numbers is a relevance subset, not timed conditioning; all clip Pictures condition the whole clip. For small edits use director_edit_review. Actual local files only: current visible human uploads can be used directly; other external files need read_image first. This displays, never generates or approves. Show the card, briefly summarize and request confirmation of that version; the card already contains the plan. Wait for explicit user confirmation before production.',
    parameters:{type:'object',properties:{title:{type:'string'},proposal:proposalSchema,items:{type:'array',minItems:1,maxItems:12,items:mediaItemSchema}},required:['items'],additionalProperties:false},
    timeoutMs:60000,
    async execute(args,exec){
      const session=exec.agent?.session,cwd=session?.header?.cwd;
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
        if(baseCardId&&entries.filter(e=>e.kind==='proposal').at(-1)?.value.card_id!==baseCardId)throw new MediaError('A newer card appeared during this revision; use the latest card_id.',409);
        const state=proposalState([...entries,{seq:Math.max(0,...events.map(e=>e.seq))+1,kind:'proposal',value}],proposal.version);
        if(state.pending.length)value.proposal={...proposal,pending_references:state.pending.slice(0,12).map(t=>t.slice(0,2000))};
      }
      return value;
    },
    output:{schema:{type:'object'},render(_args,value){return [{type:'text',text:JSON.stringify(value)}];},presentationMeta(_args,value){return value;}}
  };
}

export function createEditReviewTool(mediaTool){
  return {
    name:'director_edit_review',
    description:'Edit the latest shot/ref card using its card_id. Omit version: a fresh label is automatic (reused labels are also replaced). Use the returned version for confirmation. add appends path + responsibility to shot_ids; replace swaps reference_number for path + responsibility; remove deletes reference_number; shots patches text/roles only. Use visible current uploads directly; otherwise read_image first. A costume change includes the new responsibility, reference_changes narrowing an old Actor + Costume role to Actor only, and shot_changes replacing conflicting wardrobe text while preserving action/dialogue/timing. All changes are saved in one card. The returned card is authoritative and still needs user confirmation; summarize its actual changes and stop.',
    parameters:{type:'object',properties:{
      base_card_id:revisionSchema.properties.base_card_id,version:revisionSchema.properties.version,
      operation:{type:'string',enum:['add','replace','remove','shots']},
      reference_number:{type:'integer',minimum:1,maximum:12,description:'Card index to replace/remove; omit for add/shots.'},
      path:{type:'string',description:'REQUIRED for add or replace: exact path of the new inspected image.'},
      label:{type:'string'},responsibility:{type:'string',description:'For add/replace: the subject and visual fact controlled by this reference, e.g. Costume for Mia only; not actor identity.'},
      shot_ids:{type:'array',items:{type:'string'},minItems:1,description:'REQUIRED for add: existing shots receiving the appended image.'},
      reference_changes:revisionSchema.properties.reference_changes,
      shot_changes:{...revisionSchema.properties.shot_changes,description:'Affected shot fields only. When the new reference changes an explicit costume, replace the old wardrobe wording here, preserving action, dialogue and duration. Omitted fields remain exactly unchanged.'}
    },required:['base_card_id','operation'],additionalProperties:false},
    timeoutMs:60000,
    async execute(args,exec){
      if(!['add','replace','remove','shots'].includes(args?.operation))throw new MediaError('Use operation add, replace, remove or shots.');
      const {operation,base_card_id,version,reference_number,path,label,responsibility,shot_ids,shot_changes,reference_changes}=args;
      if(operation==='shots'&&[path,label,responsibility,reference_number,shot_ids].some(x=>x!==undefined))throw new MediaError('Operation shots accepts only shot_changes, not image/path/reference arguments.');
      const item=[path,label,responsibility].some(x=>x!==undefined)?{path,label,responsibility}:undefined;
      return mediaTool.execute({revision:{base_card_id,version,shot_changes,reference_changes,...operation==='shots'?{}:{change:{op:operation,reference_number,item,shot_ids}}}},exec);
    },
    output:mediaTool.output
  };
}

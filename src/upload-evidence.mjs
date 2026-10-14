import {resolve} from 'node:path';

// Availability of actual human-uploaded pixels in the CURRENT model context.
// Callers must verify returned sha256 against the file bytes they consume.
// Durable history alone, names, and agent-written claims are not evidence.
export function currentUploadEvidence(session,path,{attachments,fs}={}){
  if(!Array.isArray(session?.surface?.nodes)||typeof session.snapshotEvents!=='function')return;
  const events=session.snapshotEvents(),active=new Set(session.surface.nodes);
  for(const event of events){
    if(event.type!=='user/message'||event.data?.source?.kind!=='user'||!active.has(event.seq))continue;
    if(!events.some(next=>next.seq>event.seq&&active.has(next.seq)&&next.type==='assistant/message'&&next.data.message?.source?.kind==='model'))continue;
    for(const block of event.data.content??[]){
      const ref=block.attachment;
      if(block.type!=='image'||!/^sha256:[a-f0-9]{64}$/.test(ref?.attachmentId??''))continue;
      try{
        const host=attachments?.imageHostPath?.(ref),mapped=host&&fs?.processPathFromHostPath?.(host);
        if(mapped&&resolve(mapped)===resolve(path))return {sha256:ref.attachmentId.slice(7),upload_seq:event.seq};
      }catch{/* Unmapped or unavailable native attachments need read_image. */}
    }
  }
}

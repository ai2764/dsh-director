import {validateProposal} from '../shot-proposal.mjs';
const mimes={image:new Set(['image/png','image/jpeg','image/webp','image/gif']),video:new Set(['video/mp4','video/webm']),audio:new Set(['audio/flac','audio/mpeg','audio/wav'])};
const failure=(code,message)=>({kind:'error',code,message});
export function parseMediaResult(block,sessionId){
  if(block?.kind!=='tool-result')return {kind:'running'};
  const text=(Array.isArray(block.content)?block.content:[]).filter(c=>c?.type==='text'&&typeof c.text==='string').map(c=>c.text).join('\n');
  if(block.isError)return failure('tool_error',text.trim()||'The media tool failed without an error description. Inspect its call details.');
  let value;
  try{value=JSON.parse(text);}catch{return failure('invalid_json','The saved media result could not be read as JSON. Its tool result may be incomplete.');}
  if(!value||value.kind!=='director-media'||value.version!==1||typeof value.session_id!=='string'||!Array.isArray(value.items)||!value.items.length||value.items.length>12||value.title!==undefined&&typeof value.title!=='string')return failure('invalid_result','The saved media result has an unsupported or invalid format.');
  if(!sessionId)return failure('session_unavailable','The current session is not available yet. Reopen this conversation to load its media.');
  if(value.session_id!==sessionId)return failure('session_mismatch','This media result belongs to another session. Open the conversation where it was displayed.');
  for(const item of value.items){
    if(!item||typeof item.id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(item.id)||typeof item.type!=='string'||!Object.hasOwn(mimes,item.type)||!mimes[item.type].has(item.mime)||typeof item.filename!=='string'||item.url!==`/director-media/${item.id}?session=${encodeURIComponent(sessionId)}`||['label','caption','shot_id','responsibility'].some(key=>item[key]!==undefined&&typeof item[key]!=='string'))return failure('invalid_media','The saved media metadata is invalid or contains an unsafe media URL.');
  }
  let proposal,proposalWarning;
  if(value.proposal!==undefined){
    try{proposal=validateProposal(value.proposal,value.items.length,value.items);}
    catch{proposalWarning='The saved shot proposal is invalid and cannot be confirmed. Its media is still available; present a corrected proposal before generation.';}
  }
  const card_id=typeof value.card_id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value.card_id)?value.card_id:undefined;
  return {kind:'ready',title:value.title??'Director media',items:value.items,...card_id?{card_id}:{},...proposal?{proposal}:{},...proposalWarning?{proposalWarning}:{}};
}

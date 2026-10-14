import {validateProposal} from '../shot-proposal.mjs';
const mimes={image:new Set(['image/png','image/jpeg','image/webp','image/gif']),video:new Set(['video/mp4','video/webm'])};
export function parseMediaResult(block,sessionId){
  if(block?.kind!=='tool-result')return {kind:'running'};
  if(block.isError)return {kind:'error',message:'Media could not be displayed. Inspect the tool error and retry with the actual local file.'};
  try{
    const text=(block.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
    const value=JSON.parse(text);
    if(value.kind!=='director-media'||value.version!==1||!sessionId||value.session_id!==sessionId||!Array.isArray(value.items)||!value.items.length||value.items.length>12)throw new Error();
    if(value.title!==undefined&&typeof value.title!=='string')throw new Error();
    for(const item of value.items){
      if(typeof item.id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(item.id)||!mimes[item.type]?.has(item.mime)||typeof item.filename!=='string'||item.url!==`/director-media/${item.id}?session=${encodeURIComponent(sessionId)}`)throw new Error();
      for(const key of ['label','caption','shot_id','responsibility'])if(item[key]!==undefined&&typeof item[key]!=='string')throw new Error();
    }
    const proposal=value.proposal===undefined?undefined:validateProposal(value.proposal,value.items.length,value.items);
    return {kind:'ready',title:typeof value.title==='string'?value.title:'Director media',items:value.items,...proposal?{proposal}:{}};
  }catch{return {kind:'error',message:'Media result is unavailable or belongs to another session. Ask the agent to display the actual file again.'};}
}

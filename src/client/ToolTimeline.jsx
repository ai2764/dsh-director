import React,{useEffect,useRef} from 'react';
import {MediaCard} from './MediaCard.jsx';
import {parseMediaResult} from './media-result.mjs';

const mediaTools=new Set(['director_show_media','director_edit_review']);
const directorTools=new Set(['director_assets',...mediaTools,'director_stage_images','submit_comfy_job','submit_comfy_video']);
const DirectorNode=()=> <span className="dsh-director-node dsh-director-node-director" role="img" aria-label="Director tool" title="Director tool"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M2 6.5h12v6.25A1.25 1.25 0 0 1 12.75 14h-9.5A1.25 1.25 0 0 1 2 12.75z"/><path d="m1.5 3.5 11.7-2 .5 3-11.7 2zM5 3l2 2.7M9 2.3l2 2.7"/></svg></span>;

function shellFailure(block,name,args,text){
  const shell=block.kind==='tool-result'&&['bash','pwsh'].includes(name)&&typeof args.description==='string'&&args.description.trim()&&!args.run_in_background&&block.content?.length===1;
  const marker=shell?(/\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)||/\n\[exit code: (\d+)\]$/.exec(text)):null;
  return marker&&(marker[0].includes('killed by signal:')||Number(marker[1])!==0)?marker:null;
}
function canGroup(block){
  if(block.kind!=='tool-result'||block.isError||mediaTools.has(block.call?.name))return false;
  let args={};try{args=JSON.parse(block.call?.argsRaw||'{}')??{};}catch{}
  const text=(block.content??[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
  return !shellFailure(block,block.call?.name,args,text)&&(block.subCalls??[]).every(canGroup);
}
const chatSnapshot=snapshot=>snapshot;
const turnOf=node=>node.location?.turn?.turn;
const transparent=node=>node?.visibility==='hidden'||(node?.kind==='assistant-step'&&node.data.status==='settled'&&(node.data.blocks??[]).every(b=>b.kind==='tool-call'));
function historyGroup(snapshot,node){
  if(!snapshot||!node.key||!canGroup(node.data.root))return null;
  const {order,nodes}=snapshot,index=order.indexOf(node.key);
  if(index<0)return null;
  const candidate=n=>n?.kind==='tool-call'&&turnOf(n)===turnOf(node)&&canGroup(n.data.root);
  let start=index;
  for(let i=index-1;i>=0;i--){const previous=nodes.get(order[i]);if(transparent(previous))continue;if(!candidate(previous))break;start=i;}
  const members=[];
  for(let i=start;i<order.length;i++){const next=nodes.get(order[i]);if(transparent(next))continue;if(!candidate(next))break;members.push(next);}
  return members.length?members:null;
}
const callCount=block=>1+(block.subCalls??[]).reduce((total,child)=>total+callCount(child),0);

// A running nested tool, rather than its coordinating parent, is current.
// Parallel leaf calls may all be current; never pretend only one is executing.
function currentCalls(block,ids){
  let childRunning=false;
  for(const child of block.subCalls??[])if(currentCalls(child,ids))childRunning=true;
  const running=block.kind!=='tool-result';
  if(running&&!childRunning)ids.add(block.callId);
  return running||childRunning;
}

function CallRow({block,depth=0,sessionId,inspectCall,renderMessageImages,activeCallIds,useChat,turnClosed}){
  const settled=block.kind==='tool-result';
  const details=useRef(null),active=activeCallIds.has(block.callId);
  // Reset only on lifecycle/current-call changes. Manual history expansion
  // survives ordinary rerenders, and a running -> result update always folds.
  useEffect(()=>{if(details.current)details.current.open=active;},[active,settled,block.callId]);
  const head=settled?block.call:block;
  const hasArguments=typeof head?.argsRaw==='string'&&head.argsRaw.trim().length>0;
  const name=head?.name||block.callId;
  const text=(block.content??[]).filter(item=>item.type==='text').map(item=>item.text).join('\n');
  const images=(block.content??[]).filter(item=>item.type==='image'&&item.attachment).map(item=>({attachment:item.attachment}));
  const duration=settled&&Number.isFinite(block.callTime)&&Number.isFinite(block.time)?Math.max(0,(block.time-block.callTime)/1000):null;
  let hint='',args={};
  try{args=JSON.parse(head?.argsRaw||'{}')??{};hint=[args.file_path,args.path,args.command,args.cmd,args.workflow_path].find(v=>typeof v==='string')||'';}catch{}
  // Match Harness foreground-shell status markers, not arbitrary text examples
  // or background/persistent shell snapshots without a single process status.
  const marker=shellFailure(block,name,args,text),shellFailed=Boolean(marker);
  const state=settled?(block.isError||shellFailed?'error':'returned'):'running';
  const visibleMedia=mediaTools.has(name);
  const standaloneMedia=visibleMedia&&parseMediaResult(block,sessionId).kind==='ready';
  const director=directorTools.has(name);
  return <>
    <div className={`dsh-director-tool-row dsh-director-tool-${state}`} style={{'--director-depth':Math.min(depth,8)}} data-chat-call-id={block.callId} data-chat-anchor-key={`call:${block.callId}`}>
      {!standaloneMedia&&<details ref={details}>
        <summary>{director?<DirectorNode/>:<span className="dsh-director-node" aria-hidden="true"/>}<span className="dsh-director-tool-name">{name}</span><span className="dsh-director-tool-hint">{hint.split('\n')[0].slice(0,180)}</span><span className="dsh-director-tool-state" role={state==='running'?'status':undefined}>{state==='running'?'Running':state==='error'?'Failed':'Returned'}</span>{duration!==null&&<span className="dsh-director-tool-duration">{duration.toFixed(1)}s</span>}</summary>
        <div className="dsh-director-tool-log"><h4>Arguments</h4>{hasArguments?<pre>{head.argsRaw}</pre>:settled?<p>Call arguments have not been loaded. {inspectCall?'Open call details or load earlier messages.':'Load earlier messages to view them.'}</p>:<p role="status">Preparing tool arguments…</p>}{settled&&<><h4>Results</h4><pre>{text||JSON.stringify(block.content??[],null,2)}</pre>{(block.content??[]).some(item=>item.type!=='text')&&<><h4>Full results (including attachments)</h4><pre>{JSON.stringify(block.content,null,2)}</pre></>}</>}{inspectCall&&<button onClick={()=>inspectCall(block.callId)}>View call details</button>}</div>
        {!visibleMedia&&images.length>0&&renderMessageImages&&<div className="dsh-director-tool-images">{renderMessageImages({images,align:'start'})}</div>}
      </details>}
      {state==='error'&&<p className="dsh-director-tool-error" role="alert">{shellFailed?`${marker[0].trim()}\n${text.slice(0,400)}`:text.slice(0,400)||block.error?.code||'Tool call failed. Expand for details.'}</p>}
      {visibleMedia&&<MediaCard block={block} sessionId={sessionId} useChat={useChat} leadingIcon={standaloneMedia?<DirectorNode/>:null} turnClosed={turnClosed}/>}
    </div>
    {(block.subCalls??[]).map(child=><CallRow key={child.callId} block={child} depth={depth+1} sessionId={sessionId} inspectCall={inspectCall} renderMessageImages={renderMessageImages} activeCallIds={activeCallIds} useChat={useChat} turnClosed={turnClosed}/>)}
  </>;
}
export function ToolTimeline({node,sessionId,inspectCall,renderMessageImages,useChat}){
  const snapshot=useChat?.(chatSnapshot),group=historyGroup(snapshot,node);
  if(group){
    if(group[0].key!==node.key)return <span hidden data-director-history-member=""/>;
    const count=group.reduce((total,member)=>total+callCount(member.data.root),0);
    return <section className="dsh-director-timeline" aria-label="Tool execution nodes"><details className="dsh-director-tool-history" key={`${sessionId}:${node.key}`}><summary>Completed · {count} tool {count===1?'call':'calls'}</summary><div className="dsh-director-tool-history-rows">{group.map(member=><CallRow key={member.key} block={member.data.root} sessionId={sessionId} inspectCall={inspectCall} renderMessageImages={renderMessageImages} activeCallIds={new Set()}/>)}</div></details></section>;
  }
  const activeCallIds=new Set();currentCalls(node.data.root,activeCallIds);
  return <section className="dsh-director-timeline" aria-label="Tool execution nodes"><CallRow block={node.data.root} sessionId={sessionId} inspectCall={inspectCall} renderMessageImages={renderMessageImages} activeCallIds={activeCallIds} useChat={useChat} turnClosed={node.location?.turn?.status!=='open'}/></section>;
}

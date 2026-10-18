import React,{useCallback,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {protectSend} from './send-protection.mjs';

const unknown={phase:'unknown',blocked:false,llm:'unknown'};
export async function readLiveStatus(){
  const response=await fetch('/director-gpu-status',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('GPU status unavailable');return response.json();
}
async function releaseLiveMemory(){
  const response=await fetch('/director-gpu-release',{method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
  const result=await response.json();
  if(!response.ok)throw Error(result?.error||'ComfyUI memory release failed');
  return result;
}
export function GpuStatus({shell,connection,readStatus=readLiveStatus,releaseMemory=releaseLiveMemory,pollMs=2000}){
  const subscribe=useCallback(listener=>connection.state.subscribe(listener),[connection]);
  const snapshot=useCallback(()=>connection.state.getSnapshot(),[connection]);
  const connectionState=useSyncExternalStore(subscribe,snapshot,snapshot);
  const [status,setStatus]=useState(unknown),anchor=useRef(null),alive=useRef(false),lastStatus=useRef(unknown);
  const [recovering,setRecovering]=useState(false),[recoveryError,setRecoveryError]=useState('');
  const check=useCallback(async()=>{
    const startedConnected=connection.state.getSnapshot()==='connected';
    const unavailable=()=>({...unknown,blocked:lastStatus.current.blocked});
    let next;try{next=await readStatus();if(!['ready','generating','releasing_vram','unknown'].includes(next?.phase)||typeof next.blocked!=='boolean')next=unavailable();}catch{next=unavailable();}
    lastStatus.current=next;
    if(alive.current)setStatus(next);
    const connection_blocked=!startedConnected||connection.state.getSnapshot()!=='connected';
    return {...next,blocked:next.blocked||connection_blocked,connection_blocked};
  },[readStatus,connection]);
  const blocked=status.blocked||connectionState!=='connected';
  const canRecover=status.phase==='releasing_vram'&&status.llm==='unloaded'&&connectionState==='connected';
  const recover=useCallback(async()=>{
    setRecovering(true);setRecoveryError('');
    try{await releaseMemory();await check();}
    catch(error){if(alive.current)setRecoveryError(error.message||'Memory release failed');}
    finally{if(alive.current)setRecovering(false);}
  },[releaseMemory,check]);
  useLayoutEffect(()=>{
    alive.current=true;
    const remove=shell&&typeof shell.submit==='function'?protectSend(shell,{check,onBlocked:next=>{if(alive.current&&!next?.connection_blocked)setStatus(next??unknown);}}):undefined;
    let timer,stopped=false;const poll=async()=>{await check();if(!stopped)timer=setTimeout(poll,pollMs);};void poll();
    return ()=>{alive.current=false;stopped=true;clearTimeout(timer);remove?.();};
  },[shell,check,pollMs]);
  useLayoutEffect(()=>{
    const seat=anchor.current?.closest('[data-composer-seat]');if(!seat)return;
    // Native Send has this arrow; Stop uses a rect. Never disable the editor,
    // attachment controls or Stop, and never use translated labels/classes.
    const marked=new Map();
    const mark=()=>{
      for(const path of seat.querySelectorAll('button svg path[d^="M8.3125 0.980183"]')){
        const button=path.closest('button');if(!marked.has(button))marked.set(button,button.getAttribute('aria-disabled'));
        if(blocked){button.setAttribute('aria-disabled','true');button.dataset.directorSendPaused='';}
      }
    };
    if(blocked)mark();
    const Observer=seat.ownerDocument.defaultView.MutationObserver,observer=new Observer(mark);
    if(blocked)observer.observe(seat,{subtree:true,childList:true});
    return ()=>{observer.disconnect();for(const [button,original] of marked){delete button.dataset.directorSendPaused;if(original===null)button.removeAttribute('aria-disabled');else button.setAttribute('aria-disabled',original);}};
  },[blocked]);
  const title=status.phase==='generating'?`${status.llm==='unloaded'?'LLM unloaded':status.llm==='loaded'?'LLM loaded':'Checking LLM'} · ComfyUI generating`:
    status.phase==='releasing_vram'?'Generation finished · Releasing VRAM':status.phase==='ready'?`GPU ready${!blocked?' · You can send messages':''}`:status.blocked?'Checking GPU handoff · Sending paused':'GPU status unavailable · Chat available';
  const connectionTitle=connectionState==='connected'?'Connected':connectionState==='connecting'?'Reconnecting · Restoring live updates':connectionState==='disconnected'?'Disconnected · Messages may be out of date':'Checking connection · Sending paused';
  return <div ref={anchor} className={`dsh-director-gpu dsh-director-gpu-${status.phase}`} role="status" aria-live="polite" data-gpu-phase={status.phase}>
    <span className="dsh-director-gpu-light" aria-hidden="true"/><div><span>{title}</span><small data-connection-state={connectionState??'unknown'}>{connectionTitle}</small>{connectionState!=='connected'?<small>You can keep editing. Sending resumes when connected.</small>:status.blocked&&<small>You can write a draft. Sending resumes after verified GPU release.</small>}{status.warning&&<small className="dsh-director-gpu-warning">{status.warning}</small>}{canRecover&&<button type="button" data-action="release-comfy-vram" disabled={recovering} onClick={recover}>{recovering?'Releasing…':'Release ComfyUI memory'}</button>}{recoveryError&&<small className="dsh-director-gpu-warning">{recoveryError}</small>}</div>
  </div>;
}

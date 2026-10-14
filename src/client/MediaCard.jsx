import React,{useRef,useState} from 'react';
import {parseMediaResult} from './media-result.mjs';
import {MediaDialog} from './MediaDialog.jsx';
import {entriesFromChat,proposalState} from '../proposal-state.mjs';
import {clipReferenceLists} from '../shot-proposal.mjs';
const chatSnapshot=s=>s;
const statusLabels={confirmed:'Confirmed',superseded:'Superseded',invalid_references:'Invalid references',references_pending:'References pending',changes_requested:'Changes requested',unverified:'Confirmation unverified',awaiting_confirmation:'Awaiting confirmation'};

function MediaItem({item,onEnlarge}){
  const player=useRef(null);const [failed,setFailed]=useState(false);
  const enlarge=event=>{player.current?.pause();onEnlarge({item,inline:player.current,opener:event.currentTarget,startTime:player.current?.currentTime||0});};
  return <figure className={`dsh-director-item dsh-director-${item.type}`}>
    {item.type==='video'?<video ref={player} src={item.url} controls playsInline preload="metadata" onError={()=>setFailed(true)}/>:
      <button className="dsh-director-image-button" data-action="enlarge" onClick={enlarge} aria-label={`Enlarge ${item.label||item.filename}`}><img loading="lazy" src={item.url} alt={item.label||item.filename} onError={()=>setFailed(true)}/></button>}
    <figcaption><strong>{item.label||item.filename}</strong>
      {item.label&&item.label!==item.filename&&<span>{item.filename}</span>}
      {item.responsibility&&<span>Role: {item.responsibility}</span>}
      {item.caption&&<span>{item.caption}</span>}
      {item.shot_id&&<span>{item.shot_id}</span>}
      <div className="dsh-director-actions">{item.type==='video'&&<button data-action="enlarge" onClick={enlarge}>Enlarge</button>}<a href={item.url} download={item.filename}>Download</a></div>
    </figcaption>
    {failed&&<p role="alert">Media unavailable or unsupported. Use Download, or ask the agent to display it again.</p>}
  </figure>;
}
export function MediaCard({block,sessionId,useChat}){
  const snapshot=useChat?.(chatSnapshot);
  const result=parseMediaResult(block,sessionId),[selected,setSelected]=useState(null);
  if(result.kind==='running')return <div className="dsh-director-card" role="status">Preparing media preview…</div>;
  if(result.kind==='error')return <div className="dsh-director-card" role="alert">{result.message}</div>;
  const close=time=>{if(selected.inline&&Number.isFinite(time))try{selected.inline.currentTime=time;}catch{}setSelected(null);};
  const proposal=result.proposal;
  const review=proposal?(snapshot?proposalState(entriesFromChat(snapshot),proposal.version,{seq:block.seq,callId:block.callId}):{status:proposal.pending_references?.length?'references_pending':'awaiting_confirmation',pending:proposal.pending_references??[]}):null;
  const clips=proposal?clipReferenceLists(proposal):[];
  const shotBound=new Set(proposal?.shots.flatMap(shot=>shot.reference_numbers));
  const bound=new Set(clips.flatMap(clip=>clip.reference_numbers));
  return <section className="dsh-director-card" aria-label={result.title}><h3>{result.title}</h3>
    {proposal?<div className="dsh-director-proposal" data-proposal-version={proposal.version} data-proposal-status={review.status}>
      <header className="dsh-director-review-header"><strong>Shot &amp; reference review</strong><span>{proposal.version}</span><span>{new Set(proposal.shots.map(shot=>shot.clip_id)).size} clip{new Set(proposal.shots.map(shot=>shot.clip_id)).size===1?'':'s'} / {proposal.shots.length} shot{proposal.shots.length===1?'':'s'}</span><span className="dsh-director-awaiting">{statusLabels[review.status]}</span></header>
      {review.pending.length>0&&<aside className="dsh-director-pending-refs"><h4>Pending reference changes</h4><ul>{review.pending.map((label,i)=><li key={i}>{label}</li>)}</ul></aside>}
      {proposal.clip_references&&<aside><p>All Pictures condition the whole clip. Shot references below describe relevance, not timed inputs.</p>{clips.map(clip=><section data-director-clip-order={clip.clip_id} key={clip.clip_id}><h4>{clip.clip_id} · Picture connection order</h4><ol>{clip.reference_numbers.map((number,i)=><li key={number}>Picture {i+1} → Reference #{number}: {result.items[number-1].label||result.items[number-1].filename}</li>)}</ol></section>)}</aside>}
      {proposal.shots.map(shot=><article className="dsh-director-shot" data-shot-id={shot.shot_id} key={shot.shot_id}>
        <header><strong>{shot.shot_id}</strong><span>{shot.clip_id}</span><span>{shot.duration_seconds} s</span></header>
        <p className="dsh-director-shot-content">{shot.content}</p>
        <dl>{[['Dialogue',shot.dialogue||'No dialogue'],['Incoming state',shot.incoming_state],['Ending state',shot.ending_state],['Transition',shot.transition]].filter(([,text])=>text!==undefined).map(([label,text])=><React.Fragment key={label}><dt>{label}</dt><dd>{text}</dd></React.Fragment>)}</dl>
        {shot.reference_numbers.length?<div className="dsh-director-gallery dsh-director-shot-refs">{shot.reference_numbers.map(number=><div className="dsh-director-bound-ref" key={number}><span>Reference #{number}{proposal.clip_references&&` · Picture ${clips.find(c=>c.clip_id===shot.clip_id).reference_numbers.indexOf(number)+1}`}</span><MediaItem item={result.items[number-1]} onEnlarge={setSelected}/></div>)}</div>:<p className="dsh-director-missing-ref">{proposal.clip_references?(clips.find(c=>c.clip_id===shot.clip_id).reference_numbers.length?'No shot-specific references assigned; clip-wide inputs still apply.':'No references are connected to this clip. Confirm whether any should be added.'):'No references are bound to this shot. Confirm whether any should be added.'}</p>}
      </article>)}
      {result.items.some((_,i)=>bound.has(i+1)&&!shotBound.has(i+1))&&<aside data-director-clip-wide><h4>Clip-wide references (no shot-specific assignment)</h4><div className="dsh-director-gallery">{result.items.map((item,i)=>bound.has(i+1)&&!shotBound.has(i+1)&&<MediaItem key={item.id} item={item} onEnlarge={setSelected}/>)}</div></aside>}
      {result.items.some((_,i)=>!bound.has(i+1))&&<aside><h4>Other media (not bound to these shots)</h4><div className="dsh-director-gallery">{result.items.map((item,i)=>!bound.has(i+1)&&<MediaItem key={item.id} item={item} onEnlarge={setSelected}/>)}</div></aside>}
      <p className="dsh-director-confirm-note">{review.unverifiable?.length?'A reference edit has an invalid saved baseline. Its original image bindings cannot be verified; another full card or confirmation cannot resolve it. Reconcile the intended references with the user before production.':review.status==='references_pending'?'This reference list has pending changes and cannot be approved for video generation. Apply the requested add, replace or remove operation to the actual bound images, show a new complete version, then confirm that proposal.':review.status==='confirmed'?`Confirmed in chat: ${proposal.version}. Video submission must match these actual references.`:review.status==='superseded'?`This version was superseded by ${review.latestVersion}. Review and confirm the latest complete proposal instead.`:<>Confirm {proposal.version} in chat, or describe changes to shots and references. This card presents the plan; it does not approve generation.</>}</p>
    </div>:<div className="dsh-director-gallery">{result.items.map(item=><MediaItem key={item.id} item={item} onEnlarge={setSelected}/>)}</div>}
    {selected&&<MediaDialog item={selected.item} startTime={selected.startTime} opener={selected.opener} onClose={close}/>}</section>;
}

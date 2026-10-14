import React,{useEffect,useRef,useState} from 'react';

export function MediaDialog({item,startTime=0,opener,onClose}){
  const dialog=useRef(null),media=useRef(null),closeButton=useRef(null);const [failed,setFailed]=useState(false);
  const close=()=>{media.current?.pause?.();onClose(media.current?.currentTime);};
  useEffect(()=>{
    const element=dialog.current,player=media.current;
    element.showModal();closeButton.current?.focus();
    return ()=>{player?.pause?.();element.close();opener?.focus();};
  },[]);
  return <dialog className="dsh-director-dialog" ref={dialog} aria-label={item.label||item.filename}
    onCancel={event=>{event.preventDefault();close();}}
    onClick={event=>{if(event.target===dialog.current){const r=dialog.current.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}}}>
    <header><span>{item.label||item.filename}</span><button ref={closeButton} data-action="close" onClick={close}>Close</button></header>
    <div className="dsh-director-stage">
      {item.type==='video'?<video ref={media} src={item.url} controls playsInline preload="metadata" onError={()=>setFailed(true)} onLoadedMetadata={()=>{if(startTime&&Number.isFinite(startTime))media.current.currentTime=startTime;}}/>:
        <img src={item.url} alt={item.label||item.filename} onError={()=>setFailed(true)}/>}
    </div>
    {failed&&<p role="alert">Cannot load this media or codec. Try opening the file, or ask the agent to display it again.</p>}
    <footer><span>{item.caption||item.filename}</span><a href={item.url} download={item.filename}>Download</a><a href={item.url} target="_blank" rel="noopener noreferrer">Open file</a></footer>
  </dialog>;
}

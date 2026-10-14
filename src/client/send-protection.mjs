// Guard the native submit entry before it commits/clears text or attachments.
// UI-only protection: other clients and direct API calls are not intercepted.
const guards=new WeakMap();
export function protectSend(shell,owner){
  let entry=guards.get(shell);
  if(!entry){
    entry={native:shell.submit,owners:new Set(),checking:false};
    entry.guarded=function(...args){
      if(entry.owners.size===0)return entry.native.apply(shell,args);
      if(entry.checking)return;
      entry.checking=true;
      const current=[...entry.owners].at(-1);
      void (async()=>{
        try{
          const status=await current.check();if(!entry.owners.has(current))return;
          if(status?.blocked===false&&status.phase==='ready')entry.native.apply(shell,args);
          else for(const listener of entry.owners)listener.onBlocked(status);
        }catch{for(const listener of entry.owners)listener.onBlocked({phase:'unknown',blocked:true,llm:'unknown'});}
        finally{entry.checking=false;}
      })();
    };
    guards.set(shell,entry);shell.submit=entry.guarded;
  }
  entry.owners.add(owner);
  return ()=>{
    entry.owners.delete(owner);
    if(entry.owners.size===0){if(shell.submit===entry.guarded)shell.submit=entry.native;guards.delete(shell);}
  };
}

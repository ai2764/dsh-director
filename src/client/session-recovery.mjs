// Mobile browsers can freeze an apparently connected WebSocket without an
// offline event. Replace its generation on wake; native follow streams then
// obtain a fresh opening baseline. Never reload the page or touch submissions.
export function watchSessionWake(connection,browser=window,page=document){
  let timer,lastWake=-Infinity,disposed=false;
  const cancel=()=>{clearTimeout(timer);timer=undefined;};
  const available=()=>page.visibilityState!=='hidden'&&browser.navigator.onLine!==false;
  const request=()=>{
    if(disposed||!available()||timer!==undefined||Date.now()-lastWake<2000)return;
    const initialGeneration=connection.generation.getSnapshot()?.id;
    timer=setTimeout(()=>{
      timer=undefined;
      if(disposed||!available())return;
      lastWake=Date.now();
      const currentGeneration=connection.generation.getSnapshot()?.id;
      // Native online/heartbeat recovery may already have supplied a fresh
      // generation during the debounce window. Do not replace it again.
      if(currentGeneration!==undefined&&currentGeneration!==initialGeneration)return;
      // The native recovery loop already owns an in-flight attempt/backoff.
      if(connection.state.getSnapshot()==='connecting')return;
      try{connection.reconnect();}catch(error){console.warn('[dsh-director] foreground connection recovery failed',error);}
    },100);
  };
  const visibility=()=>{
    if(page.visibilityState==='hidden'){cancel();lastWake=-Infinity;}
    else request();
  };
  const pageshow=event=>{if(event.persisted)request();};
  const offline=()=>{cancel();lastWake=-Infinity;};
  page.addEventListener('visibilitychange',visibility);
  browser.addEventListener('focus',request);
  browser.addEventListener('pageshow',pageshow);
  browser.addEventListener('online',request);
  browser.addEventListener('offline',offline);
  return()=>{
    disposed=true;cancel();page.removeEventListener('visibilitychange',visibility);
    browser.removeEventListener('focus',request);browser.removeEventListener('pageshow',pageshow);
    browser.removeEventListener('online',request);browser.removeEventListener('offline',offline);
  };
}

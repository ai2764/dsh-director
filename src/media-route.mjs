import {pipeline} from 'node:stream/promises';
import {MediaError} from './media-store.mjs';

export function parseSingleRange(header,size){
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!match||!size||!match[1]&&!match[2])throw new MediaError('Invalid range.',416);
  let start,end;
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)throw new MediaError('Invalid range.',416);start=Math.max(0,size-suffix);end=size-1;}
  else{start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)throw new MediaError('Invalid range.',416);
  return {start,end:Math.min(end,size-1)};
}
export function createMediaHandler({store,requestRejection,controllers=new Set()}){
  return async(req,res)=>{
    let media;const controller=new AbortController();controllers.add(controller);
    const abort=()=>controller.abort();res.once('close',abort);
    try{
      const rejection=requestRejection(req);
      if(rejection!==undefined){res.writeHead(rejection);res.end();return;}
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
      const url=new URL(req.url,'http://localhost');
      const id=/^\/director-media\/([A-Za-z0-9_-]{43})$/.exec(url.pathname)?.[1];
      const sessions=url.searchParams.getAll('session');
      if(!id||sessions.length!==1||[...url.searchParams.keys()].some(k=>k!=='session'))throw new MediaError('Media not found.',404);
      media=await store.openVerified(id,sessions[0],controller.signal);
      let range;
      try{range=req.headers.range?parseSingleRange(req.headers.range,media.size):{start:0,end:media.size-1};}
      catch(error){res.writeHead(416,{'Content-Range':`bytes */${media.size}`});res.end();return;}
      const headers={'Content-Type':media.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store',
        'Referrer-Policy':'no-referrer','Accept-Ranges':'bytes','Content-Length':String(range.end-range.start+1),
        'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(media.filename)}`};
      if(req.headers.range)headers['Content-Range']=`bytes ${range.start}-${range.end}/${media.size}`;
      res.writeHead(req.headers.range?206:200,headers);
      if(req.method==='HEAD'){res.end();return;}
      await pipeline(media.handle.createReadStream({...range,autoClose:false}),res,{signal:controller.signal});
    }catch(error){
      if(!res.headersSent&&!res.destroyed){res.writeHead(error.status??500,{'Content-Type':'text/plain','X-Content-Type-Options':'nosniff'});res.end(error instanceof MediaError?error.message:'Media unavailable.');}
      else if(!res.destroyed)res.destroy();
    }finally{res.removeListener('close',abort);controllers.delete(controller);await media?.handle.close().catch(()=>{});}
  };
}
export function registerMediaRoute(ctx,store){
  const controllers=new Set();
  const unregister=ctx.webServer.register({kind:'prefix',path:'/director-media',handler:createMediaHandler({store,controllers,requestRejection:req=>ctx.connection.requestRejection(req)})});
  return ()=>{unregister();for(const controller of controllers)controller.abort();};
}

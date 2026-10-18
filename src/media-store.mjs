import {randomBytes,createHash} from 'node:crypto';
import {mkdir,open,readFile,rename,realpath,unlink} from 'node:fs/promises';
import {basename,extname,join,resolve} from 'node:path';
import {imageType} from './image-type.mjs';
import {rejectLinkedSource} from './local-source.mjs';

export class MediaError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}
const types={'.jpg':['image','image/jpeg'],'.jpeg':['image','image/jpeg'],'.png':['image','image/png'],'.webp':['image','image/webp'],'.gif':['image','image/gif'],'.mp4':['video','video/mp4'],'.webm':['video','video/webm'],'.flac':['audio','audio/flac'],'.mp3':['audio','audio/mpeg'],'.wav':['audio','audio/wav']};
function identify(path,bytes){
  const ext=extname(path).toLowerCase(), type=types[ext];
  if(!ext){const detected=imageType(bytes);if(detected)return ['image',detected.mime,detected.extension];}
  if(!type) throw new MediaError('Unsupported media type. Use PNG/JPEG/WebP/GIF/MP4/WebM/FLAC/MP3/WAV.');
  const ascii=(a,b)=>bytes.toString('ascii',a,b);
  const good=ext==='.png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):
    ['.jpg','.jpeg'].includes(ext)?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
    ext==='.gif'?['GIF87a','GIF89a'].includes(ascii(0,6)):
    ext==='.webp'?ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP':
    ext==='.mp4'?ascii(4,8)==='ftyp':
    ext==='.webm'?bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex')):
    ext==='.flac'?ascii(0,4)==='fLaC':
    ext==='.mp3'?ascii(0,3)==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0:
    ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE';
  if(!good) throw new MediaError('Media signature does not match its filename.');
  return type;
}
async function hashHandle(handle,signal,copy){
  const hash=createHash('sha256'),buffer=Buffer.alloc(256*1024);let offset=0;
  while(true){
    signal?.throwIfAborted();
    const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);
    if(!bytesRead)break;
    const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);
    if(copy)await copy.write(chunk,0,chunk.length,offset);
    offset+=bytesRead;
  }
  return {sha256:hash.digest('hex'),size:offset};
}
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{43}$/.test(id);
const fileStamp=info=>[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
export function createMediaStore({root,maxBytes=512*1024*1024}){
  root=resolve(root);
  // A snapshot belongs to its registration, not to the current contents at the
  // original path. Cache only successful checks of the opened file's identity
  // and high-resolution modification/change timestamps; a replaced or edited
  // file must be hashed again even when its size and mtime were preserved.
  const verifiedSnapshots=new Map();
  async function lookup(id,sessionId){
    if(!validId(id)||typeof sessionId!=='string')throw new MediaError('Media not found.',404);
    let record;try{record=JSON.parse(await readFile(join(root,id+'.json'),'utf8'));}catch{throw new MediaError('Media not found.',404);}
    if(record.id!==id||record.sessionId!==sessionId)throw new MediaError('Media not found.',404);
    return record;
  }
  async function register({sessionId,path,fs,cwd,signal,externalEvidence=false}){
    signal?.throwIfAborted();
    if(typeof path!=='string'||!path.trim()||/^[a-z]+:\/\//i.test(path))throw new MediaError('Only existing local media files are accepted.');
    if(typeof sessionId!=='string'||!sessionId||!cwd||!fs)throw new MediaError('An authoritative session and filesystem are required.');
    const target=await fs.resolve(path,{cwd,signal}),parent=await fs.resolve(cwd,{cwd,signal});
    const info=await fs.stat(target,signal);
    if(!info||info.type!=='file')throw new MediaError('Source file unavailable.',404);
    const hostPath=fs.processPath(target);
    if(fs.processPathFromHostPath?.(hostPath)!==hostPath)throw new MediaError('Filesystem is not mapped for local host streaming.');
    if(!fs.contains(parent,target)&&!externalEvidence)throw new MediaError('Source is outside the session workspace; inspect the actual uploaded image first.',403);
    const supplied=resolve(cwd,path);
    if(fs.processPathFromHostPath?.(supplied)!==supplied)throw new MediaError('Original source path is not mapped to this host.');
    await rejectLinkedSource(supplied,signal);
    const canonical=await realpath(hostPath), id=randomBytes(32).toString('base64url');
    await mkdir(root,{recursive:true,mode:0o700});
    const temporary=join(root,id+'.part'), snapshot=join(root,id+'.bin');
    let source,copy;
    try{
      source=await open(canonical,'r');const before=await source.stat();
      if(!before.isFile()||before.size===0||before.size>maxBytes)throw new MediaError('Empty, nonregular or oversized media file.');
      const head=Buffer.alloc(16);await source.read(head,0,16,0);
      const [type,mime,extension]=identify(canonical,head);
      copy=await open(temporary,'wx',0o600);
      const digest=await hashHandle(source,signal,copy),after=await source.stat();
      if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||digest.size!==before.size)throw new MediaError('Source changed during registration.',409);
      await copy.sync();await copy.close();copy=undefined;await rename(temporary,snapshot);
      const record={id,sessionId,source:canonical,type,mime,filename:basename(canonical)+(extension||''),...digest};
      const manifest=await open(join(root,id+'.json.part'),'wx',0o600);
      try{await manifest.writeFile(JSON.stringify(record));await manifest.sync();}finally{await manifest.close();}
      await rename(join(root,id+'.json.part'),join(root,id+'.json'));
      return record;
    }catch(error){
      await Promise.all([temporary,snapshot,join(root,id+'.json.part')].map(p=>unlink(p).catch(()=>{})));
      throw error;
    }finally{await source?.close();await copy?.close();}
  }
  async function openSnapshot(record,signal){
    let handle;
    try{
      const snapshot=join(root,record.id+'.bin');
      await rejectLinkedSource(snapshot,signal);
      handle=await open(snapshot,'r');
      const before=await handle.stat({bigint:true}),stamp=fileStamp(before);
      if(!before.isFile()||before.size!==BigInt(record.size))throw new MediaError('Stored media changed.',409);
      const verification=record.sha256+':'+stamp;
      if(verifiedSnapshots.get(record.id)!==verification){
        const saved=await hashHandle(handle,signal),after=await handle.stat({bigint:true});
        if(saved.sha256!==record.sha256||saved.size!==record.size||fileStamp(after)!==stamp)throw new MediaError('Stored media changed.',409);
        verifiedSnapshots.set(record.id,verification);
        if(verifiedSnapshots.size>256)verifiedSnapshots.delete(verifiedSnapshots.keys().next().value);
      }
      return {...record,handle};
    }catch(error){
      verifiedSnapshots.delete(record.id);await handle?.close();
      if(error instanceof MediaError||error.name==='AbortError')throw error;
      throw new MediaError('Stored media unavailable.',404);
    }
  }
  async function openForPlayback(id,sessionId,signal){
    signal?.throwIfAborted();return openSnapshot(await lookup(id,sessionId),signal);
  }
  async function openOriginal(id,sessionId,signal){
    signal?.throwIfAborted();const record=await lookup(id,sessionId);
    let source;
    try{
      if(await realpath(record.source)!==record.source)throw new MediaError('Source changed.',409);
      source=await open(record.source,'r');
      const sourceInfo=await source.stat({bigint:true});
      if(!sourceInfo.isFile()||sourceInfo.size!==BigInt(record.size))throw new MediaError('Source changed.',409);
      const digest=await hashHandle(source,signal),after=await source.stat({bigint:true});
      if(digest.sha256!==record.sha256||fileStamp(after)!==fileStamp(sourceInfo))throw new MediaError('Source changed; display it again as a new media version.',409);
    }catch(error){if(error instanceof MediaError||error.name==='AbortError')throw error;throw new MediaError('Source media unavailable.',404);}
    finally{await source?.close();}
    return openSnapshot(record,signal);
  }
  // Preserve the old strict contract for callers still using openVerified.
  return {register,lookup,openForPlayback,openOriginal,openVerified:openOriginal};
}

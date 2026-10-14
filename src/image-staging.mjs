import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {extname,join,resolve} from 'node:path';
import {imageType} from './image-type.mjs';
import {rejectLinkedSource} from './local-source.mjs';
import {inspectedExternalImage} from './media-tool.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw new Error(`director_stage_images: ${message}`);};
function imageName(value){
  return typeof value==='string'&&value.length<500&&!value.includes('\\')&&!value.startsWith('/')&&
    !value.includes(':')&&!value.split('/').some(p=>!p||p==='.'||p==='..');
}
async function boundedBody(response,maxBytes){
  if(Number(response.headers.get('content-length'))>maxBytes)fail('remote image exceeds the size limit; inspect the ComfyUI endpoint before retrying.');
  const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();fail('remote image exceeds the size limit.');}chunks.push(value);}}
  finally{reader.releaseLock();}
  return Buffer.concat(chunks);
}
export async function localImage(path,{cwd,fs,session,signal,maxBytes,knownUpload=false}){
  signal?.throwIfAborted();
  if(typeof path!=='string'||!path.trim()||/^[a-z]+:\/\//i.test(path))fail('source_paths must contain existing local image files, not URLs.');
  const source_path=resolve(cwd,path),target=await fs.resolve(path,{cwd,signal}),parent=await fs.resolve(cwd,{signal});
  if((await fs.stat(target,signal))?.type!=='file')fail(`source file unavailable: ${source_path}`);
  const host=fs.processPath(target);
  if(fs.processPathFromHostPath?.(host)!==host)fail('filesystem is not mapped to this host; make the file available through the authorized Harness filesystem first.');
  if(!fs.contains(parent,target)&&!knownUpload&&!inspectedExternalImage(session,source_path))fail(`source is outside the workspace; first call read_image(${JSON.stringify({file_path:source_path})}) in this session.`);
  if(fs.processPathFromHostPath?.(source_path)!==source_path)fail('original source path is not mapped to this host.');
  await rejectLinkedSource(source_path,signal);
  const handle=await open(host,'r');
  try{
    const before=await handle.stat();
    if(!before.isFile()||before.size===0||before.size>maxBytes)fail(`empty, nonregular or oversized image: ${source_path}; size limit is ${maxBytes} bytes.`);
    const bytes=Buffer.alloc(before.size);let offset=0;
    while(offset<bytes.length){signal?.throwIfAborted();const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
    const after=await handle.stat();
    if(offset!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)fail(`source changed while reading: ${source_path}; inspect the new version before retrying.`);
    const type=imageType(bytes),ext=extname(source_path).toLowerCase();
    if(!type||ext&&ext!==type.extension&&!(ext==='.jpeg'&&type.extension==='.jpg'))fail(`unsupported image or filename/signature mismatch: ${source_path}; use PNG/JPEG/WebP/GIF (extensionless uploads are accepted).`);
    return {source_path,bytes,...type,sha256:hash(bytes),mtimeMs:after.mtimeMs};
  }finally{await handle.close();}
}

export function createStageImagesTool({root,fs,comfyBaseUrl='http://127.0.0.1:8188',fetchImpl=globalThis.fetch,maxBytes=32*1024**2}){
  const parsed=new URL(comfyBaseUrl);
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)fail('comfyBaseUrl must be an HTTP(S) origin without credentials or a path.');
  const origin=parsed.origin;
  root=resolve(root);
  const request=(url,init={})=>fetchImpl(origin+url,{...init,redirect:'error'});
  async function remoteMatches(image,sha256,signal){
    const parts=image.split('/'),filename=parts.pop(),subfolder=parts.join('/');
    const response=await request('/view?'+new URLSearchParams({filename,subfolder,type:'input'}),{signal});
    if(response.status===404){await response.body?.cancel();return false;}
    if(!response.ok){await response.body?.cancel();fail(`cannot verify selected staged image ${image}: HTTP ${response.status}; check ComfyUI connectivity/access, do not repeatedly upload.`);}
    return hash(await boundedBody(response,maxBytes))===sha256;
  }
  async function stage(source,signal){
    signal?.throwIfAborted();
    const key=hash(origin+'\0'+source.source_path+'\0'+source.sha256),manifest=join(root,key+'.json');
    let saved;try{saved=JSON.parse(await readFile(manifest,'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
    const filename=source.sha256+source.extension;
    let image=saved?.origin===origin&&saved.sha256===source.sha256&&saved.source_path===source.source_path&&imageName(saved.image)?saved.image:'dsh-director/'+filename;
    const reused=await remoteMatches(image,source.sha256,signal);
    if(!reused){
      const form=new FormData();form.set('image',new Blob([source.bytes],{type:source.mime}),filename);
      form.set('type','input');form.set('subfolder','dsh-director');form.set('overwrite','false');
      const response=await request('/upload/image',{method:'POST',body:form,signal});
      const body=await boundedBody(response,16*1024);
      if(!response.ok)fail(`image upload failed: HTTP ${response.status}; ${body.toString('utf8').slice(0,300)}. Check /upload/image multipart support; do not guess a local ComfyUI directory.`);
      let value;try{value=JSON.parse(body);}catch{fail('upload returned invalid JSON; verify ComfyUI, do not resubmit a video.');}
      if(!value||value.type!=='input'||typeof value.name!=='string'||value.name.includes('/')||value.name.includes('\\')||value.subfolder!=='dsh-director')fail('upload returned an unexpected input binding; inspect the server response before use.');
      image=value.subfolder+'/'+value.name;if(!imageName(image))fail('upload returned an unsafe image filename.');
      if(!await remoteMatches(image,source.sha256,signal))fail(`uploaded image bytes failed verification: ${image}; do not use this binding or blindly retry.`);
    }
    const record={origin,source_path:source.source_path,image,sha256:source.sha256};
    signal?.throwIfAborted();
    await mkdir(root,{recursive:true,mode:0o700});
    const temporary=manifest+'.'+randomUUID()+'.part';let handle;
    try{handle=await open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(record));await handle.sync();await handle.close();handle=undefined;signal?.throwIfAborted();await rename(temporary,manifest);}
    finally{await handle?.close();await unlink(temporary).catch(()=>{});}
    signal?.throwIfAborted();return {...record,reused};
  }
  return {
    name:'director_stage_images',
    description:'Stage 1–9 selected local reference images in ComfyUI and reuse byte-verified bindings. Accepts workspace files and extensionless uploaded attachments; outside-workspace files require native read_image first. Use before binding LoadImage.inputs.image and h3_review.references[].image. Returned image is the ComfyUI filename; source_path stays the exact original path for read_image and review. Preserves original bytes, handles multipart upload, persists SHA256 bindings and checks only selected images—not the whole library. Does not view images for the model, approve references, queue jobs, unload models or end the turn. Continue to inspect actual images; repeat inspection if compacted away. Do not write an upload script or print object_info/LoadImage to stage files.',
    parameters:{type:'object',properties:{source_paths:{type:'array',items:{type:'string'},minItems:1,maxItems:9}},required:['source_paths'],additionalProperties:false},
    timeoutMs:60000,
    async execute(args,exec){
      if(!Array.isArray(args?.source_paths)||args.source_paths.length<1||args.source_paths.length>9)fail('provide 1–9 source_paths for the selected images only.');
      const session=exec.agent?.session,cwd=session?.header?.cwd;
      if(!session?.id||!cwd||!fs)fail('a live Harness session and authoritative filesystem are required.');
      const images=[];
      for(const path of args.source_paths){
        try{images.push(await stage(await localImage(path,{cwd,fs,session,signal:exec.signal,maxBytes}),exec.signal));}
        catch(error){if(exec.signal?.aborted)throw error;throw new Error(`${error.message}${images.length?' Already staged (reuse on retry): '+JSON.stringify(images.map(({source_path,image})=>({source_path,image}))):''}`);}
      }
      exec.signal?.throwIfAborted();return {images};
    },
    output:{schema:{type:'object'},render(_args,value){return [{type:'text',text:JSON.stringify(value)}];},presentationMeta(_args,value){return value;}},
  };
}

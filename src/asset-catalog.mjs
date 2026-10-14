import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,rename,unlink} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {localImage} from './image-staging.mjs';
import {inspectedExternalImage} from './media-tool.mjs';
import {currentUploadEvidence} from './upload-evidence.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const roles=['actor','costume','scene','prop','layout','continuity'];
const fail=message=>{throw Error('director_assets: '+message)};

// The native durable log is the upload index, including uploads pruned out of
// model context. Only this session's human attachments are eligible.
export function uploadedAssets(session,attachments,fs){
  const assets=new Map();
  for(const e of session.snapshotEvents?.()??[]){
    if(e.type!=='user/message'||e.data?.source?.kind!=='user')continue;
    for(const block of e.data.content??[]){
      if(block.type!=='image'||!block.attachment?.attachmentId)continue;
      const ref=block.attachment;let source_path;
      try{const host=attachments?.imageHostPath?.(ref);if(host)source_path=fs.processPathFromHostPath?.(host)}catch{}
      assets.set(ref.attachmentId,{attachment_id:ref.attachmentId,name:ref.name||ref.attachmentId,source_path,origin:'upload',roles:[],shot_ids:[],upload_seq:e.seq});
    }
  }
  return [...assets.values()];
}
export function createAssetTool({root,fs,attachments}){
  async function load(directory){
    let files;try{files=await readdir(directory)}catch(e){if(e.code==='ENOENT')return [];throw e}
    const records=[];
    for(const name of files.filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){
      records.push(JSON.parse(await readFile(join(directory,name),'utf8')));
    }
    return records;
  }
  async function save(directory,record){
    await mkdir(directory,{recursive:true,mode:0o700});
    const path=join(directory,digest(record.source_path)+'.json'),temp=path+'.'+randomUUID()+'.part';
    // Atomic, independent per-source writes prevent unrelated concurrent updates
    // from overwriting one another. No image bytes are copied into this index.
    const {open}=await import('node:fs/promises');let handle;
    try{handle=await open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(record));await handle.sync();await handle.close();handle=undefined;await rename(temp,path)}
    finally{await handle?.close();await unlink(temp).catch(()=>{})}
  }
  return {
    name:'director_assets',
    description:'Find this session’s uploaded and registered images, including after compaction. List when source paths are unknown instead of guessing filenames or scanning drives. Returns exact source_path, availability, inspected and saved visual roles. Native uploads may have NO extension: do not append one. Register selected images with roles, observation and shot_ids after seeing pixels: current visible human uploads need no duplicate read_image; other images do. Labels aid retrieval, never prove pixels, approval or staging. Use director_stage_images for Comfy filenames. Query matches names/labels, not image contents; an empty query result does not prove absence.',
    parameters:{type:'object',properties:{action:{type:'string',enum:['list','register']},query:{type:'string'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:30},items:{type:'array',minItems:1,maxItems:12,items:{type:'object',properties:{path:{type:'string'},name:{type:'string'},roles:{type:'array',items:{type:'string',enum:roles}},observation:{type:'string'},shot_ids:{type:'array',items:{type:'string'}}},required:['path'],additionalProperties:false}}},additionalProperties:false},
    timeoutMs:60000,
    async execute(args={},exec){
      const session=exec.agent?.session,cwd=session?.header?.cwd;
      if(!session?.id||!cwd)fail('a live session workspace is required.');
      const directory=join(root,digest(session.id));
      const uploads=uploadedAssets(session,attachments,fs),records=await load(directory);
      const map=new Map(uploads.map(a=>[a.source_path||a.attachment_id,a]));
      for(const record of records)if(record.session_id===session.id)map.set(record.source_path,{...map.get(record.source_path),...record});
      const read=(path,knownUpload=false)=>localImage(path,{cwd,fs,session,signal:exec.signal,maxBytes:32*1024**2,knownUpload});
      if(args.action==='register'){
        if(!Array.isArray(args.items)||!args.items.length||args.items.length>12)fail('register 1–12 selected files.');
        for(const item of args.items){
          const path=resolve(cwd,item.path),hasLabels=!!(item.roles?.length||item.observation||item.shot_ids?.length);
          const upload=currentUploadEvidence(session,path,{attachments,fs});
          if(hasLabels&&!upload&&!inspectedExternalImage(session,path))fail(`call read_image on ${path} before assigning visual labels.`);
          if(item.roles?.some(r=>!roles.includes(r)))fail('unsupported visual role.');
          const image=await read(path,!!upload),old=map.get(path),same=old?.sha256===image.sha256;
          if(hasLabels&&upload?.sha256!==image.sha256&&!inspectedExternalImage(session,path,image.mtimeMs))fail(`file may have changed since inspection; call read_image on ${path} again before labeling.`);
          const record={...(same?old:{}),session_id:session.id,source_path:path,sha256:image.sha256,name:String(item.name||old?.name||basename(path)).slice(0,300),origin:old?.origin||'local',roles:item.roles??(same?old.roles:[])??[],shot_ids:(item.shot_ids??(same?old.shot_ids:[])??[]).slice(0,30).map(s=>String(s).slice(0,100)),observation:item.observation===undefined?(same?old.observation:undefined):String(item.observation).slice(0,1500)};
          await save(directory,record);map.set(path,record);
        }
      }else if(args.action&&args.action!=='list')fail('action must be list or register.');
      const query=String(args.query||'').toLowerCase(),offset=args.offset??0,limit=args.limit??20;
      if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>30)fail('invalid pagination.');
      const candidates=[...map.values()].filter(a=>!query||[a.name,a.observation,...a.roles,...a.shot_ids].join(' ').toLowerCase().includes(query));
      const assets=[];
      for(const asset of candidates.slice(offset,offset+limit)){
        const row={...asset,inspected:!!asset.source_path&&inspectedExternalImage(session,asset.source_path)};
        if(!asset.source_path)row.availability='unmapped';
        else try{
          // Listing uploads must work before they have been visually inspected.
          // Read metadata/bytes through the native fs; inspection gates remain
          // on casting/registration and submission.
          const isUpload=uploads.some(u=>u.source_path===asset.source_path);
          const image=await localImage(asset.source_path,{cwd,fs,session,signal:exec.signal,maxBytes:32*1024**2,knownUpload:isUpload});
          row.availability=asset.sha256&&image.sha256!==asset.sha256?'changed':'available';row.sha256=image.sha256;
          if(currentUploadEvidence(session,asset.source_path,{attachments,fs})?.sha256===image.sha256)row.inspected=true;
        }catch(e){if(exec.signal?.aborted)throw e;row.availability=/unavailable|ENOENT/.test(e.message)?'missing':'unavailable';row.reason=e.message.slice(0,250)}
        if(row.availability!=='available'){row.roles=[];row.shot_ids=[];delete row.observation;row.inspected=false}
        delete row.session_id;assets.push(row);
      }
      return {assets,total:candidates.length,next_offset:offset+assets.length<candidates.length?offset+assets.length:null,note:'Saved labels are retrieval hints. Inspect selected pixels before casting; no approval or staging is implied.'};
    },
    output:{schema:{type:'object'},render(_args,value){return [{type:'text',text:JSON.stringify(value)}]}}
  };
}

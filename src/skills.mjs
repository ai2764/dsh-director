import {readFile,writeFile,mkdir,mkdtemp,rename,rm,lstat} from 'node:fs/promises';
import {dirname,resolve,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';

const revision='a107547fa669c509b8e6363fe18378d46ab3066c';
const upstream=`https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/${revision}/skills/h3-prompt-writing`;
const licenseUrl='https://huggingface.co/MiniMaxAI/MiniMax-H3/raw/42ed227ee7df40d41602854ae760620d6eb651fe/LICENSE';
export const H3_DOWNLOAD_ACCEPT='Download under upstream terms';
export const H3_GUIDE_MANIFEST=Object.freeze({
  revision,
  source:`https://github.com/MiniMax-AI/MiniMax-H3/tree/${revision}/skills/h3-prompt-writing`,
  licenseUrl,
  files:Object.freeze([
    {path:'references/upstream-SKILL.md',url:`${upstream}/SKILL.md`,bytes:2623,sha256:'a7000443588ca3f145e3b3fd8900f14e0325dc460bd811268fac89a9dc8e56d0'},
    {path:'references/ref-en.txt',url:`${upstream}/references/ref-en.txt`,bytes:23553,sha256:'1e574f356716ad55612247ffb7bbccbcdb484ad96599d63c7dca1af186b1fab7'},
    {path:'references/base-en.txt',url:`${upstream}/references/base-en.txt`,bytes:15773,sha256:'2cfebc096a6e08370f288d468d90b60f7f9bcb938f94bf090816e910e48e75fc'},
    {path:'LICENSE.minimax-h3',url:licenseUrl,bytes:17604,sha256:'59b99642b95ea21630e311198ddbfffbfe05aadba0c2f5d884cbdf4efcc90f44'},
  ].map(Object.freeze)),
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const defaultCacheRoot=()=>join(process.env.DSH_HOME||join(homedir(),'.dsh'),'director-skills');
const provenance=manifest=>`# Official H3 guides — downloaded separately\n\nSource: ${manifest.source}\n\nRevision: ${manifest.revision}\n\nLicense: ${manifest.licenseUrl}\n\nDownloaded after native human confirmation. Not part of the plugin distribution.\n`;

async function verifiedDownload(file,fetchImpl,signal){
  const response=await fetchImpl(file.url,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20_000)]):AbortSignal.timeout(20_000),headers:{Accept:'text/plain'}});
  if(!response.ok||response.redirected)throw new Error(`H3 guide download failed: HTTP ${response.status}; redirects are not accepted.`);
  const advertised=response.headers.get('content-length');
  const encoding=response.headers.get('content-encoding')?.trim().toLowerCase();
  // fetch decodes gzip/br bodies but keeps their compressed wire-length header.
  // The bounded reader and final hash below always validate decoded file bytes.
  if((!encoding||encoding==='identity')&&advertised!==null&&Number(advertised)!==file.bytes){await response.body?.cancel();throw new Error('H3 guide download size does not match its pinned bytes.');}
  if(!response.body)throw new Error('H3 guide download has no body.');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    while(true){
      signal?.throwIfAborted();
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>file.bytes)throw new Error('H3 guide download exceeds its pinned size.');
      chunks.push(Buffer.from(value));
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=Buffer.concat(chunks);
  if(size!==file.bytes||hash(bytes)!==file.sha256)throw new Error(`H3 guide integrity/hash check failed: ${file.path}`);
  return bytes;
}

/** Immutable, version-pinned resources. The manifest is trusted application data,
 * never tool/model input. No network or directory creation occurs during lookup. */
export function createH3GuideStore({cacheRoot=defaultCacheRoot(),manifest=H3_GUIDE_MANIFEST,fetchImpl=globalThis.fetch}={}){
  const fingerprint=hash(JSON.stringify(manifest));
  const parent=join(resolve(cacheRoot),'h3'),directory=join(parent,fingerprint);
  const info={directory,revision:manifest.revision,source:manifest.source,license_url:manifest.licenseUrl};
  let inFlight;
  async function status(){
    try{
      const stat=await lstat(directory);
      if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Cache directory is not a regular directory.');
      const refs=await lstat(join(directory,'references'));
      if(!refs.isDirectory()||refs.isSymbolicLink())throw new Error('Cache references are not a regular directory.');
      const receiptPath=join(directory,'receipt.json'),receiptStat=await lstat(receiptPath);
      if(!receiptStat.isFile()||receiptStat.isSymbolicLink()||receiptStat.size>8192)throw new Error('Invalid consent receipt.');
      const receipt=JSON.parse(await readFile(receiptPath,'utf8'));
      if(receipt.fingerprint!==fingerprint||receipt.accepted!==true||receipt.method!=='native-user-question')throw new Error('No matching human consent receipt.');
      for(const file of manifest.files){
        const path=join(directory,file.path),stat=await lstat(path);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.bytes||hash(await readFile(path))!==file.sha256)throw new Error(`Invalid cached file: ${file.path}`);
      }
      if(await readFile(join(directory,'references/UPSTREAM.md'),'utf8')!==provenance(manifest))throw new Error('Invalid cached provenance.');
      return {available:true,...info};
    }catch(error){
      let exists=true;try{await lstat(directory);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}
      return {available:false,...info,reason:exists?'cache_integrity_failed':'not_installed',instruction:exists?'The dedicated H3 guide cache failed integrity checks. Preserve it and move it aside before an explicitly authorized reinstall; user skills are never overwritten.':'Call director_h3_skill with action install to request a native human download confirmation.'};
    }
  }
  async function installActual({ask,agent,signal}={}){
    signal?.throwIfAborted();
    const existing=await status();if(existing.available)return existing;
    if(existing.reason==='cache_integrity_failed')throw new Error(existing.instruction);
    if(typeof ask!=='function')throw new Error('Native human confirmation is required; the Harness user-questions service is unavailable.');
    const id='h3-guides-'+randomUUID();
    const answer=await ask({questions:[{
      id,header:'Official H3 Skill',
      question:`Download the official H3 prompt guides from ${manifest.source} (fixed revision ${manifest.revision})? Upstream terms: ${manifest.licenseUrl}. Review those terms, including applicable restrictions. Selecting "${H3_DOWNLOAD_ACCEPT}" confirms you agree to obtain/use these files under those terms. Files are cached only at ${directory}; no models, workflows, or user skills are installed or overwritten.`,
      options:[{label:'Not now'},{label:H3_DOWNLOAD_ACCEPT}],multiSelect:false,
    }],...(agent?{agent}:{}),...(signal?{signal}:{})});
    signal?.throwIfAborted();
    const item=answer?.answers?.[0];
    if(answer?.answers?.length!==1||item.id!==id||item.selected?.length!==1||item.selected[0]!==H3_DOWNLOAD_ACCEPT||item.custom?.trim())throw new Error('H3 guide download declined or missing explicit native human consent.');
    const data=[];for(const file of manifest.files){signal?.throwIfAborted();data.push(await verifiedDownload(file,fetchImpl,signal));}
    signal?.throwIfAborted();
    await mkdir(parent,{recursive:true});
    if((await lstat(parent)).isSymbolicLink())throw new Error('H3 cache parent must not be a symbolic link.');
    const stage=await mkdtemp(join(parent,'.download-'));
    try{
      for(const [i,file]of manifest.files.entries()){
        signal?.throwIfAborted();await mkdir(dirname(join(stage,file.path)),{recursive:true});await writeFile(join(stage,file.path),data[i],{flag:'wx'});
      }
      await writeFile(join(stage,'references/UPSTREAM.md'),provenance(manifest),{flag:'wx'});
      await writeFile(join(stage,'receipt.json'),JSON.stringify({fingerprint,accepted:true,method:'native-user-question',accepted_at:new Date().toISOString()}),{flag:'wx'});
      signal?.throwIfAborted();
      try{await rename(stage,directory);}catch(error){if(!(await status()).available)throw error;}
      const result=await status();if(!result.available)throw new Error('H3 cache integrity failed after download.');
      return result;
    }finally{
      // Only this invocation's freshly-created staging directory may be removed.
      if(dirname(stage)===parent&&basename(stage).startsWith('.download-'))await rm(stage,{recursive:true,force:true});
    }
  }
  return {status,install(options){if(!inFlight)inFlight=installActual(options).finally(()=>{inFlight=undefined;});return inFlight;}};
}

export function createH3GuideTool({guideStore,userQuestions}={}){
  return {
    name:'director_h3_skill',
    description:'Check optional official H3 guide availability, or install pinned guides after a native human confirmation. No model, workflow, user skill or video is installed/generated. Prefer status; existing verified cache works offline. No consent argument is accepted.',
    parameters:{type:'object',properties:{action:{type:'string',enum:['status','install']}},required:['action'],additionalProperties:false},
    timeoutMs:300000,
    async execute(args,exec){
      if(!args||Object.keys(args).some(key=>key!=='action')||!['status','install'].includes(args.action))throw new Error('Use only action status or install; no model-supplied consent arguments are accepted.');
      if(args.action==='status')return guideStore.status();
      return guideStore.install({ask:userQuestions?request=>userQuestions.ask(request):undefined,agent:exec.agent,signal:exec.signal});
    },
    output:{schema:{type:'object'},render(_args,value){return [{type:'text',text:JSON.stringify(value)}];}},
  };
}

export async function createBundledProvider(root=resolve(dirname(fileURLToPath(import.meta.url)),'../skills'),{guideStore=createH3GuideStore()}={}) {
  const definitions=new Map();
  for (const name of ['director','h3-prompt-writing']) {
    const path=resolve(root,name,'SKILL.md');
    const text=await readFile(path,'utf8');
    const parsed=/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
    if (!parsed) throw new Error(`Invalid bundled skill: ${name}`);
    const description=/^description:\s*(.+)$/m.exec(parsed[1])?.[1];
    if (!description || !new RegExp(`^name: ${name}$`,'m').test(parsed[1])) throw new Error(`Invalid skill metadata: ${name}`);
    definitions.set(name,{name,description,content:parsed[2].trimStart(),path,
      source:'bundled',provider:'dsh-director-bundled',invocation:{modelInvocable:true,userInvocable:true},
      resourceBase:{kind:'directory',path:dirname(path)}});
  }
  const candidates=[...definitions.values()].map(({content,...d})=>({...d,rank:600,locator:d.name}));
  return {name:'dsh-director-bundled',async list(){return {candidates,complete:true};},
    async get(candidate){
      const definition=definitions.get(candidate.locator);
      if(!definition||definition.name!=='h3-prompt-writing')return definition;
      const cache=await guideStore.status();
      if(cache.available)return {...definition,resourceBase:{kind:'directory',path:cache.directory}};
      return {...definition,content:`# Official H3 guides are not available\n\n${cache.instruction}\nDo not attempt the reference-file links below until installation succeeds. Then reload h3-prompt-writing so its resource base points to the verified cache. If the setup tool is unavailable, report that limitation; do not fabricate the guides or bypass consent.\n\n${definition.content}`};
    }};
}

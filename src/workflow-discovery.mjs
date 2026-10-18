import {readFile,readdir} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';

const link=(value,graph)=>Array.isArray(value)&&value.length===2&&Object.hasOwn(graph,String(value[0]));
const nodeAt=(value,graph)=>link(value,graph)?graph[String(value[0])]:undefined;
const nodesOf=(graph,type)=>Object.entries(graph).filter(([,node])=>node?.class_type===type);
const binding=(node,port,value,graph)=>link(value,graph)?{node:String(node),port,from:{node:String(value[0]),output:Number(value[1]),type:graph[String(value[0])].class_type}}:null;
const consumers=(graph,nodeId,output)=>Object.entries(graph).flatMap(([id,node])=>Object.entries(node?.inputs??{}).filter(([,value])=>link(value,graph)&&String(value[0])===String(nodeId)&&Number(value[1])===output).map(([port])=>({node:id,port,type:node.class_type})));
const knownH3=graph=>Object.values(graph).some(node=>['MiniMaxH3ReferenceToVideo','MiniMaxH3ImageToVideo','MiniMaxH3FirstLastFrameToVideo'].includes(node?.class_type));

function dependsOn(value,id,output,graph,seen=new Set()){
  if(!link(value,graph))return false;
  if(String(value[0])===String(id)&&Number(value[1])===output)return true;
  const key=`${value[0]}:${value[1]}`;
  if(seen.has(key))return false;
  seen.add(key);
  return Object.values(graph[String(value[0])].inputs??{}).some(input=>dependsOn(input,id,output,graph,seen));
}

function savedVideoOutputs(graph){
  return nodesOf(graph,'CreateVideo').filter(([id])=>nodesOf(graph,'SaveVideo').some(([,node])=>dependsOn(node.inputs?.video,id,0,graph)))
    .map(([,node])=>node.inputs??{}).concat(nodesOf(graph,'VHS_VideoCombine').map(([,node])=>node.inputs??{}));
}

function hasPriorContext(node,graph){
  if(link(node.inputs?.context_frames,graph))return true;
  const loaded=nodeAt(node.inputs?.context_latent,graph);
  return !!loaded&&(loaded.class_type!=='MiniMaxH3MotionContextLoadLatent'||Number(loaded.inputs?.clip_index)>0);
}

// Certify the known H3 MotionContext contract, not arbitrary coding workflows.
// A loader socket alone is not evidence that context affects the saved video.
function verifyH3Context(graph,contextId,outputs,outputSamplers){
  if(!knownH3(graph))return null;
  const samplers=outputSamplers.filter(([,node])=>dependsOn(node.inputs?.guider,contextId,0,graph));
  const issues=[];
  if(!samplers.length)issues.push('MotionContext conditioning does not reach the current sampler guider.');
  const trims=nodesOf(graph,'MiniMaxH3MotionContextTrim').filter(([,node])=>
    link(node.inputs?.trim_frames,graph)&&String(node.inputs.trim_frames[0])===contextId&&Number(node.inputs.trim_frames[1])===1&&
    samplers.some(([id])=>dependsOn(node.inputs?.images,id,0,graph)));
  if(!trims.length)issues.push('MotionContext trim must use its trim_frames output and decoded images from the same conditioned sampler.');
  const relevant=outputs.filter(input=>samplers.some(([id])=>dependsOn(input.images,id,0,graph)));
  if(!relevant.length||relevant.some(input=>!trims.some(([id])=>dependsOn(input.images,id,0,graph))))issues.push('MotionContext trim images do not reach every saved video output from the conditioned sampler.');
  if(relevant.some(input=>link(input.audio,graph)&&!trims.some(([id,node])=>dependsOn(input.images,id,0,graph)&&dependsOn(input.audio,id,1,graph)&&samplers.some(([samplerId])=>dependsOn(node.inputs?.audio,samplerId,0,graph)))))issues.push('Saved video audio must pass through the same MotionContext trim as its images.');
  return {wiring_verified:issues.length===0,wiring_issues:issues};
}

function videoSource(binding,graph){
  let node=nodeAt(binding,graph),seen=new Set();
  while(node&&!seen.has(node)){
    seen.add(node);
    if(node.class_type==='VHS_LoadVideo')return node.inputs?.video;
    const next=Object.values(node.inputs??{}).find(value=>link(value,graph));
    node=nodeAt(next,graph);
  }
  return undefined;
}

function alignedH3Frames(requested){
  let frames=Math.max(5,requested);
  while(frames%17!==5)frames++;
  return frames;
}

export function inspectComfyGraph(graph){
  const classes=Object.fromEntries([...new Set(Object.values(graph).map(node=>node?.class_type).filter(Boolean))].sort().map(type=>[type,nodesOf(graph,type).length]));
  const contexts=nodesOf(graph,'MiniMaxH3MotionContext');
  const saves=nodesOf(graph,'MiniMaxH3MotionContextSaveLatent');
  const sampler=nodesOf(graph,'SamplerCustomAdvanced');
  const outputs=savedVideoOutputs(graph);
  // Inspect graph fragments as before; a real saved output defines which branch
  // can establish continuity and which sampler's latent belongs to that video.
  const reachesOutput=id=>!outputs.length||outputs.some(input=>[input.images,input.audio].some(value=>dependsOn(value,id,0,graph)||dependsOn(value,id,1,graph)));
  const outputSamplers=outputs.length?sampler.filter(([id])=>outputs.some(input=>dependsOn(input.images,id,0,graph))):sampler;
  const relevantContexts=contexts.filter(([id])=>reachesOutput(id));
  const activeContext=relevantContexts.find(([,node])=>hasPriorContext(node,graph));
  const selectedContext=activeContext??relevantContexts[0];
  const currentSamplers=knownH3(graph)&&activeContext?outputSamplers.filter(([,node])=>dependsOn(node.inputs?.guider,activeContext[0],0,graph)):outputSamplers;
  const savedNodes=saves.filter(([,node])=>currentSamplers.some(([id])=>String(node.inputs?.latent?.[0])===id&&Number(node.inputs?.latent?.[1])===0));
  const saved=savedNodes.length>0;
  const rawSaveIndex=savedNodes.length===1?Number(savedNodes[0][1].inputs?.clip_index):NaN;
  const saveIndex=Number.isInteger(rawSaveIndex)&&rawSaveIndex>=0?rawSaveIndex:null;
  const latentSlots=loadIndex=>({load_clip_index:loadIndex,save_clip_index:saveIndex,save_slot_stable:saveIndex!==null&&saveIndex>0,sequential:loadIndex===null||saveIndex===null?null:loadIndex===0?saveIndex===1:saveIndex===loadIndex+1});
  let continuity={mode:'none',source:null,latent_saved_for_next:saved,latent_slots:latentSlots(null),explanation:saved?'No previous clip context is wired; current sampler output is saved for the next clip.':'No previous clip context is wired.'};
  if(selectedContext){
    const [contextId,context]=selectedContext,inputs=context.inputs??{};
    const loaded=nodeAt(inputs.context_latent,graph);
    const activeLatent=loaded?.class_type==='MiniMaxH3MotionContextLoadLatent'&&Number(loaded.inputs?.clip_index)>0;
    const contextPort=activeLatent||link(inputs.context_latent,graph)&&!link(inputs.context_frames,graph)?'context_latent':link(inputs.context_frames,graph)?'context_frames':null;
    const contextBinding=contextPort?binding(contextId,contextPort,inputs[contextPort],graph):null;
    const sourceNode=contextBinding?.from&&graph[contextBinding.from.node];
    const sourcePort=sourceNode&&Object.keys(sourceNode.inputs??{}).find(key=>link(sourceNode.inputs[key],graph));
    const wiring={context_input:contextBinding,source_input:sourcePort?binding(contextBinding.from.node,sourcePort,sourceNode.inputs[sourcePort],graph):null,conditioning_consumers:consumers(graph,contextId,0),trim_consumers:consumers(graph,contextId,1)};
    if(activeLatent){
      continuity={mode:'sampler_latent',source:`${loaded.inputs.latent_path} (clip ${loaded.inputs.clip_index})`,latent_saved_for_next:saved,latent_slots:latentSlots(Number(loaded.inputs.clip_index)),explanation:saved?'Previous sampler latent is wired to context_latent; current sampler output is saved for the next clip.':'Previous sampler latent is wired to context_latent; current sampler output is not saved for the next clip.'};
    }else if(link(inputs.context_frames,graph)){
      continuity={mode:'video_frames',source:videoSource(inputs.context_frames,graph)??null,latent_saved_for_next:saved,latent_slots:latentSlots(null),explanation:'Previous-video multi-frame motion history feeds context_frames; this is a supported Motion Context route, not the original saved sampler latent. Prefer compatible saved sampler latent when available. Original prior sampler latent requires the prior run to save its sampler output and the next run to load that file into MotionContext.context_latent; keep the current clip sampler latent_image route intact. VAE encoding the finished video is a different mechanism.'};
    }else if(loaded?.class_type==='MiniMaxH3MotionContextLoadLatent'&&Number(loaded.inputs?.clip_index)===0){
      continuity={mode:'none',source:null,latent_saved_for_next:saved,latent_slots:latentSlots(0),explanation:'The latent loader is set to clip_index 0, so this is a first clip with no previous context.'};
    }else if(link(inputs.context_latent,graph)){
      continuity={mode:'unverified_latent',source:String(inputs.context_latent[0]),latent_saved_for_next:saved,latent_slots:latentSlots(null),explanation:'context_latent is wired, but its source is not a verified previous clip latent loader.'};
    }
    continuity.wiring=wiring;
    const verified=continuity.mode!=='none'?verifyH3Context(graph,contextId,outputs,outputSamplers):null;
    if(verified){
      Object.assign(continuity,verified);
      if(!verified.wiring_verified)continuity.explanation=`Unverified candidate ${continuity.mode}: ${verified.wiring_issues.join(' ')} ${continuity.explanation}`;
    }
  }else{
    // Custom context nodes may expose the same socket names. Surface the
    // connection for investigation without certifying an unknown latent type.
    const custom=Object.entries(graph).find(([id,node])=>node?.class_type!=='MiniMaxH3MotionContext'&&link(node?.inputs?.context_latent,graph)&&reachesOutput(id));
    if(custom){
      const [id,node]=custom;
      continuity={mode:'unverified_latent',source:String(node.inputs.context_latent[0]),latent_saved_for_next:saved,latent_slots:latentSlots(null),explanation:`${node.class_type}.context_latent is wired through a custom context node. Inspect its installed schema and trace the prior clip source before claiming sampler latent continuity.`,wiring:{context_input:binding(id,'context_latent',node.inputs.context_latent,graph),source_input:null,conditioning_consumers:consumers(graph,id,0),trim_consumers:consumers(graph,id,1)}};
    }
  }
  const external_inputs=Object.entries(graph).flatMap(([id,node])=>Object.entries(node?.inputs??{}).filter(([key,value])=>
    !link(value,graph)&&(/^(image|video|latent_path|clip_index|length|width|height|filename_prefix|context_length)$/.test(key)||key==='prompt')
  ).map(([key,value])=>({node:id,class_type:node.class_type,input:key,value:key==='prompt'?`<${String(value).length} characters>`:value})));
  const h3=nodesOf(graph,'MiniMaxH3ReferenceToVideo')[0]?.[1];
  const requested=Number(h3?.inputs?.length);
  let generation_timing;
  if(Number.isInteger(requested)&&requested>0){
    const aligned=alignedH3Frames(requested);
    const [contextId,context]=selectedContext??[];
    const trim=contextId&&nodesOf(graph,'MiniMaxH3MotionContextTrim').find(([id,node])=>
      link(node.inputs?.trim_frames,graph)&&String(node.inputs.trim_frames[0])===contextId&&Number(node.inputs.trim_frames[1])===1&&
      (!outputs.length||outputs.some(input=>dependsOn(input.images,id,0,graph))))?.[1];
    const pinned=trim?Number(context.inputs?.context_length):0;
    const fps=Number(trim?.inputs?.fps) || 24;
    if(Number.isInteger(pinned)&&pinned>=0){
      const delivered=aligned-pinned;
      generation_timing={requested_frames:requested,aligned_frames:aligned,pinned_frames:pinned,delivered_frames:delivered,fps,delivered_seconds:Number((delivered/fps).toFixed(3))};
    }
  }
  return {format:'api',node_count:Object.keys(graph).length,node_classes:classes,external_inputs,continuity,...(generation_timing?{generation_timing}:{})};
}

function workflowDocument(parsed){
  const graph=parsed?.prompt??parsed;
  if(graph&&typeof graph==='object'&&!Array.isArray(graph)&&Object.values(graph).length&&Object.values(graph).every(node=>node&&typeof node==='object'&&typeof node.class_type==='string'))return inspectComfyGraph(graph);
  if(Array.isArray(parsed?.nodes))return {format:'ui',node_count:parsed.nodes.length,node_classes:Object.fromEntries([...new Set(parsed.nodes.map(node=>node.type))].filter(Boolean).sort().map(type=>[type,parsed.nodes.filter(node=>node.type===type).length])),requires_api_export:true,explanation:'This is a ComfyUI canvas workflow. Export its API graph before submit_comfy_job; inspect its node schema to map inputs.'};
  throw new Error('Workflow is neither a ComfyUI API graph nor a UI canvas workflow.');
}

export function createWorkflowTool({comfyBaseUrl='http://127.0.0.1:8188',fetchImpl=globalThis.fetch,readFileImpl=readFile,readdirImpl=readdir,workspaceRoot=process.cwd()}={}){
  const base=new URL(comfyBaseUrl).origin;
  async function get(url){
    const response=await fetchImpl(url,{redirect:'error'});
    if(!response.ok)throw new Error(`ComfyUI workflow lookup failed: HTTP ${response.status}`);
    return response.json();
  }
  return {
    name:'director_workflows',
    description:'Discover saved ComfyUI UI workflows, recent inspected/submitted paths, and API workflow candidates at the current workspace root; inspect a selected graph or installed node interface before adapting it. For a known local JSON, call inspect with workflow_path first: it reports the actual continuity route, save/load latent slots, and delivered frame timing without generation. For continuation prefer compatible saved sampler latent Motion Context; previous-video consecutive context_frames is also supported as video_frames. A single tail-frame Picture or guide is not the continuation method. Respect an explicit saved-latent requirement. Verify conditioning reaches the guider/sampler and trim/output paths; node presence alone is not proof. For latent handoff, query schema for both installed SaveLatent and LoadLatent classes: required_details includes clip_index defaults and tooltips, which determine slot semantics; a LATENT socket cannot take LoadImage IMAGE output. LoadLatent.latent_path must name an existing output directory or an exact .safetensors file when the dependent clip runs: the SaveLatent filename_prefix itself is neither a directory nor a file. An inspect result describes wiring, not proof that a future saved slot already exists. Use Harness native coding tools to find deeper project graphs and edit a copy; this tool never selects, rewires, or submits one automatically.',
    parameters:{type:'object',properties:{action:{type:'string',enum:['list','inspect','schema']},workflow_path:{type:'string',description:'Local ComfyUI API or UI JSON path for inspect.'},workflow_name:{type:'string',description:'Name returned by list, for a saved ComfyUI UI workflow.'},node_type:{type:'string',description:'Installed ComfyUI class name for targeted schema lookup.'}},required:['action']},
    output:{schema:{type:'object'},render(_args,value){return [{type:'text',text:JSON.stringify(value)}]}},
    async execute(args,exec){
      if(args.action==='list'){
        let workflows=[],comfy_error;
        try{
          workflows=await get(`${base}/userdata?dir=workflows&recurse=true`);
          if(!Array.isArray(workflows))throw new Error('ComfyUI workflow list has an unexpected response.');
        }catch(error){workflows=[];comfy_error=error.message}
        const workspace_candidates=[];
        try{
          const entries=(await readdirImpl(workspaceRoot,{withFileTypes:true})).filter(entry=>entry.isFile()&&entry.name.toLowerCase().endsWith('.json')).slice(0,80);
          for(const entry of entries){
            const path=join(workspaceRoot,entry.name);
            try{
              const inspected=workflowDocument(JSON.parse(await readFileImpl(path,'utf8')));
              workspace_candidates.push({name:entry.name,workflow_path:path,format:inspected.format,node_count:inspected.node_count,...(inspected.continuity?{continuity_mode:inspected.continuity.mode}:{})});
            }catch{}
          }
        }catch{}
        const events=exec?.agent?.session?.snapshotEvents?.()??[];
        const recent_workflows=[];
        const recent_inspections=[];
        for(const event of [...events].reverse())if(event.type==='tool/call'&&['submit_comfy_job','submit_comfy_video'].includes(event.data?.name)){
          let submitted;try{submitted=JSON.parse(event.data.arguments)}catch{continue}
          const path=submitted?.workflow_path;
          if(typeof path==='string'&&path.trim()&&!recent_workflows.includes(path))recent_workflows.push(path);
          if(recent_workflows.length===5)break;
        }
        for(const event of [...events].reverse())if(event.type==='tool/call'&&event.data?.name==='director_workflows'){
          let inspected;try{inspected=JSON.parse(event.data.arguments)}catch{continue}
          const path=inspected?.action==='inspect'&&inspected?.workflow_path;
          if(typeof path==='string'&&path.trim()&&!recent_inspections.includes(path))recent_inspections.push(path);
          if(recent_inspections.length===5)break;
        }
        return {workflows:workflows.filter(name=>typeof name==='string'&&name.toLowerCase().endsWith('.json')),recent_workflows,recent_inspections,workspace_candidates,...(comfy_error?{comfy_error}:{}),next_step:'Inspect a relevant path from recent_inspections, recent_workflows or workspace_candidates with action=inspect and workflow_path before searching deeper. For a saved UI workflow, inspect with workflow_name. If ComfyUI is unavailable, continue with local paths and Harness native coding tools. If no candidate points to the named project, use Harness native rg --files scoped to that project; search clip aliases such as C3, clip3, shot3 and character-name variants before opening files. Do not enter unrelated project directories. Query schema only for node types whose sockets still need verification.'};
      }
      if(args.action==='schema'){
        if(typeof args.node_type!=='string'||!/^[\w.-]+$/.test(args.node_type))throw new Error('schema requires one installed node_type.');
        const info=await get(`${base}/object_info/${encodeURIComponent(args.node_type)}`);
        const node=info?.[args.node_type];
        if(!node)throw new Error(`ComfyUI has no installed node ${args.node_type}.`);
        const input=node.input??{};
        const names=group=>Object.fromEntries(Object.entries(input[group]??{}).map(([name,descriptor])=>[name,Array.isArray(descriptor)?descriptor[0]:descriptor]));
        const details=group=>Object.fromEntries(Object.entries(input[group]??{}).map(([name,descriptor])=>[name,Array.isArray(descriptor)?{type:descriptor[0],...(descriptor[1]&&typeof descriptor[1]==='object'&&!Array.isArray(descriptor[1])?descriptor[1]:{})}:{type:descriptor}]));
        const file_input_guidance=args.node_type==='VHS_LoadVideo'?{
          input:'video',
          schema_format:'Raw /object_info descriptors are [type-or-choices, options]: input.required.video[0] contains choices; .value does not exist. This tool normalizes choices to required.video and preserves them in required_details.video.type.',
          dropdown_exhaustive:false,
          path_resolution:'The dropdown lists videos at the input root, but custom validation also accepts relative annotated paths. An unannotated path defaults to input. For an existing output use the exact relative path plus " [output]", for example "minimax_h3/clip_00001_.mp4 [output]"; [input] and [temp] also select their directory. A path absent from the dropdown can still be valid.',
          verify:{method:'HEAD',url:`${base}/view`,query_fields:['filename','subfolder','type'],note:'Split the relative video path into filename and subfolder; type is input by default, or output/temp from the annotation. HTTP 200 verifies file availability, not successful video decoding.'},
          stage:{method:'POST',url:`${base}/upload/image`,file_field:'image',type:'input',source:'Use Harness native coding tools to send multipart video bytes from the exact known source file path, with its filename; subfolder is optional. This endpoint also accepts videos.',result:'Use the returned name, subfolder and type to form the loader path and verify it through /view. Do not assume the server retained the requested filename.'},
          directory_guidance:'Do not infer the ComfyUI root from a Python executable or environment name. Use the server API and known file references; directory discovery is unnecessary for uploading a known local video.',
        }:undefined;
        return {node_type:args.node_type,description:node.description??null,required:names('required'),optional:names('optional'),required_details:details('required'),optional_details:details('optional'),outputs:node.output??[],output_names:node.output_name??[],input_order:node.input_order??null,...(file_input_guidance?{file_input_guidance}:{})};
      }
      if(args.action==='inspect'){
        const byPath=typeof args.workflow_path==='string'&&args.workflow_path.trim();
        const byName=typeof args.workflow_name==='string'&&args.workflow_name.trim();
        if(Boolean(byPath)===Boolean(byName))throw new Error('inspect requires exactly one workflow_path or workflow_name.');
        let parsed,source,download_url;
        if(byPath){
          source=isAbsolute(args.workflow_path)?args.workflow_path:resolve(process.cwd(),args.workflow_path);
          parsed=JSON.parse(await readFileImpl(source,'utf8'));
        }else{
          const workflows=await get(`${base}/userdata?dir=workflows&recurse=true`);
          if(!Array.isArray(workflows)||!workflows.includes(args.workflow_name))throw new Error('workflow_name must match a saved ComfyUI workflow from list.');
          source=args.workflow_name;
          download_url=`${base}/userdata/${encodeURIComponent(`workflows/${source}`)}`;
          parsed=await get(download_url);
        }
        const inspected=workflowDocument(parsed);
        return {source,...inspected,...(download_url?{download_url}:{}),...(download_url&&inspected.format==='ui'?{next_step:'Download download_url with Harness native coding tools to a local JSON copy, then inspect its nodes, links and installed schemas to adapt an API graph. The saved file is a UI canvas, so it cannot be submitted as an API graph directly.'}:{})};
      }
      throw new Error('action must be list, inspect, or schema.');
    },
  };
}

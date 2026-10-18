import {validateWorkflowPreflight} from './workflow-preflight.mjs';

const checkedTypes=new Set(['MiniMaxH3MotionContext','VHS_LoadVideo']);
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isLink=value=>Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1])&&value[1]>=0;
const definitions=schema=>({...schema?.input?.required,...schema?.input?.optional});
const limitations=[
  'Checks proven output dependencies for cycles, required inputs for installed MotionContext/VHS_LoadVideo, and server visibility of relative VHS video files. Other custom required inputs are left to ComfyUI.',
  'Unknown or dynamic interfaces can leave dependency coverage incomplete. Disconnected nodes are not rejected. File visibility does not prove decoding, custom validation, model availability, memory or execution success.',
];

// VHS resolves an unannotated path under input; its dropdown is not exhaustive.
// /view cannot equivalently check absolute paths or basenames containing "..".
function videoLocation(value){
  if(typeof value!=='string')return null;
  const annotation=/ \[(input|output|temp)\]$/.exec(value);
  const path=(annotation?value.slice(0,annotation.index):value).replaceAll('\\','/');
  if(!path||path.startsWith('/')||/^[A-Za-z]:/.test(path)||path.split('/').includes('..'))return null;
  const slash=path.lastIndexOf('/'),filename=path.slice(slash+1);
  if(filename.includes('..'))return null;
  return {filename,subfolder:slash<0?'':path.slice(0,slash),type:annotation?.[1]??'input',path};
}

export async function validateLiveWorkflow(graph,{fetchImpl,comfyBaseUrl,signal,partialExecutionTargets}){
  const schemas={},issues=[],warnings=[],unavailable=[];
  let complete=true;
  const result=(checked=[],active=[])=>({issues,warnings,checked_node_types:checked,limitations,complete,coverage:{active_node_ids:active,unavailable_node_types:unavailable}});
  const entries=Object.entries(graph);
  if(!entries.some(([,node])=>checkedTypes.has(node?.class_type)))return result();

  // All installed output flags are needed to distinguish active branches from
  // scratch nodes. These targeted responses remain internal to this check.
  const requestedTypes=[...new Set(entries.map(([,node])=>node?.class_type).filter(type=>typeof type==='string'))];
  const timeoutSignal=()=>signal?AbortSignal.any([signal,AbortSignal.timeout(10_000)]):AbortSignal.timeout(10_000);
  const responses=await Promise.allSettled(requestedTypes.map(async type=>{
    const response=await fetchImpl(`${comfyBaseUrl}/object_info/${encodeURIComponent(type)}`,{signal:timeoutSignal()});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const body=await response.json();
    if(!isRecord(body?.[type])||!isRecord(body[type].input))throw Error('input schema unavailable');
    return body[type];
  }));
  responses.forEach((response,index)=>{
    const type=requestedTypes[index];
    if(response.status==='fulfilled')schemas[type]=response.value;
    else{
      complete=false;unavailable.push(type);
      warnings.push(`Cannot establish all dependencies for ${type}: ${response.reason?.message??response.reason}. Its interface and output role remain unverified; inspect /object_info/${type} before assuming the complete workflow is ready.`);
    }
  });

  const roots=entries.filter(([id,node])=>schemas[node?.class_type]?.output_node===true&&(!Array.isArray(partialExecutionTargets)||partialExecutionTargets.includes(id))).map(([id])=>id);
  if(!roots.length){
    complete=false;
    warnings.push('No installed output-node roots were established for this submission. Active dependencies could not be verified; ComfyUI must validate this workflow. No disconnected node is treated as an execution blocker.');
    return result();
  }

  const active=new Set(),pending=[...roots],activeGraph={},validationSchemas={};
  while(pending.length){
    const id=pending.pop();
    if(active.has(id)||!Object.hasOwn(graph,id))continue;
    active.add(id);
    const node=graph[id],schema=schemas[node?.class_type],declared=definitions(schema),inputs={};
    if(!schema){complete=false;activeGraph[id]={...node,inputs};continue;}
    for(const [name,value] of Object.entries(node.inputs??{})){
      if(!Object.hasOwn(declared,name)){
        // A flattened dynamic group needs ComfyUI's expansion semantics. It
        // cannot safely be interpreted as an ordinary advertised socket.
        if(Object.entries(declared).some(([group,definition])=>name.startsWith(`${group}.`)&&typeof definition?.[0]==='string'&&definition[0].startsWith('COMFY_'))){
          complete=false;
          warnings.push(`Node ${id} input ${name} belongs to a dynamic interface; its upstream dependency is not statically verified.`);
        }
        continue;
      }
      inputs[name]=value;
      if(isLink(value)&&declared[name]?.[1]?.rawLink!==true)pending.push(value[0]);
    }
    activeGraph[id]={...node,inputs};
    // Non-target schemas establish dependencies only: do not add required
    // widget or combo policy to unrelated user-defined workflows.
    validationSchemas[node.class_type]=checkedTypes.has(node.class_type)?schema:{input:{optional:Object.fromEntries(Object.entries(declared).map(([name,definition])=>[name,['*',{rawLink:definition?.[1]?.rawLink===true}]]))}};
  }
  const checked=validateWorkflowPreflight(activeGraph,validationSchemas);
  issues.push(...checked.issues);warnings.push(...checked.warnings);

  for(const id of active){
    const node=graph[id];
    if(node?.class_type!=='VHS_LoadVideo'||!schemas[node.class_type])continue;
    const value=node.inputs?.video;
    if(value===undefined)continue; // Reported as a required input above.
    const location=videoLocation(value);
    if(!location){
      complete=false;
      warnings.push(`Node ${id} video cannot be checked equivalently through /view (dynamic, absolute or unsupported path); file existence is left to ComfyUI. Do not infer the server directory from a Python environment name.`);
      continue;
    }
    const {filename,subfolder,type,path}=location;
    const url=`${comfyBaseUrl}/view?${new URLSearchParams({filename,subfolder,type})}`;
    try{
      const response=await fetchImpl(url,{method:'HEAD',signal:timeoutSignal()});
      if([400,403,405].includes(response.status)){
        complete=false;
        warnings.push(`Node ${id} VHS video visibility is unverified: /view returned HTTP ${response.status}, which can reflect endpoint policy rather than an invalid loader path. Verify ${url} with the installed server interface.`);
      }else if(!response.ok){
        if(response.status!==404)complete=false;
        issues.push(`Node ${id} VHS_LoadVideo input video cannot be verified in ComfyUI ${type}: ${path} (HTTP ${response.status}). Check this exact /view URL: ${url}. For a prior output use its history subfolder/filename plus " [output]" and verify type=output; for a local source upload that exact file via /upload/image (multipart field image) and use the returned subfolder/name. Do not guess installation directories or repeat unchanged submission.`);
      }
    }catch(error){
      complete=false;
      issues.push(`Node ${id} VHS_LoadVideo input video check failed: ${error.message}. Verify ${url} with a native HTTP client before retrying.`);
    }
  }
  return result(checked.coverage.checked_node_types,[...active]);
}

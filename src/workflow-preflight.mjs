const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isLink=value=>Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1])&&value[1]>=0;
const dynamicType=type=>typeof type==='string'&&/^COMFY_(?:AUTOGROW|DYNAMIC[A-Z]*)_V\d+$/.test(type);
const nodeLabel=(id,graph)=>`${id} (${graph[id]?.class_type??'unknown node'})`;

function inputDefinitions(schema) {
  return {...(isRecord(schema?.input?.required)?schema.input.required:{}),...(isRecord(schema?.input?.optional)?schema.input.optional:{})};
}

function dependencyCycles(graph, schemas) {
  const edges=new Map();
  for(const [id,node] of Object.entries(graph)) {
    const definitions=inputDefinitions(schemas[node?.class_type]);
    const sources=new Set();
    for(const [name,value] of Object.entries(isRecord(node?.inputs)?node.inputs:{})) {
      // A wrapper containing __value__ is a literal, not a link. rawLink is
      // used by custom flow-control nodes that consume links as data.
      if(isLink(value)&&Object.hasOwn(graph,value[0])&&definitions[name]?.[1]?.rawLink!==true) sources.add(value[0]);
    }
    edges.set(id,[...sources]);
  }
  const state=new Map(),cycles=[];
  for(const root of edges.keys()) {
    if(state.has(root))continue;
    const stack=[{id:root,next:0}],positions=new Map([[root,0]]);
    state.set(root,1);
    let reported=false;
    while(stack.length) {
      const frame=stack.at(-1),sources=edges.get(frame.id);
      if(frame.next>=sources.length) {
        state.set(frame.id,2);positions.delete(frame.id);stack.pop();continue;
      }
      const source=sources[frame.next++];
      if(state.get(source)===1) {
        if(!reported) {
          cycles.push([...stack.slice(positions.get(source)).map(item=>item.id),source]);
          reported=true;
        }
      } else if(!state.has(source)) {
        positions.set(source,stack.length);state.set(source,1);stack.push({id:source,next:0});
      }
    }
  }
  return cycles;
}

/**
 * Read-only, partial validation of an API prompt graph, with object_info
 * entries keyed by class_type. No network, filesystem, or graph mutation.
 * Missing schemas are coverage gaps, never an invented interface error.
 * Combo mismatches are warnings: object_info does not reveal whether a node's
 * VALIDATE_INPUTS overrides the normal enum checks (VHS_LoadVideo does).
 */
export function validateWorkflowPreflight(graph, schemas={}) {
  const issues=[],warnings=[],checked=new Set(),unavailable=new Set(),skipped=[];
  const coverage={
    checked_node_types:[],unavailable_node_types:[],skipped_inputs:skipped,
    limitations:[
      'Partial static validation only; custom validators, runtime values, file availability, socket compatibility and execution success are not established.',
      'Dependency checks cover direct API links in all submitted nodes, including disconnected nodes; runtime-expanded dependencies are not inspected.',
      'Advertised combo choices are advisory because object_info does not expose custom validation overrides.',
    ],
  };
  if(!isRecord(graph)) return {valid:false,issues:['Workflow must be a ComfyUI API graph object.'],warnings,coverage};
  if(!isRecord(schemas))schemas={};
  for(const cycle of dependencyCycles(graph,schemas)) {
    issues.push(`Workflow dependency cycle: ${cycle.map(id=>nodeLabel(id,graph)).join(' -> ')}. An upstream input must not depend on its own downstream result; restore the intended source input rather than deleting a required socket.`);
  }
  for(const [id,node] of Object.entries(graph)) {
    const type=node?.class_type,schema=schemas[type];
    if(!isRecord(schema?.input)) {if(typeof type==='string')unavailable.add(type);continue;}
    checked.add(type);
    const inputs=isRecord(node?.inputs)?node.inputs:{};
    const required=isRecord(schema.input.required)?schema.input.required:{};
    for(const [name,definition] of Object.entries(inputDefinitions(schema))) {
      if(!Array.isArray(definition)||!definition.length||dynamicType(definition[0])) {
        skipped.push({node_id:id,class_type:type,input:name,reason:'dynamic or unrecognized input schema'});continue;
      }
      if(!Object.hasOwn(inputs,name)) {
        if(Object.hasOwn(required,name)) issues.push(`node ${id} (${type}) is missing required input ${name}; restore it using the installed node interface. A schema default does not supply a missing API input.`);
        continue;
      }
      const value=inputs[name],options=definition[1]??{};
      if(isLink(value))continue;
      const choices=Array.isArray(definition[0])?definition[0]:definition[0]==='COMBO'&&Array.isArray(options.options)?options.options:undefined;
      if(!choices)continue;
      const literal=isRecord(value)&&Object.hasOwn(value,'__value__')?value.__value__:value;
      const values=options.multiselect===true&&Array.isArray(literal)?literal:[literal];
      const invalid=values.filter(item=>!choices.some(choice=>Object.is(choice,item)));
      if(invalid.length) {
        const sample=choices.slice(0,5);
        warnings.push(`node ${id} (${type}) input ${name}: ${JSON.stringify(invalid)} not in the advertised choices (${choices.length} choices; sample ${JSON.stringify(sample)}). Verify the installed node's custom validation or resolve the media path; this list alone does not prove the value is invalid.`);
      }
    }
  }
  coverage.checked_node_types=[...checked].sort();coverage.unavailable_node_types=[...unavailable].sort();
  return {valid:issues.length===0,issues,warnings,coverage};
}

// Offline timing assistance for fresh MiniMax H3 clips; no graph or media edits.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const FPS=24;
const usage='Usage: node h3-timing.mjs --shots 5.5,3 [--shots 5.208,4 ...]\nOne --shots per fresh independent H3 clip, positive seconds per shot. Fixed 24 fps; rounds up and adds H3 alignment padding only to the last shot. Outputs JSON; does not modify workflows, submit jobs, or change approvals. Not a latent-context/continuation planner.\n';

function fail(message){throw new Error(`H3 timing: ${message}`);}
function frameCeiling(seconds){
  const raw=seconds*FPS,nearest=Math.round(raw);
  // Only absorb binary floating-point roundoff at an exact frame boundary.
  return Math.max(1,Math.abs(raw-nearest)<=Number.EPSILON*Math.max(1,raw)*8?nearest:Math.ceil(raw));
}

export function compileH3Timing(requests){
  if(!Array.isArray(requests)||requests.length===0)fail('provide one or more clips containing shot seconds');
  const clips=Array.from(requests,(durations,index)=>{
    if(!Array.isArray(durations)||durations.length===0||Array.from(durations).some(s=>typeof s!=='number'||!Number.isFinite(s)||s<=0))fail(`clip ${index+1} needs positive finite shot seconds`);
    const shotFrames=durations.map(frameCeiling);
    const requestedFrames=shotFrames.reduce((sum,n)=>sum+n,0);
    const frames=5+17*Math.ceil((Math.max(5,requestedFrames)-5)/17);
    if(!Number.isSafeInteger(frames)||frames>3600)fail(`clip ${index+1} exceeds the supported 3600-frame input limit after alignment; revise shot seconds or split clips before review`);
    const padding=frames-requestedFrames;
    shotFrames[shotFrames.length-1]+=padding;
    let position=0;
    const shots=shotFrames.map((length,i)=>{
      const start=position;position+=length;
      return {shot_index:i+1,requested_duration_s:durations[i],frames:length,start_frame:start,end_frame_exclusive:position,start_s:start/FPS,end_s:position/FPS,duration_s:length/FPS};
    });
    return {clip_id:`C${index+1}`,requested_duration_s:durations.reduce((sum,n)=>sum+n,0),frames,duration_s:frames/FPS,alignment_padding_frames:padding,shots,warnings:frames<124||frames>362?['Outside the installed H3 node\'s noted trained range of about 124–362 frames; timing arithmetic is not a generation-feasibility guarantee.']:[]};
  });
  const total=clips.reduce((sum,c)=>sum+c.frames,0);
  return {fps:FPS,scope:'Fresh independent H3 clips only, not latent-context overlap or continuation. Review computed durations before approval; no files or workflows changed.',clips,total_frames:total,total_duration_s:total/FPS};
}

export function parseTimingArguments(args){
  if(args.length===0||args.length%2!==0)fail('usage requires --shots followed by comma-separated seconds; use --help');
  const requests=[];
  for(let i=0;i<args.length;i+=2){
    if(args[i]!=='--shots')fail(`unsupported argument ${args[i]}; use --shots or --help`);
    const values=args[i+1].split(',').map(s=>s.trim());
    if(values.some(s=>!/^\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s)))fail('shots must contain comma-separated positive finite seconds');
    requests.push(values.map(Number));
  }
  return requests;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length===1&&args[0]==='--help')process.stdout.write(usage);
    else process.stdout.write(JSON.stringify(compileH3Timing(parseTimingArguments(args)),null,2)+'\n');
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}

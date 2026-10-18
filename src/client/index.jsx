import {MediaCard} from './MediaCard.jsx';
import {GpuStatus,readLiveStatus} from './GpuStatus.jsx';
import {watchSessionWake} from './session-recovery.mjs';
import css from './media.css';
export const name='dsh-director-ui';
export const inject=['slots','conversation','connection','sessions'];
export function apply(ctx){
  ctx.effect(()=>watchSessionWake(ctx.connection),'director foreground recovery');
  ctx.effect(()=>{const style=document.createElement('style');style.dataset.director='media';style.textContent=css;document.head.append(style);return ()=>style.remove();},'director media styles');
  const reviewInject=sessionId=>({sendConfirmation:async text=>{
    if(ctx.connection.state.getSnapshot()!=='connected')throw Error('Reconnect before sending confirmation.');
    const status=await readLiveStatus();
    if(status.blocked||ctx.connection.state.getSnapshot()!=='connected')throw Error('Confirmation cannot be sent while the GPU handoff or connection is unavailable.');
    const conversation=ctx.sessions.scope(sessionId)?.get('conversation');
    if(!conversation)throw Error('This conversation is no longer available.');
    await conversation.send(text);
  }});
  ctx.slots.inject('tool.call.toolview',()=>ctx.slots.register({name:'tool.call.toolview',key:'director_show_media',inject:reviewInject},MediaCard));
  ctx.slots.inject('tool.call.toolview',()=>ctx.slots.register({name:'tool.call.toolview',key:'director_edit_review',inject:reviewInject},MediaCard));
  // Keep Harness's tool tree and its file diff, search, question and image views.
  // Director contributes only its own keyed media/review rows.
  ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({name:'conversation.input.dock',id:'director-gpu-status',order:-10,inject:sessionId=>{
    const scope=ctx.sessions?.scope(sessionId);
    return {shell:scope?ctx.conversation.input.for(scope):ctx.conversation.input.shell?.(sessionId),connection:ctx.connection};
  }},GpuStatus));
}

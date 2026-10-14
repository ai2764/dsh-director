import {MediaCard} from './MediaCard.jsx';
import {ToolTimeline} from './ToolTimeline.jsx';
import {GpuStatus} from './GpuStatus.jsx';
import {watchSessionWake} from './session-recovery.mjs';
import css from './media.css';
export const name='dsh-director-ui';
export const inject=['slots','conversation','connection'];
export function apply(ctx){
  ctx.effect(()=>watchSessionWake(ctx.connection),'director foreground recovery');
  ctx.effect(()=>{const style=document.createElement('style');style.dataset.director='media';style.textContent=css;document.head.append(style);return ()=>style.remove();},'director media styles');
  ctx.slots.inject('tool.call.toolview',()=>ctx.slots.register({name:'tool.call.toolview',key:'director_show_media'},MediaCard));
  ctx.slots.inject('tool.call.toolview',()=>ctx.slots.register({name:'tool.call.toolview',key:'director_edit_review'},MediaCard));
  // Do not redeclare the native toolview/images child slots: they remain owned
  // by the shipped renderer. Our compact node keeps raw logs and uses the
  // Chat owner's authorized image renderer; uninstall restores native views.
  ctx.slots.inject('conversation.chat.node',()=>ctx.slots.register({name:'conversation.chat.node',key:'tool-call',priority:-10},ToolTimeline));
  ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({name:'conversation.input.dock',id:'director-gpu-status',order:-10,inject:sessionId=>({shell:ctx.conversation.input.shell(sessionId),connection:ctx.connection})},GpuStatus));
}

import z from '@deepseek-ai/schemastery';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {apply as registerSubmit} from './submit-comfy-video.mjs';
import {createBundledProvider,createH3GuideStore,createH3GuideTool} from './skills.mjs';
import {createMediaStore} from './media-store.mjs';
import {createMediaTool,createEditReviewTool} from './media-tool.mjs';
import {registerMediaRoute} from './media-route.mjs';
import {createStageImagesTool} from './image-staging.mjs';
import {createGpuStatus,registerGpuStatusRoute} from './gpu-status.mjs';
import {createAssetTool} from './asset-catalog.mjs';

export const name='dsh-director';
export const inject=['tools','jobs','skills','fs','connection','webServer','attachments'];
export const Config=z.object({
  comfyBaseUrl:z.string().default('http://127.0.0.1:8188'),
  llamaSwapBaseUrl:z.string().default('http://127.0.0.1:11435'),
  mediaRoot:z.string().default(join(process.env.DSH_HOME||join(homedir(),'.dsh'),'director-media')),
  skillCacheRoot:z.string().default(join(process.env.DSH_HOME||join(homedir(),'.dsh'),'director-skills'))
});
export async function apply(ctx,config={}){
  for(const key of ['comfyBaseUrl','llamaSwapBaseUrl'])if(config[key]){
    const url=new URL(config[key]);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error(`${key} must be an HTTP(S) origin, not a path or credentials.`);
  }
  const guideStore=createH3GuideStore({cacheRoot:config.skillCacheRoot});
  const provider=await createBundledProvider(undefined,{guideStore});
  ctx.effect(()=>ctx.skills.registerProvider(()=>provider),'director bundled skills');
  // Optional capability: a missing human-question UI must not disable generic
  // Director tools, and model arguments must never stand in for human consent.
  ctx.inject(['tools','userQuestions'],scoped=>{
    scoped.effect(()=>scoped.tools.register(createH3GuideTool({guideStore,userQuestions:scoped.userQuestions})),'director optional H3 guide setup');
  });
  const gpuStatus=createGpuStatus(config);
  registerSubmit(ctx,{...config,onGpuState:value=>gpuStatus.update(value)});
  ctx.effect(()=>registerGpuStatusRoute(ctx,gpuStatus),'director GPU status');
  const store=createMediaStore({root:config.mediaRoot||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'director-media')});
  ctx.effect(()=>ctx.tools.register(createAssetTool({root:join(config.mediaRoot||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'director-media'),'assets'),fs:ctx.fs,attachments:ctx.attachments})),'director asset lookup');
  ctx.effect(()=>ctx.tools.register(createStageImagesTool({root:join(config.mediaRoot||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'director-media'),'staged-images'),fs:ctx.fs,comfyBaseUrl:config.comfyBaseUrl})),'director reference staging');
  const mediaTool=createMediaTool({store,fs:ctx.fs,attachments:ctx.attachments});
  ctx.effect(()=>ctx.tools.register(mediaTool),'director media tool');
  ctx.effect(()=>ctx.tools.register(createEditReviewTool(mediaTool)),'director review edits');
  ctx.effect(()=>registerMediaRoute(ctx,store),'director media route');
}

import {defineTool} from '@deepseek-ai/dsh-tools'
import {realpath} from 'node:fs/promises'

export function installImageTools(ctx,service) {
  ctx.on('tools/pre-execute',(exec,next)=>{
    if(exec.name!=='image_generate')return next()
    if(!exec.agent)return Promise.resolve({kind:'deny',reason:'Image generation requires an Agent workspace'})
    if(ctx.permissionPresets.current(exec.agent.session)==='danger-full-access')return next()
    return Promise.resolve({kind:'ask',reason:'Generate an image in the current workspace using the selected provider. Remote generation may use service credits.'})
  })
  const output={
    schema:{type:'object',additionalProperties:false,properties:{reportJSON:{type:'string',required:true},relativePath:{type:'string'},mime:{type:'string'}}},
    render:(_,value)=>[{type:'text',text:value.reportJSON}],
    presentationMeta:(_,value)=>value.relativePath?{relativePath:value.relativePath,mime:value.mime}:{},
  }
  ctx.tools.register(defineTool({name:'image_providers',description:'List registered image generation providers, current availability, native sizes, output formats and fit capabilities. Provider availability depends on host configuration; no credentials are returned.',parameters:{},output,
    async execute(){return {reportJSON:JSON.stringify(await service.images.list())}}}))
  ctx.tools.register(defineTool({name:'image_generate',description:'Generate an image in the current workspace using a provider from image_providers. Explicitly select a provider when more than one is available; no silent fallback. Requested size and crop/pad policy are handled by that provider. Preserve and report any original image and resize warning returned.',
    parameters:{prompt:{type:'string',required:true},provider:{type:'string'},size:{type:'string',description:'Requested image size, for example 1920x1080. Consult the selected provider capabilities.'},fit:{type:'string',enum:['crop','pad'],description:'Crop to fill or pad to retain the whole image when the provider supports requested-size conversion.'}},output,timeoutMs:600000,
    async execute(args,exec) {
      const cwd=exec.agent?.session.header.cwd
      if(typeof cwd!=='string'||!cwd)throw new Error('Image generation requires an Agent workspace')
      exec.signal?.throwIfAborted()
      const rootLocator=await ctx.fs.resolve('.',{cwd,signal:exec.signal})
      const projectPath=await realpath(ctx.fs.processPath(rootLocator))
      const result=await service.images.generate({...args,projectPath,execution:exec,sessionId:exec.agent.session.id,signal:exec.signal})
      return {reportJSON:JSON.stringify(result),relativePath:result.relativePath,mime:result.mime}
    }}))
}

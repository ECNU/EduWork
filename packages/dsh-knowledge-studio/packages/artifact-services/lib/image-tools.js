import {defineTool} from '@deepseek-ai/dsh-tools'
import {realpath} from 'node:fs/promises'
import {decideWorkspaceWrite} from './tool-permissions.js'

export function installImageTools(ctx,service) {
  ctx.on('tools/pre-execute',(exec,next)=>{
    if(!['image_generate','image_edit'].includes(exec.name))return next()
    return decideWorkspaceWrite(ctx,exec,next,'Generate an image in the current workspace using the selected provider')
  })
  const output={
    schema:{type:'object',additionalProperties:false,properties:{reportJSON:{type:'string',required:true},relativePath:{type:'string'},mime:{type:'string'}}},
    render:(_,value)=>[{type:'text',text:value.reportJSON}],
    presentationMeta:(_,value)=>value.relativePath?{relativePath:value.relativePath,mime:value.mime}:{},
  }
  ctx.tools.register(defineTool({name:'image_providers',description:'List registered image providers, current availability, native sizes, output formats, fit capabilities and edit support. Provider availability depends on host configuration; no credentials are returned.',parameters:{},output,
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
  ctx.tools.register(defineTool({name:'image_edit',description:'Edit existing workspace images using a provider whose image_providers capabilities include edit:true. Supply actual file paths, not descriptions or URLs. Preserve the originals; the result is saved as a new workspace image. A PNG mask is optional and must match the first image dimensions. Never silently regenerate instead of editing.',
    parameters:{prompt:{type:'string',required:true},images:{type:'array',items:{type:'string'},required:true,description:'1–16 workspace image paths; the provider may accept fewer.'},mask:{type:'string',description:'Optional workspace PNG mask path; transparent pixels mark the area to edit.'},provider:{type:'string'},size:{type:'string'},fit:{type:'string',enum:['crop','pad']}},output,timeoutMs:600000,
    async execute(args,exec) {
      const cwd=exec.agent?.session.header.cwd
      if(typeof cwd!=='string'||!cwd)throw new Error('Image editing requires an Agent workspace')
      if(!Array.isArray(args.images)||!args.images.length||args.images.length>16)throw new Error('Image editing requires 1–16 workspace image paths')
      exec.signal?.throwIfAborted()
      const locate=async path=>ctx.fs.processPath(await ctx.fs.resolve(path,{cwd,signal:exec.signal}))
      const projectPath=await realpath(await locate('.'))
      const images=await Promise.all(args.images.map(locate)),mask=args.mask===undefined?undefined:await locate(args.mask)
      const result=await service.images.edit({...args,images,mask,projectPath,execution:exec,sessionId:exec.agent.session.id,signal:exec.signal})
      return {reportJSON:JSON.stringify(result),relativePath:result.relativePath,mime:result.mime}
    }}))
}

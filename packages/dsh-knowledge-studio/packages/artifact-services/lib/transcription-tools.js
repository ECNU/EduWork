import {defineTool} from '@deepseek-ai/dsh-tools'
import {realpath} from 'node:fs/promises'
import {assertWithinWorkspace,createMediaJobDirectory} from './media-paths.js'
import {transcriptionInput} from './transcription.js'

export function installTranscriptionTools(ctx,service) {
  // The DSH tool boundary owns approval. The shared service never prompts again.
  ctx.on('tools/pre-execute',(exec,next)=>{
    if(exec.name!=='speech_transcribe')return next()
    if(!exec.agent)return Promise.resolve({kind:'deny',reason:'Transcription requires an Agent workspace'})
    if(ctx.permissionPresets.current(exec.agent.session)==='danger-full-access')return next()
    return Promise.resolve({kind:'ask',reason:'Transcribe the selected workspace audio file. A remote provider uploads the file and may use its service quota.'})
  })
  const output={schema:{type:'object',additionalProperties:false,properties:{reportJSON:{type:'string',required:true}}},render:(_,value)=>[{type:'text',text:value.reportJSON}]}
  ctx.tools.register(defineTool({name:'speech_transcription_providers',description:'List configured audio-file transcription providers, readiness and timestamp support. Local engines/models are installed only by the host on request; no automatic download or remote fallback.',parameters:{},output,
    async execute(){return {reportJSON:JSON.stringify(await service.transcription.list())}}}))
  ctx.tools.register(defineTool({name:'speech_transcribe',description:'Transcribe an existing workspace audio file with an explicitly selected provider from speech_transcription_providers. Returns text and optional segment times in seconds. Remote providers upload this file; no automatic provider fallback. Does not capture a microphone.',
    parameters:{input_path:{type:'string',required:true},provider:{type:'string',required:true},language:{type:'string'}},output,timeoutMs:1200000,
    async execute(args,exec) {
      const cwd=exec.agent?.session.header.cwd
      if(!cwd)throw new Error('Transcription requires an Agent workspace')
      const rootLocator=await ctx.fs.resolve('.',{cwd,signal:exec.signal})
      const root=await realpath(ctx.fs.processPath(rootLocator))
      const locator=await ctx.fs.resolve(args.input_path,{cwd,signal:exec.signal})
      const input=await transcriptionInput(ctx.fs.processPath(locator))
      assertWithinWorkspace(root,input.path)
      const providers=await service.transcription.list()
      if(!providers.some(item=>item.id===args.provider&&item.available))throw new Error('Transcription provider is not ready; ask the host to configure it')
      const directory=await createMediaJobDirectory(root)
      const result=await service.transcription.transcribe({provider:args.provider,inputPath:input.path,language:args.language,directory,signal:exec.signal,execution:exec,sessionId:exec.agent.session.id})
      return {reportJSON:JSON.stringify(result)}
    }}))
}

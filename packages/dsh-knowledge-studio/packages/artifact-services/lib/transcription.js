import {stat,realpath} from 'node:fs/promises'
import {isAbsolute,extname} from 'node:path'

export const AUDIO_TYPES=Object.freeze({'.wav':'audio/wav','.mp3':'audio/mpeg','.mpga':'audio/mpeg','.mpeg':'audio/mpeg','.m4a':'audio/mp4','.mp4':'audio/mp4','.ogg':'audio/ogg','.flac':'audio/flac','.webm':'audio/webm'})

export async function transcriptionInput(inputPath,maxBytes=100*1024*1024) {
  if(typeof inputPath!=='string'||!isAbsolute(inputPath))throw new Error('Transcription requires an absolute audio file path')
  const path=await realpath(inputPath),info=await stat(path),mime=AUDIO_TYPES[extname(path).toLowerCase()]
  if(!info.isFile()||!info.size||info.size>maxBytes||!mime)throw new Error('Unsupported or oversized audio file')
  return {path,mime,size:info.size}
}

/** Public application API. Providers own engines/configuration; callers own permissions. */
export class TranscriptionService {
  #providers=new Map()
  register(provider) {
    if(!provider||typeof provider.id!=='string'||!provider.id||typeof provider.transcribe!=='function')throw new Error('Invalid transcription provider')
    if(this.#providers.has(provider.id))throw new Error('Duplicate transcription provider')
    this.#providers.set(provider.id,provider)
    return ()=>{if(this.#providers.get(provider.id)===provider)this.#providers.delete(provider.id)}
  }
  async list() {
    return Promise.all([...this.#providers.values()].map(async provider=>{
      let available=true
      try {if(provider.available)available=Boolean(await provider.available())}catch {available=false}
      return {id:provider.id,title:provider.title||provider.id,local:provider.local===true,available,
        timestamps:provider.timestamps===true,...(provider.model?{model:provider.model}:{})}
    }))
  }
  async transcribe(request) {
    request.signal?.throwIfAborted()
    const provider=this.#providers.get(request.provider)
    if(!provider)throw new Error('Transcription provider is unavailable; use speech_transcription_providers')
    if(provider.available&&!await provider.available())throw new Error('Transcription provider is not ready; configure its runtime and model first')
    if(request.language&&!/^[a-z]{2,3}(?:-[a-zA-Z]{2,4})?$/.test(request.language))throw new Error('Invalid transcription language')
    const input=await transcriptionInput(request.inputPath)
    request.signal?.throwIfAborted()
    const result=await provider.transcribe({...request,inputPath:input.path})
    request.signal?.throwIfAborted()
    if(!result||typeof result.text!=='string')throw new Error('Transcription provider returned invalid text')
    const normalized={text:result.text,provider:provider.id}
    if(typeof result.language==='string')normalized.language=result.language
    if(typeof result.model==='string')normalized.model=result.model
    else if(provider.model)normalized.model=provider.model
    if(result.duration!==undefined) {
      if(typeof result.duration!=='number'||!Number.isFinite(result.duration)||result.duration<0)throw new Error('Invalid transcription duration')
      normalized.duration=result.duration
    }
    if(result.segments!==undefined) {
      if(!Array.isArray(result.segments))throw new Error('Invalid transcription segments')
      let previous=-1
      normalized.segments=result.segments.map(segment=>{
        const {start,end,text}=segment
        if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||start<previous||typeof text!=='string')throw new Error('Invalid transcription segment timing')
        previous=start
        return {start,end,text}
      })
    }
    return normalized
  }
}

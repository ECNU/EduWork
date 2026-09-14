import {openAsBlob} from 'node:fs'
import {basename} from 'node:path'
import {transcriptionInput} from './transcription.js'

/** baseURL includes the API prefix (usually /v1). Credentials stay in the host. */
export function createOpenAICompatibleTranscriptionProvider({id='openai-compatible',title='Remote transcription',baseURL,model,getHeaders=async()=>({}),responseFormat='json',maxBytes=25*1024*1024}={}) {
  if(!baseURL||!model)throw new Error('Transcription baseURL and model must be configured by the host')
  const base=new URL(baseURL.endsWith('/')?baseURL:baseURL+'/')
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.hash||base.search)throw new Error('Invalid transcription baseURL')
  if(!['json','verbose_json'].includes(responseFormat))throw new Error('Unsupported transcription response format')
  if(!Number.isSafeInteger(maxBytes)||maxBytes<=0)throw new Error('Invalid transcription upload limit')
  const endpoint=new URL('audio/transcriptions',base)
  return {id,title,model,local:false,timestamps:responseFormat==='verbose_json',
    async transcribe(request) {
      request.signal?.throwIfAborted()
      const input=await transcriptionInput(request.inputPath,maxBytes)
      const body=new FormData()
      body.append('file',await openAsBlob(input.path,{type:input.mime}),basename(input.path))
      body.append('model',model)
      body.append('response_format',responseFormat)
      if(request.language)body.append('language',request.language.split('-')[0])
      try {
        const headers=new Headers(await getHeaders(request))
        // FormData must own its multipart boundary.
        headers.delete('content-type')
        request.signal?.throwIfAborted()
        const response=await fetch(endpoint,{method:'POST',headers,body,signal:request.signal,redirect:'error'})
        if(!response.ok) {
          await response.body?.cancel()
          throw new Error(`Transcription service returned HTTP ${response.status}`)
        }
        const chunks=[];let size=0
        for await(const chunk of response.body) {
          size+=chunk.length
          if(size>4*1024*1024)throw new Error('Transcription response is too large')
          chunks.push(chunk)
        }
        const result=JSON.parse(Buffer.concat(chunks).toString('utf8'))
        return {text:result.text,language:result.language,duration:result.duration,
          ...(responseFormat==='verbose_json'&&Array.isArray(result.segments)?{segments:result.segments}:{}),model}
      } catch(error) {
        request.signal?.throwIfAborted()
        // Never echo vendor error bodies, headers, endpoints or credential failures.
        if(/^Transcription service returned HTTP \d{3}$/.test(error.message))throw error
        throw new Error('Remote transcription failed; check the host provider configuration')
      }
    }}
}

import {spawn} from 'node:child_process'
import {mkdir, writeFile, readFile, appendFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

/** Application API v1. Providers receive the same request regardless of host. */
export class SpeechService {
  #providers = new Map()
  register(provider) {
    if (!provider?.id || typeof provider.voices !== 'function' || typeof provider.synthesize !== 'function') throw new Error('Speech provider requires id, voices and synthesize')
    if (this.#providers.has(provider.id)) throw new Error(`Duplicate speech provider: ${provider.id}`)
    this.#providers.set(provider.id, provider)
    return () => {if (this.#providers.get(provider.id) === provider) this.#providers.delete(provider.id)}
  }
  has(id) {return this.#providers.has(id)}
  async list() {
    return Promise.all([...this.#providers.values()].map(async p => {
      try {
        const voices = await p.voices()
        if (!Array.isArray(voices) || voices.some(v => !v.id || !v.title)) throw new Error('Invalid voice catalog')
        return {id:p.id, title:p.title || p.id, local:!!p.local, available:voices.length>0,
          voices:voices.map(({id,title,language}) => ({id,title,...(language?{language}:{})}))}
      } catch {return {id:p.id,title:p.title || p.id,local:!!p.local,available:false,voices:[],error:'无法读取音色目录'}}
    }))
  }
  async synthesize(request) {
    request.signal?.throwIfAborted()
    const provider = this.#providers.get(request.provider)
    if (!provider) throw new Error(`语音服务不可用：${request.provider}`)
    if (typeof request.text !== 'string' || !request.text.trim()) throw new Error('语音文本不能为空')
    const speed = Number(request.speed ?? 1)
    if (!Number.isFinite(speed) || speed<.25 || speed>4) throw new Error('语速必须在 0.25–4 之间')
    const voices = await provider.voices()
    const chinese=/[\u3400-\u9fff]/u.test(request.text)
    const voice = request.voice || (chinese?voices.find(item=>/^zh(?:-|$)/i.test(item.language||''))?.id:undefined) || voices[0]?.id
    if (!voices.some(v=>v.id===voice)) throw new Error(`音色不可用：${voice || request.provider}`)
    const result = await provider.synthesize({...request,voice,speed,format:request.format || 'wav'})
    request.signal?.throwIfAborted()
    if (!result || typeof result.path !== 'string') throw new Error('语音服务未返回音频文件')
    // The application contract is a real WAV file. Provider estimates do not
    // become subtitle timing, even when a vendor reports an estimated duration.
    const duration=waveDuration(await readFile(result.path))
    return {path:result.path,format:'wav',duration,provider:provider.id,voice,text:request.text}
  }
}

export function waveDuration(buffer) {
  if(buffer.length<44 || buffer.toString('ascii',0,4)!=='RIFF' || buffer.toString('ascii',8,12)!=='WAVE')throw new Error('语音适配器必须返回 WAV 音频')
  let rate=0, bytes=0
  for(let offset=12;offset+8<=buffer.length;) {
    const name=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4)
    if(offset+8+size>buffer.length)throw new Error('WAV 音频不完整')
    if(name==='fmt '&&size<16)throw new Error('WAV 格式头不完整')
    if(name==='fmt ')rate=buffer.readUInt32LE(offset+16)
    if(name==='data')bytes=size
    offset+=8+size+(size%2)
  }
  if(!rate||!bytes)throw new Error('语音输出不是有效 WAV 文件')
  return bytes/rate
}

export function createSystemSpeechProvider() {
  const script=fileURLToPath(new URL('./speech.ps1',import.meta.url))
  let cache, cacheAt=0
  return {id:'system',title:'Windows 本地语音',local:true,
    async voices() {
      if(process.platform!=='win32')throw new Error('当前系统未配置本地语音提供方')
      if(cache && Date.now()-cacheAt<60000)return cache
      cacheAt=Date.now()
      cache=new Promise((resolve,reject)=>{
        const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-ListVoices'],{windowsHide:true})
        let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b)
        child.on('error',reject);child.on('close',code=>{if(code!==0)return reject(new Error(err));try{resolve(JSON.parse(out.replace(/^\uFEFF/,'')))}catch(e){reject(e)}})
      })
      try{return await cache}catch(e){cache=null;throw e}
    },
    async synthesize({text,voice,speed=1,directory,name,signal,format='wav'}) {
      if(format!=='wav')throw new Error('本地语音输出格式为 WAV')
      if(!/^[a-zA-Z0-9_-]+$/.test(name))throw new Error('Invalid speech job name')
      await mkdir(directory,{recursive:true})
      const input=join(directory,name+'.json'),path=join(directory,name+'.wav'),log=join(directory,'speech.log')
      await writeFile(input,JSON.stringify({segments:[{text,voice}],speed}))
      await new Promise((resolve,reject)=>{
        const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-InputJson',input,'-OutputWave',path],{windowsHide:true,signal})
        void appendFile(log,`${new Date().toISOString()} speech PID=${child.pid}\n`)
        let err='';child.stdout.on('data',b=>{void appendFile(log,b)});child.stderr.on('data',b=>{err+=b;void appendFile(log,b)})
        let failed
        child.on('error',error=>{failed=error})
        child.on('close',code=>failed?reject(failed):code===0?resolve():reject(new Error(`语音生成失败：${err.slice(0,600)||code}`)))
      })
      return {path,format:'wav',duration:waveDuration(await readFile(path))}
    },
  }
}

import {spawn} from 'node:child_process'
import {mkdir,mkdtemp,open,readFile,realpath,unlink,writeFile} from 'node:fs/promises'
import {isAbsolute,join} from 'node:path'
import {waveDuration} from './speech-wave.js'

/** Parse say's installed-voice catalog, preserving multiword and localized names. */
export function parseMacVoices(output) {
  const voices=new Map()
  for(const line of output.split(/\r?\n/)) {
    const match=line.match(/^\s*(.+?)\s+([a-z]{2,3}(?:[_-][A-Za-z0-9]+)+)\s+#(?:\s|$)/u)
    if(!match)continue
    const id=match[1].trim(),language=match[2].replaceAll('_','-')
    if(id&&!voices.has(id))voices.set(id,{id,title:id,language})
  }
  return [...voices.values()]
}

/** Internal process boundary. Wait for close, including cancellation escalation. */
export async function runMacSpeechCommand(command,args,{signal,directory,stage='speech'}={}) {
  signal?.throwIfAborted()
  const startedAt=new Date().toISOString()
  let pid,exitCode,stdout='',stderr='',outputBytes=0,startReceipt,killTimer,failed
  try {
    await new Promise((resolve,reject)=>{
      const child=spawn(command,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']})
      pid=child.pid
      if(directory) {
        startReceipt=writeFile(join(directory,stage+'.process.json'),JSON.stringify({pid,startedAt,status:'running'}))
        startReceipt.catch(()=>{})
      }
      const stop=()=>{
        child.kill('SIGTERM')
        killTimer??=setTimeout(()=>child.kill('SIGKILL'),1000)
        killTimer.unref()
      }
      const collect=(text,isError)=>{
        outputBytes+=Buffer.byteLength(text)
        if(outputBytes>1024*1024) {failed??=new Error('系统语音返回内容过大');stop();return}
        if(isError)stderr+=text;else stdout+=text
      }
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8')
      child.stdout.on('data',text=>collect(text,false));child.stderr.on('data',text=>collect(text,true))
      child.once('error',error=>{failed=error})
      child.once('close',code=>{
        exitCode=code;clearTimeout(killTimer);signal?.removeEventListener('abort',stop)
        if(signal?.aborted)reject(signal.reason)
        else if(failed||code!==0)reject(new Error('macOS 系统语音执行失败，请检查系统音色和任务日志'))
        else resolve()
      })
      signal?.addEventListener('abort',stop,{once:true})
      if(signal?.aborted)stop()
    })
    return stdout
  } finally {
    if(directory) {
      await startReceipt
      await writeFile(join(directory,stage+'.stdout.log'),stdout)
      await writeFile(join(directory,stage+'.stderr.log'),stderr)
      await writeFile(join(directory,stage+'.process.json'),JSON.stringify({pid,startedAt,finishedAt:new Date().toISOString(),exitCode,cancelled:Boolean(signal?.aborted)}))
    }
  }
}

/** Used by createSystemSpeechProvider on Darwin. The runner seam is internal. */
export function createMacOSSpeechProvider({run=runMacSpeechCommand}={}) {
  let cache,cacheAt=0
  const voices=async({signal,refresh=false}={})=>{
    signal?.throwIfAborted()
    if(!refresh&&cache&&Date.now()-cacheAt<60000)return cache.map(voice=>({...voice}))
    // Catalog inspection must not stall a settings page indefinitely.
    const timeout=AbortSignal.timeout(15000),cancel=signal?AbortSignal.any([signal,timeout]):timeout
    const output=await run('/usr/bin/say',['-v','?'],{signal:cancel})
    cancel.throwIfAborted()
    const installed=parseMacVoices(output)
    if(!installed.length)throw new Error('未找到 macOS 系统音色，请在系统设置的辅助功能中安装语音')
    cache=installed;cacheAt=Date.now()
    return installed.map(voice=>({...voice}))
  }
  return {id:'system',title:'macOS 本地语音',local:true,voices,
    async synthesize({text,voice,speed=1,directory,name,signal,format='wav'}) {
      signal?.throwIfAborted()
      if(format!=='wav')throw new Error('本地语音输出格式为 WAV')
      if(typeof text!=='string'||!text.trim())throw new Error('语音文本不能为空')
      if(!Number.isFinite(speed)||speed<.25||speed>4)throw new Error('语速必须在 0.25–4 之间')
      if(typeof name!=='string'||!/^[a-zA-Z0-9_-]+$/.test(name))throw new Error('Invalid speech job name')
      if(typeof directory!=='string'||!isAbsolute(directory))throw new Error('本地语音需要绝对输出目录')
      const installed=await voices({signal,refresh:true})
      if(!installed.some(item=>item.id===voice))throw new Error('音色不可用，请刷新 macOS 系统音色后重试')
      if(/[\u3400-\u9fff]/u.test(text)&&!installed.some(item=>/^zh(?:-|$)/i.test(item.language)))throw new Error('请在 macOS 系统设置的辅助功能中安装中文语音后重试')
      signal?.throwIfAborted()
      await mkdir(directory,{recursive:true})
      const root=await realpath(directory),job=await mkdtemp(join(root,'speech-'))
      const input=join(job,'input.txt'),path=join(root,name+'.wav')
      // Reserve the caller's output name without overwriting an existing file.
      const reservation=await open(path,'wx',0o600)
      await reservation.close()
      let completed=false
      try {
        await writeFile(input,text,{encoding:'utf8',flag:'wx',mode:0o600})
        // File input preserves newlines/Unicode and keeps text out of command-line arguments.
        // say writes PCM WAV directly; TTS does not require FFmpeg or a browser.
        await run('/usr/bin/say',['-v',voice,'-r',String(Math.round(175*speed)),
          '-f',input,'-o',path,'--file-format=WAVE','--data-format=LEI16@22050'],{signal,directory:job})
        signal?.throwIfAborted()
        const duration=waveDuration(await readFile(path))
        signal?.throwIfAborted()
        completed=true
        return {path,format:'wav',duration}
      } finally {
        const remove=path=>unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error})
        await Promise.all([remove(input),...(!completed?[remove(path)]:[])])
      }
    },
  }
}

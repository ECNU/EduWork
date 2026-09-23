import {spawn} from 'node:child_process'
import {open,realpath,stat,writeFile} from 'node:fs/promises'
import {isAbsolute,join} from 'node:path'

export async function localFile(path) {
  if(!path||!isAbsolute(path))throw new Error('Configure an absolute local transcription runtime/model path')
  const resolved=await realpath(path)
  if(!(await stat(resolved)).isFile())throw new Error('Local transcription component is unavailable')
  return resolved
}

/** Join the process on cancellation before releasing logs or returning to the caller. */
export async function run(executable,args,directory,stage,signal) {
  signal?.throwIfAborted()
  const out=await open(join(directory,stage+'.stdout.log'),'wx')
  let err
  try {
    err=await open(join(directory,stage+'.stderr.log'),'wx')
    const startedAt=new Date().toISOString()
    let pid,exitCode,startReceipt
    try {await new Promise((resolve,reject)=>{
      const child=spawn(executable,args,{cwd:directory,windowsHide:true,shell:false,signal,stdio:['ignore',out.fd,err.fd]})
      pid=child.pid
      startReceipt=writeFile(join(directory,stage+'.process.json'),JSON.stringify({pid,startedAt,status:'running'}))
      startReceipt.catch(()=>{})
      let failed
      child.once('error',error=>{failed=error})
      child.once('close',code=>{
        exitCode=code
        if(signal?.aborted)reject(signal.reason)
        else if(failed||code!==0)reject(new Error(`Local transcription ${stage} failed; inspect the job logs`))
        else resolve()
      })
    })} finally {await startReceipt;await writeFile(join(directory,stage+'.process.json'),JSON.stringify({pid,startedAt,finishedAt:new Date().toISOString(),exitCode,cancelled:Boolean(signal?.aborted)}))}
  } finally {await out.close();await err?.close()}
}

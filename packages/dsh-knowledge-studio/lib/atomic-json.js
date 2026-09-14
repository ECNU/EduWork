import {mkdir,writeFile,rename,unlink} from 'node:fs/promises'
import {dirname} from 'node:path'
import {randomUUID} from 'node:crypto'
import {setTimeout as sleep} from 'node:timers/promises'

// Rename preserves the previous file on failure. Never unlink the destination
// to work around Windows readers, antivirus or indexing handles.
export async function writeAtomicJSON(path,state,{renameFile=rename,wait=sleep}={}) {
 const temporary=`${path}.${process.pid}.${randomUUID()}.tmp`
 try {
  await mkdir(dirname(path),{recursive:true})
  await writeFile(temporary,JSON.stringify(state,null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'})
  for(let attempt=0;;attempt++) {
   try {await renameFile(temporary,path);break}
   catch(error) {
    if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=7)throw error
    await wait(Math.min(50*2**attempt,400))
   }
  }
 } catch(cause) {
  throw Object.assign(new Error(`Studio 成果记录保存失败（${cause.code||'IO'}），原文件已保留；请稍后重试。`,{cause}),{code:cause.code||'STUDIO_PERSISTENCE',persistenceFailure:true})
 } finally {await unlink(temporary).catch(()=>{})}
}

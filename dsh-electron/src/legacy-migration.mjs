import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, lstat, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const retained = new Set(['sessions', 'attachments', 'storages', 'skills', 'derived', 'settings.yaml', 'memory.sqlite3', 'memory.sqlite3-wal', 'memory.sqlite3-shm', 'session-query-memory.sqlite3', 'session-query-memory.sqlite3-wal', 'session-query-memory.sqlite3-shm'])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function fileDigest(path) { const hash=createHash('sha256'); for await(const chunk of createReadStream(path))hash.update(chunk); return hash.digest('hex') }
const within = (root, path) => { const rel=relative(root,path); return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep) }
const same = (a,b) => process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b

// Resolve the existing ancestor too: health files and destination homes need
// not exist yet, and Windows may spell their parent with an 8.3 alias.
async function canonical(path) {
  path=resolve(path)
  try { return await realpath(path) }
  catch(error) {
    if(error.code!=='ENOENT'||dirname(path)===path)throw error
    return join(await canonical(dirname(path)),basename(path))
  }
}
async function owned(root,path) {
  path=resolve(path)
  const target=await canonical(path)
  if(!within(root,target)) throw Error('Migration path is outside this installation')
  // Inspect the original spelling before accepting its resolved identity.
  // Canonicalizing alone would conceal links inside retained user data.
  for(let current=path;;current=dirname(current)) {
    const info=await lstat(current).catch(e=>{if(e.code==='ENOENT')return null;throw e})
    if(info?.isSymbolicLink()) throw Error('Migration paths must not contain filesystem links')
    if(same(await canonical(current),root))break
    if(dirname(current)===current)throw Error('Migration path is outside this installation')
  }
  return target
}
function argument(argv,key) {
  const hits=argv.flatMap((v,i)=>v===key?[i]:[])
  if(hits.length>1 || (hits.length&&(!argv[hits[0]+1]||argv[hits[0]+1].startsWith('--'))))throw Error('Invalid migration launch arguments')
  return hits.length?argv[hits[0]+1]:undefined
}
export async function readMigrationLaunch({root,settings,argv}) {
  let file=argument(argv,'--eduwork-migration'),health=argument(argv,'--update-health-file')
  if(!file&&!health)return null
  if(!file&&health&&isAbsolute(health)) {
    root=await realpath(root);health=await owned(root,health)
    const rel=relative(join(root,'data/state/updates/transactions'),health).split(sep)
    if(rel.length!==2||rel[0]!==settings.productVersion||rel[1]!=='health.ok')throw Error('Unexpected update health location')
    return {kind:'electron-update-v1',healthFile:health,version:settings.productVersion}
  }
  if(!file||!health||!isAbsolute(file)||!isAbsolute(health))throw Error('Incomplete migration handshake')
  root=await realpath(root)
  file=await owned(root,file);health=await owned(root,health)
  const transactions=join(root,'data','state','updates','transactions')
  if(!within(transactions,resolve(file))||!same(dirname(resolve(file)),dirname(resolve(health)))||relative(dirname(file),file)!=='migration.json'||relative(dirname(health),health)!=='health.ok')throw Error('Unexpected migration handshake location')
  const bytes=await readFile(file)
  if(bytes.length>16384)throw Error('Migration handoff is too large')
  const data=JSON.parse(bytes)
  if(data.schemaVersion!==1||!['legacy-wails-v1','wails-host-v1'].includes(data.kind)||data.version!==settings.productVersion||data.distribution!==settings.distribution||typeof data.sourceHome!=='string'||!isAbsolute(data.sourceHome))throw Error('Migration handoff does not match this release')
  const sourceHome=await owned(root,data.sourceHome)
  const expected=data.kind==='wails-host-v1'?join(root,'data',settings.distribution+'-wails','dsh'):join(root,'data','dsh')
  if(!same(sourceHome,expected))throw Error('Migration handoff does not match this release')
  return {...data,sourceHome,healthFile:health,id:digest(bytes)}
}

async function inventory(root) {
  const files=[], omitted=[]
  async function walk(path,rel) {
    const info=await lstat(path)
    if(info.isSymbolicLink())throw Error('Legacy data contains a link; use an explicit reviewed import')
    if(info.isDirectory()){for(const name of (await readdir(path)).sort())await walk(join(path,name),rel+'/'+name);return}
    if(!info.isFile())throw Error('Unsupported legacy data entry')
    files.push({path:rel,bytes:info.size,sha256:await fileDigest(path)})
  }
  for(const name of (await readdir(root)).sort()) {
    if(retained.has(name))await walk(join(root,name),name)
    else omitted.push(name)
  }
  return {files,omitted}
}

// Called only after the old updater has stopped its application and children.
// The original data is never changed. A fresh destination is atomically
// installed; an interrupted attempt is reusable only under its own receipt.
export async function importLegacyData({root,targetHome,launch,onProgress=()=>{}}) {
  if(!launch)return null
  if(launch.kind==='electron-update-v1')return null
  root=await realpath(root);targetHome=await owned(root,targetHome)
  launch={...launch,sourceHome:await owned(root,launch.sourceHome)}
  if(same(targetHome,launch.sourceHome))throw Error('Migration requires separate source and destination')
  const prior=await lstat(targetHome).catch(e=>{if(e.code==='ENOENT')return null;throw e})
  if(prior) {
    const receipt=await readFile(join(targetHome,'.eduwork-migration.json'),'utf8').then(JSON.parse).catch(()=>null)
    if(receipt?.schemaVersion===1&&receipt.handoffID===launch.id&&receipt.state==='imported') {
      const current=await inventory(launch.sourceHome)
      if(JSON.stringify(current.files)!==JSON.stringify(receipt.files)||JSON.stringify(current.omitted)!==JSON.stringify(receipt.notActivated))throw Error('Legacy data changed after the previous migration attempt; review the existing Electron import before retrying')
      return receipt
    }
    throw Error('Electron data already exists; automatic migration will not merge or overwrite it')
  }
  const source=await inventory(launch.sourceHome)
  await mkdir(dirname(targetHome),{recursive:true})
  const stage=join(dirname(targetHome),'.legacy-import-'+randomUUID())
  await mkdir(stage)
  try {
    for(let i=0;i<source.files.length;i++) {
      const file=source.files[i],destination=join(stage,file.path)
      await mkdir(dirname(destination),{recursive:true})
      await copyFile(join(launch.sourceHome,file.path),destination)
      if(await fileDigest(destination)!==file.sha256)throw Error('Legacy data changed while importing; original data is intact')
      if(i%128===0||i===source.files.length-1)await onProgress({copied:i+1,total:source.files.length})
    }
    const after=await inventory(launch.sourceHome)
    if(JSON.stringify(after)!==JSON.stringify(source))throw Error('Legacy data is still being written; original data is intact')
    const receipt={schemaVersion:1,state:'imported',handoffID:launch.id,sourceHome:launch.sourceHome,version:launch.version,files:source.files,notActivated:source.omitted,credentials:'sign-in-required',createdAt:new Date().toISOString()}
    await writeFile(join(stage,'.eduwork-migration.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600})
    await rename(stage,targetHome)
    return receipt
  } catch(error) {
    // stage was created above with a random name under an authenticated root.
    await rm(stage,{recursive:true,force:true}).catch(()=>{})
    throw error
  }
}
export async function writeMigrationHealth(launch,state,message='') {
  if(!launch)return
  const value=state==='ready'?'ok\n':JSON.stringify({schemaVersion:1,state,message})+'\n'
  const temporary=launch.healthFile+'.'+randomUUID()+'.tmp'
  await writeFile(temporary,value,{mode:0o600})
  await rename(temporary,launch.healthFile)
}

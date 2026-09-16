import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createPrivateKey, sign } from 'node:crypto'
import { loadUserConfig } from '../dsh-host/user-config.mjs'
import { digest, verifiedManifest, validateBundle } from '../dsh-host/content-update-protocol.mjs'

/** Produce immutable, signed content locally; never publish or run skill code. */
export async function createContentUpdate({ config, planFile, keyFile, output }) {
  const source=loadUserConfig(config).contentUpdates
  if(!source)throw Error('配置中没有 contentUpdates 更新源')
  const plan=JSON.parse(await readFile(planFile,'utf8')),base=dirname(resolve(planFile))
  if(Object.keys(plan).some(k=>!['channel','revision','requires','configuration','skills'].includes(k)))throw Error('发行计划含未知字段')
  const components={},bundle={schemaVersion:1}
  if(plan.configuration) {
    components.configuration=plan.configuration.revision
    bundle.configuration=JSON.parse(await readFile(resolve(base,plan.configuration.path),'utf8'))
    loadUserConfig(config,{overlay:bundle.configuration})
  }
  if(plan.skills) {
    components.skills=plan.skills.revision
    const root=resolve(base,plan.skills.path),files=[]
    const walk=async(folder,prefix='')=>{
      for(const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
        if(entry.isSymbolicLink())throw Error('Skills 发行目录不能包含符号链接')
        if(entry.isDirectory())await walk(join(folder,entry.name),prefix+entry.name+'/')
        else if(entry.isFile()) {
          const bytes=await readFile(join(folder,entry.name))
          files.push({path:prefix+entry.name,bytes:bytes.length,sha256:digest(bytes),data:bytes.toString('base64')})
        } else throw Error('Skills 发行目录包含非普通文件')
      }
    }
    await walk(root)
    bundle.skills={entries:plan.skills.entries,files}
  }
  const bytes=Buffer.from(JSON.stringify(bundle)),sha256=digest(bytes),filename=`content-${plan.revision}-${sha256}.json`
  const manifest={schemaVersion:1,publisher:source.publisher,channel:plan.channel,revision:plan.revision,requires:plan.requires,components,
    bundle:{url:`${source.baseURL}/bundles/${filename}`,bytes:bytes.length,sha256}}
  const payload=Buffer.from(JSON.stringify(manifest)),key=createPrivateKey(await readFile(keyFile))
  if(key.asymmetricKeyType!=='ed25519')throw Error('签名私钥必须为 Ed25519')
  const envelope={schemaVersion:1,payload:payload.toString('base64url'),signature:sign(null,payload,key).toString('base64url')}
  verifiedManifest(envelope,source,plan.channel)
  // Dependency intersection is checked by clients. A publisher must state a
  // root requirement at least as strong as each skill's requirements.
  const environment={version:plan.requires.minClient,dshVersion:plan.requires.dsh,capabilities:plan.requires.capabilities}
  for(const platform of plan.requires.platforms??['win32','darwin','linux'])validateBundle(bytes,manifest,{...environment,platform})
  for(const entry of bundle.skills?.entries??[]) {
    if(entry.requires.maxClientExclusive&&entry.requires.maxClientExclusive!==plan.requires.maxClientExclusive)throw Error('技能的客户端上限必须与发行计划一致')
  }
  await mkdir(output,{recursive:false})
  await mkdir(join(output,'bundles'))
  await writeFile(join(output,'bundles',filename),bytes,{flag:'wx'})
  await mkdir(join(output,plan.channel))
  await writeFile(join(output,plan.channel,'latest.json'),JSON.stringify(envelope,null,2)+'\n',{flag:'wx'})
  await writeFile(join(output,'receipt.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'})
  return manifest
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const {values}=parseArgs({options:Object.fromEntries(['config','plan','key','output'].map(name=>[name,{type:'string'}]))})
  if(Object.values(values).length!==4)throw Error('Use --config <eduwork.jsonc> --plan <plan.json> --key <private.pem> --output <new-directory>')
  const receipt=await createContentUpdate({config:values.config,planFile:values.plan,keyFile:values.key,output:resolve(values.output)})
  console.log(JSON.stringify({revision:receipt.revision,components:receipt.components,sha256:receipt.bundle.sha256,bytes:receipt.bundle.bytes}))
}

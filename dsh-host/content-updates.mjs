import { readFile, writeFile, mkdir, rename, readdir, lstat, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadUserConfig } from './user-config.mjs'
import { verifiedManifest, validateBundle, incompatible, fetchContent, digest, CONTENT_LIMIT } from './content-update-protocol.mjs'

async function readJSON(path, fallback) { try { return JSON.parse(await readFile(path,'utf8')) } catch(error) { if(error.code==='ENOENT')return fallback;throw error } }
async function atomic(path,value) {
  await mkdir(dirname(path),{recursive:true})
  const temporary=path+'.'+randomUUID()+'.tmp'
  await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'})
  try { await rename(temporary,path) } finally { await rm(temporary,{force:true}) }
}
async function safeDirectory(path) { await mkdir(path,{recursive:true});if((await lstat(path)).isSymbolicLink())throw Error('内容缓存目录不能是符号链接') }
const reference = value => typeof value==='string' && /^[1-9]\d*-[a-f0-9]{64}$/.test(value)

export function contentCapabilities(identity) {
  const plugins=Object.keys(identity.localPlugins??{}),packages=Object.keys(identity.managedPackages??{})
  return [...plugins.map(name=>'plugin:'+name),...packages.map(name=>'package:'+name)]
}

/** Signed, opt-in publisher content. No installation hooks, npm or binary changes. */
export class ContentUpdates {
  constructor({root,product,configPath,version,distribution,identity,policy='stable',fetchImpl=fetch}) {
    Object.assign(this,{root,product,configPath,version,distribution,identity,policy,fetchImpl})
    this.environment={version,dshVersion:identity.dshVersion,capabilities:contentCapabilities(identity)}
    this.state={schemaVersion:1,active:{},pending:null,trial:null,rejected:[],highest:0}
    this.view={enabled:false,state:'disabled',policy,configurationRevision:0,skillsRevision:0,downloadedBytes:0,totalBytes:0,message:'未配置内容更新源'}
  }
  async init() {
    if(!['stable','development'].includes(this.policy))throw Error('内容更新渠道无效')
    this.source=loadUserConfig(this.configPath).contentUpdates
    if(!this.source||!this.source.configuration&&!this.source.skills)return this
    const scope=digest(JSON.stringify([this.distribution,this.source.publisher,this.source.baseURL,this.source.publicKey]))
    // Installed revisions survive channel changes; changing feeds never downgrades.
    this.store=join(this.root,'data','content-updates',scope)
    await safeDirectory(this.store)
    this.statePath=join(this.store,'state.json')
    try {
      const saved=await readJSON(this.statePath,null)
      if(saved) {
        if(saved.schemaVersion!==1||!Number.isSafeInteger(saved.highest)||saved.highest<0||!Array.isArray(saved.rejected)||!saved.active||Object.keys(saved.active).some(k=>!['configuration','skills'].includes(k))||Object.values(saved.active).some(v=>!reference(v))||saved.pending&&!reference(saved.pending)||saved.trial&&!reference(saved.trial))throw Error('内容更新状态文件无效')
        this.state=saved
      }
      // A previous process never reached desktopReady. Do not loop on its trial.
      if(this.state.trial)await this.rejectTrial('上次内容更新未完成启动，已恢复之前的内容')
    } catch(error) { this.view.message=error.message;this.state={schemaVersion:1,active:{},pending:null,trial:null,rejected:[],highest:0} }
    this.view={...this.view,enabled:true,configuration:this.source.configuration,skills:this.source.skills,configurationRevision:this.source.bundled.configuration??0,skillsRevision:this.source.bundled.skills??0,state:'current',message:this.view.message==='未配置内容更新源'?'':this.view.message}
    return this
  }
  snapshot() { return {...this.view} }
  async save() { await atomic(this.statePath,this.state) }
  async cached(key) {
    if(!reference(key))throw Error('内容缓存标识无效')
    const directory=join(this.store,key)
    if((await lstat(directory)).isSymbolicLink())throw Error('内容缓存不能是符号链接')
    const envelope=await readJSON(join(directory,'manifest.json'))
    const manifest=verifiedManifest(envelope,this.source)
    if(key!==`${manifest.revision}-${manifest.bundle.sha256}`)throw Error('内容缓存身份不一致')
    const reason=incompatible(manifest.requires,this.environment);if(reason)throw Error(reason)
    const bundlePath=join(directory,'bundle.json'),info=await lstat(bundlePath)
    if(!info.isFile()||info.isSymbolicLink()||info.size>CONTENT_LIMIT)throw Error('内容缓存文件无效')
    const bytes=await readFile(bundlePath)
    if(bytes.length>CONTENT_LIMIT)throw Error('内容缓存过大')
    return {directory,manifest,bundle:validateBundle(bytes,manifest,this.environment)}
  }
  async unchangedBundledSkills() {
    const manifest=await readJSON(join(this.root,'RELEASE-MANIFEST.json'),null)
    if(!manifest?.files)throw Error('缺少内置 Skills 校验清单，不能启用在线 Skills')
    const prefix='resources/product/skills/',expected=new Map(manifest.files.filter(f=>f.path.startsWith(prefix)).map(f=>[f.path.slice(prefix.length),f.sha256]))
    if(!expected.size)throw Error('内置 Skills 校验清单为空')
    const walk=async(folder,relative='')=>{
      for(const entry of await readdir(folder,{withFileTypes:true})) {
        const name=relative+entry.name,path=join(folder,entry.name)
        if(entry.isSymbolicLink())throw Error('内置 Skills 存在本地修改，请先保存为个人 Skill')
        if(entry.isDirectory())await walk(path,name+'/')
        else if(!entry.isFile()||expected.get(name)!==digest(await readFile(path)))throw Error('内置 Skills 存在本地修改，请先保存为个人 Skill')
        else expected.delete(name)
      }
    }
    await walk(join(this.product,'skills'))
    if(expected.size)throw Error('内置 Skills 存在本地修改，请先保存为个人 Skill')
  }
  async materialize(key, includeConfiguration, includeSkills) {
    const {directory,manifest,bundle}=await this.cached(key)
    const result={}
    if(includeConfiguration&&bundle.configuration) {
      // Keep relative assets and the user's editable file anchored to the base config.
      loadUserConfig(this.configPath,{overlay:bundle.configuration})
      result.configurationPatch=bundle.configuration;result.configurationRevision=manifest.components.configuration
    }
    if(includeSkills&&bundle.skills) {
      await this.unchangedBundledSkills()
      const skillRoot=join(directory,'skills')
      // Recreate from authenticated bytes so a modified cache is never trusted.
      if(await lstat(skillRoot).catch(()=>null)) {
        if((await lstat(skillRoot)).isSymbolicLink())throw Error('Skills 缓存不能是符号链接')
        await rm(skillRoot,{recursive:true,force:true})
      }
      await mkdir(skillRoot)
      for(const file of bundle.skills.files) {
        const target=join(skillRoot,...file.path.split('/'))
        await mkdir(dirname(target),{recursive:true});await writeFile(target,Buffer.from(file.data,'base64'),{flag:'wx'})
      }
      result.skillRoot=skillRoot;result.skillsRevision=manifest.components.skills
    }
    return result
  }
  async prepare() {
    if(!this.source||!this.view.enabled)return {}
    const selected={...this.state.active}
    // A newer whole-application package supersedes older cached components.
    for(const key of new Set(Object.values(selected))) {
      try {
        const {manifest}=await this.cached(key)
        if(Object.entries(manifest.components).some(([name,rev])=>rev<=(this.source.bundled[name]??0))) {
          for(const name of Object.keys(selected))if(selected[name]===key)delete selected[name]
        }
      } catch {
        for(const name of Object.keys(selected))if(selected[name]===key)delete selected[name]
        this.view.message='缓存内容不可用，已恢复软件内置内容'
      }
    }
    if(this.state.pending) {
      try {
        const pending=await this.cached(this.state.pending)
        if(Object.entries(pending.manifest.components).some(([name,revision])=>revision<(this.source.bundled[name]??0)))throw Error('软件内置内容已更新，已取消旧的待生效内容')
        for(const name of Object.keys(pending.manifest.components))if(pending.manifest.components[name]>(this.source.bundled[name]??0))selected[name]=this.state.pending
        this.state.trial=this.state.pending;await this.save()
      } catch(error) { await this.rejectPending(error.message); return this.prepare() }
    }
    try {
      let result={}
      for(const key of new Set(Object.values(selected)))result={...result,...await this.materialize(key,selected.configuration===key,selected.skills===key)}
      this.selected=selected
      Object.assign(this.view,{configurationRevision:result.configurationRevision??this.source.bundled.configuration??0,skillsRevision:result.skillsRevision??this.source.bundled.skills??0,state:'current'})
      return result
    } catch(error) {
      if(this.state.trial) {await this.rejectTrial(error.message);return this.prepare()}
      // Cached content can outlive its client compatibility range.
      this.view={...this.view,state:'error',message:'已使用内置内容：'+error.message};return {}
    }
  }
  async ready() {
    if(!this.state.trial)return
    const committed={...this.state,active:this.selected,trial:null,pending:null}
    await atomic(this.statePath,committed)
    this.state=committed;this.view.state='current'
  }
  async rejectPending(reason) {
    if(this.state.pending)this.state.rejected=[...new Set([...this.state.rejected,this.state.pending])].slice(-100)
    this.state.pending=null;this.state.trial=null;await this.save()
    this.view={...this.view,state:'error',message:reason}
  }
  async rejectTrial(reason) {await this.rejectPending(reason)}
  async rollback() {
    if(!this.state.trial)return false
    await this.rejectTrial('新版内容未通过启动检查，已回退');return true
  }
  async check() {
    if(!this.view.enabled||this.busy||this.state.pending)return this.snapshot()
    this.busy=true;this.abort=new AbortController();this.view={...this.view,state:'checking',message:''}
    try {
      const bytes=await fetchContent(`${this.source.baseURL}/${this.policy}/latest.json`,100000,{fetchImpl:this.fetchImpl,signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(20000)])})
      const envelope=JSON.parse(bytes.toString('utf8')),manifest=verifiedManifest(envelope,this.source,this.policy)
      const key=`${manifest.revision}-${manifest.bundle.sha256}`
      if(this.state.rejected.includes(key))throw Error('此内容版本未通过启动检查，等待发行方提供修正版本')
      const current=manifest.revision<=this.state.highest||Object.entries(manifest.components).every(([name,revision])=>revision<=this.view[name+'Revision'])
      const reason=incompatible(manifest.requires,this.environment)
      this.offer=current?null:{key,envelope,manifest}
      this.view={...this.view,state:current?'current':reason?'requires_software':'available',latestRevision:manifest.revision,totalBytes:manifest.bundle.bytes,downloadedBytes:0,message:reason??''}
    } catch(error) {this.view={...this.view,state:'error',message:error.message}}
    finally {this.busy=false}
    return this.snapshot()
  }
  async download() {
    if(this.busy||this.view.state!=='available'||!this.offer)return this.snapshot()
    this.busy=true;this.abort=new AbortController();this.view={...this.view,state:'downloading',message:'',downloadedBytes:0}
    const {key,envelope,manifest}=this.offer
    const temporary=join(this.store,'.stage-'+randomUUID())
    try {
      const bytes=await fetchContent(manifest.bundle.url,manifest.bundle.bytes,{fetchImpl:this.fetchImpl,signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(60000)]),onProgress:n=>{this.view.downloadedBytes=n}})
      const bundle=validateBundle(bytes,manifest,this.environment)
      if(bundle.skills)await this.unchangedBundledSkills()
      for(const [name,revision] of Object.entries(manifest.components)) {
        if(revision<=this.view[name+'Revision'])throw Error('包内每个组件的修订号都必须递增；未变组件请不要重复发布')
        const active=this.state.active[name]
        if(active&&(await this.cached(active)).manifest.components[name]>revision)throw Error('内容组件修订号不能倒退')
      }
      await mkdir(temporary)
      await writeFile(join(temporary,'bundle.json'),bytes,{flag:'wx'})
      await writeFile(join(temporary,'manifest.json'),JSON.stringify(envelope),{flag:'wx'})
      if(bundle.configuration)loadUserConfig(this.configPath,{overlay:bundle.configuration})
      const target=join(this.store,key)
      if(await lstat(target).catch(()=>null))await this.cached(key)
      else await rename(temporary,target)
      this.state.pending=key;this.state.highest=manifest.revision;await this.save()
      this.view={...this.view,state:'ready',message:'已下载并校验，下次启动生效'}
    } catch(error) {this.view={...this.view,state:'error',message:error.message}}
    finally {await rm(temporary,{recursive:true,force:true});this.busy=false}
    return this.snapshot()
  }
  async close() {this.abort?.abort()}
  async selectPolicy(policy) {
    if(!['stable','development'].includes(policy))throw Error('内容更新渠道无效')
    if(this.busy||this.state.pending)throw Error('请先完成当前内容更新再切换渠道')
    if(policy===this.policy)return
    this.policy=policy;this.offer=null
    this.view={...this.view,policy,state:this.view.enabled?'current':'disabled',message:''}
  }
}

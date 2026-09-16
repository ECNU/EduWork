import { createHash, createPublicKey, verify } from 'node:crypto'

export const CONTENT_LIMIT = 16 * 1024 * 1024
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(value)
export function contentUpdateSource(value) {
  if (value === undefined) return null
  if (!object(value) || Object.keys(value).some(key => !['publisher', 'baseURL', 'publicKey', 'configuration', 'skills', 'bundled'].includes(key))) throw Error('contentUpdates 配置无效')
  if (!id(value.publisher)) throw Error('contentUpdates.publisher 无效')
  const url = new URL(value.baseURL)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('内容更新源必须是无凭据的 HTTPS 地址')
  const key = createPublicKey(value.publicKey)
  if (key.asymmetricKeyType !== 'ed25519') throw Error('内容更新公钥必须为 Ed25519')
  for (const name of ['configuration', 'skills']) if (value[name] !== undefined && typeof value[name] !== 'boolean') throw Error(`contentUpdates.${name} 必须为布尔值`)
  const bundled=value.bundled??{}
  if(!object(bundled)||Object.keys(bundled).some(key=>!['configuration','skills'].includes(key))||Object.values(bundled).some(rev=>!Number.isSafeInteger(rev)||rev<0))throw Error('内置内容修订号无效')
  return { publisher: value.publisher, baseURL: url.href.replace(/\/$/, ''), publicKey: key.export({type:'spki',format:'pem'}), configuration: value.configuration === true, skills: value.skills === true, bundled }
}
function version(value) {
  if(typeof value!=='string')throw Error('内容依赖中的版本号无效')
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value ?? '')
  if (!match || match[4]?.split('.').some(part => /^0\d+$/.test(part))) throw Error('内容依赖中的版本号无效')
  return { main: match.slice(1,4).map(BigInt), pre: match[4]?.split('.') }
}
export function compareVersions(a, b) {
  const x=version(a), y=version(b)
  for(let i=0;i<3;i++) if(x.main[i]!==y.main[i]) return x.main[i]>y.main[i]?1:-1
  if(!x.pre || !y.pre) return x.pre? -1:y.pre?1:0
  for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++) {
    const l=x.pre[i],r=y.pre[i];if(l===r)continue
    if(l===undefined)return -1;if(r===undefined)return 1
    const ln=/^\d+$/.test(l),rn=/^\d+$/.test(r)
    if(ln&&rn)return BigInt(l)>BigInt(r)?1:-1
    if(ln!==rn)return ln?-1:1
    return l>r?1:-1
  }
  return 0
}
export function validateRequirements(requires) {
  if (!object(requires) || Object.keys(requires).some(k=>!['minClient','maxClientExclusive','dsh','capabilities','platforms'].includes(k)) || !requires.minClient || !Array.isArray(requires.capabilities) || requires.capabilities.some(v=>typeof v!=='string'||!v.length||v.length>160)) throw Error('必须声明客户端版本和所需能力，且不得包含未知依赖字段')
  version(requires.minClient)
  if (requires.maxClientExclusive!==undefined) { version(requires.maxClientExclusive); if(compareVersions(requires.minClient,requires.maxClientExclusive)>=0)throw Error('客户端兼容范围为空') }
  if(requires.dsh!==undefined)version(requires.dsh)
  if(requires.platforms!==undefined&&(!Array.isArray(requires.platforms)||!requires.platforms.length||requires.platforms.some(p=>!['win32','darwin','linux'].includes(p))))throw Error('内容依赖的平台声明无效')
  return requires
}
export function incompatible(requires, {version:current, dshVersion, capabilities=[],platform=process.platform}) {
  validateRequirements(requires)
  if(compareVersions(current,requires.minClient)<0 || requires.maxClientExclusive&&compareVersions(current,requires.maxClientExclusive)>=0) return '需要兼容的客户端版本'
  if(requires.dsh && requires.dsh!==dshVersion)return '需要匹配的 DSH 版本'
  if(requires.platforms&&!requires.platforms.includes(platform))return '此内容不支持当前操作系统'
  if(requires.capabilities.some(name=>!capabilities.includes(name)))return '客户端缺少此 Skills 包需要的工具能力'
  return null
}
export function trustedBundleURL(source, target) {
  const url=new URL(target),base=new URL(source.baseURL+'/')
  if(url.protocol!=='https:'||url.origin!==base.origin||url.username||url.password||url.search||url.hash||!url.pathname.startsWith(base.pathname))throw Error('内容包不在配置的更新源内')
  return url.href
}
export function verifiedManifest(envelope, source, channel) {
  if(!object(envelope)||envelope.schemaVersion!==1||typeof envelope.payload!=='string'||envelope.payload.length>65536||typeof envelope.signature!=='string')throw Error('内容清单格式无效')
  const payload=Buffer.from(envelope.payload,'base64url'),signature=Buffer.from(envelope.signature,'base64url')
  if(!verify(null,payload,source.publicKey,signature))throw Error('内容更新签名校验失败')
  const manifest=JSON.parse(payload.toString('utf8'))
  if(manifest.schemaVersion!==1||manifest.publisher!==source.publisher||(channel&&manifest.channel!==channel)||!['stable','development'].includes(manifest.channel)||!Number.isSafeInteger(manifest.revision)||manifest.revision<1)throw Error('内容发行身份不匹配')
  validateRequirements(manifest.requires)
  if(!object(manifest.components)||Object.keys(manifest.components).some(k=>!['configuration','skills'].includes(k))||!Object.keys(manifest.components).length)throw Error('内容组件声明无效')
  for(const [name,revision] of Object.entries(manifest.components))if(!source[name]||!Number.isSafeInteger(revision)||revision<1)throw Error('此内容组件未获本机配置授权')
  for(const name of ['configuration','skills'])if(source[name]&&manifest.components[name]===undefined)throw Error('最新清单必须包含此更新源管理的所有组件，避免离线用户漏更新')
  const bundle=manifest.bundle
  if(!object(bundle)||!Number.isSafeInteger(bundle.bytes)||bundle.bytes<2||bundle.bytes>CONTENT_LIMIT||!/^[a-f0-9]{64}$/.test(bundle.sha256))throw Error('内容包摘要或大小无效')
  trustedBundleURL(source,bundle.url)
  return manifest
}
export function safeContentPath(value) {
  if(typeof value!=='string'||value.length>400||value.normalize('NFC')!==value||/[\\:\x00-\x1f]/.test(value)||value.startsWith('/'))throw Error('Skills 文件路径无效')
  for(const part of value.split('/'))if(!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)||['node_modules','.git'].includes(part.toLowerCase()))throw Error('Skills 文件路径无效')
  if(/\.(?:exe|dll|node|so|dylib|msi|app)$/i.test(value))throw Error('Skills 内容包不能携带程序或运行时')
  return value
}
export function validateBundle(bytes, manifest, environment) {
  if(bytes.length!==manifest.bundle.bytes||digest(bytes)!==manifest.bundle.sha256)throw Error('内容包大小或摘要校验失败')
  const bundle=JSON.parse(bytes.toString('utf8'))
  if(!object(bundle)||bundle.schemaVersion!==1||Object.keys(bundle).some(k=>!['schemaVersion','configuration','skills'].includes(k)))throw Error('内容包结构无效')
  for(const name of ['configuration','skills'])if((bundle[name]!==undefined)!==(manifest.components[name]!==undefined))throw Error('内容组件与清单不一致')
  if(bundle.configuration!==undefined) {
    if(!object(bundle.configuration)||!Object.keys(bundle.configuration).length||Object.keys(bundle.configuration).some(k=>!['organizations','features','media'].includes(k)))throw Error('配置更新只能修改机构目录、功能开关和媒体服务')
    if(Buffer.byteLength(JSON.stringify(bundle.configuration))>1024*1024)throw Error('配置更新超过 1 MiB')
  }
  if(bundle.skills!==undefined) {
    const {entries,files}=bundle.skills
    if(!Array.isArray(entries)||!entries.length||entries.length>100||!Array.isArray(files)||files.length>2000)throw Error('Skills 包目录无效')
    const paths=new Set(),names=new Set()
    let total=0
    for(const file of files) {
      safeContentPath(file.path)
      const path=file.path.toLowerCase()
      if(paths.has(path)||typeof file.data!=='string')throw Error('Skills 文件重复或内容无效')
      paths.add(path)
      const data=Buffer.from(file.data,'base64')
      if(data.toString('base64')!==file.data||data.length!==file.bytes||digest(data)!==file.sha256)throw Error('Skills 文件校验失败')
      total+=data.length
      if(total>CONTENT_LIMIT)throw Error('Skills 包过大')
    }
    for(const entry of entries) {
      if(!id(entry.name)||names.has(entry.name.toLowerCase())||!paths.has(entry.name.toLowerCase()+'/skill.md'))throw Error('Skill 名称或入口无效')
      names.add(entry.name.toLowerCase())
      const why=incompatible(entry.requires,environment);if(why)throw Error(why)
    }
    // References can be shared; unlisted skill entry points cannot be injected.
    for(const file of files)if(/(?:^|\/)skill\.md$/i.test(file.path)&&!names.has(file.path.slice(0,-9).toLowerCase()))throw Error('Skills 包包含未声明的技能入口')
  }
  return bundle
}

export async function fetchContent(url, limit, {fetchImpl=fetch,signal,onProgress}={}) {
  const response=await fetchImpl(url,{redirect:'error',signal,headers:{'Cache-Control':'no-cache'}})
  if(!response.ok)throw Error(`内容更新服务返回 ${response.status}`)
  if(Number(response.headers.get('content-length'))>limit)throw Error('内容下载超出大小限制')
  const chunks=[];let size=0
  for await(const part of response.body) { size+=part.length;if(size>limit)throw Error('内容下载超出大小限制');chunks.push(Buffer.from(part));onProgress?.(size) }
  return Buffer.concat(chunks)
}

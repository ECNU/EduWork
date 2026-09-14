import {createRequire} from 'node:module'
import {dirname,join,isAbsolute,relative} from 'node:path'
import {realpath,readFile,stat} from 'node:fs/promises'
import {defaultMusicRoot} from './music.js'

/** Resolve dependencies without preparing a browser (e.g. for FFmpeg posters). */
async function resolveMediaDependencies({bgmRoot=defaultMusicRoot,signal,environment=process.env}={}) {
  signal?.throwIfAborted()
  const configured=environment.DSH_MEDIA_NODE_ENV || environment.ECNU_AGENT_NODE_ENV
  const browserPath=environment.DSH_MEDIA_BROWSER || environment.ECNU_AGENT_REMOTION_BROWSER
  if(configured || browserPath) {
    if(!configured || !browserPath || !isAbsolute(configured) || !isAbsolute(browserPath))throw new Error('Managed media runtime requires absolute environment and browser paths')
    const nodeEnv=await realpath(configured),browserExecutable=await realpath(browserPath)
    if(!(await stat(browserExecutable)).isFile())throw new Error('Managed media browser is unavailable')
    const nodeModules=await realpath(join(nodeEnv,'node_modules'))
    const rel=relative(nodeEnv,nodeModules)
    if(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw new Error('Managed media modules escape the runtime')
    const managedRequire=createRequire(join(nodeEnv,'package.json'))
    const expected={'remotion':'4.0.520','@remotion/bundler':'4.0.520','@remotion/renderer':'4.0.520','@remotion/media':'4.0.520','@remotion/captions':'4.0.520','mediabunny':'1.55.5','react':'18.3.1','react-dom':'18.3.1'}
    for(const [name,version] of Object.entries(expected)) {
      const manifest=JSON.parse(await readFile(join(nodeModules,name,'package.json'),'utf8'))
      if(manifest.version!==version)throw new Error(`Managed media version mismatch: ${name}@${manifest.version}; expected ${version}`)
    }
    signal?.throwIfAborted()
    return {managedRequire,nodeModules,nodeEnv,browserExecutable,bgmRoot,signal}
  }
  const managedRequire=createRequire(import.meta.url)
  const nodeModules=dirname(dirname(managedRequire.resolve('remotion/package.json')))
  return {managedRequire,nodeModules,nodeEnv:dirname(nodeModules),bgmRoot,signal}
}

/** A deployment can inject its pinned runtime. No project code chooses modules. */
export async function createMediaRuntime(options={}) {
  const runtime=await resolveMediaDependencies(options)
  if(!runtime.browserExecutable) {
    const {ensureBrowser}=runtime.managedRequire('@remotion/renderer')
    const browser=await ensureBrowser()
    if(!browser.path)throw new Error('Media render browser is unavailable')
    runtime.browserExecutable=browser.path
  }
  runtime.signal?.throwIfAborted()
  return runtime
}

/** Use FFmpeg from the same dependency owner as rendering, without a download. */
export async function getMediaFFmpegPath({runtime,...options}={}) {
  const dependencies=runtime || await resolveMediaDependencies(options)
  dependencies.signal?.throwIfAborted()
  const {RenderInternals}=dependencies.managedRequire('@remotion/renderer')
  return RenderInternals.getExecutablePath({type:'ffmpeg',indent:false,logLevel:'error',binariesDirectory:null})
}

/** Readiness is read-only: capability discovery must never download a browser. */
export async function inspectMediaRuntime(options={}) {
  try {
    const runtime=await resolveMediaDependencies(options)
    if(!runtime.browserExecutable)return {available:false,reason:'本机媒体渲染浏览器尚未配置，请准备媒体组件。'}
    const ffmpeg=await getMediaFFmpegPath({runtime})
    if(!(await stat(ffmpeg)).isFile())return {available:false,reason:'本机 FFmpeg 尚未准备好。'}
    return {available:true}
  } catch(error) {
    options.signal?.throwIfAborted()
    return {available:false,reason:'本机媒体组件缺失或版本不匹配，请检查运行时配置。'}
  }
}

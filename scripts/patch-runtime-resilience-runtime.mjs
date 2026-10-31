import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Build-time backports to the copied product, never the verified npm cache.
// Each adapter keeps strict anchors; each runtime step also pins the reviewed
// version and the bytes it starts from. See docs/RUNTIME-RESILIENCE-BACKPORT.md.
const sha256 = value => createHash('sha256').update(value).digest('hex')

// Gateways such as LiteLLM reject a request with more images than the model
// accepts ("supports at most 10 image inputs; got 11"). The pi-ai adapter
// reports that as a plain error, so a long chat with pictures stays stuck.
// Map it to IMAGE_OFFLOAD_REQUIRED with the excess count: the shipped
// compaction-image-offload plugin then replaces the oldest images with text
// placeholders and retries.
export function adaptNativeImageLimit(source) {
  const anchor = 'function mapStopReason(message, contextWindow) {\n'
  if (source.split(anchor).length !== 2 || !source.includes('IMAGE_OFFLOAD_REQUIRED_CODE')) throw Error('Native pi-ai stop reason anchor changed')
  return source.replace(anchor, `${anchor}\tconst imageLimit = message.stopReason === "error" && typeof message.errorMessage === "string" ? /supports at most (\\d+) image inputs?\\W+got (\\d+)/i.exec(message.errorMessage) : null;
\tif (imageLimit !== null && Number(imageLimit[2]) > Number(imageLimit[1])) return {
\t\tkind: "error",
\t\tfailure: {
\t\t\tmessage: message.errorMessage,
\t\t\tcode: IMAGE_OFFLOAD_REQUIRED_CODE,
\t\t\toffloadImages: Number(imageLimit[2]) - Number(imageLimit[1])
\t\t}
\t};
`)
}

// Imported sessions whose header id or cwd disagree with their storage path
// abort the whole catalog. Classify those identity failures as corruption so
// the existing catalog boundary omits the one bad session and warns once.
export function adaptNativeSessionIsolation(source) {
  const messages = [
    'requested id "${expectedId}" does not match header id "${meta.id}"',
    'header id cannot name a storage path',
    'header id "${meta.id}" and cwd identify "${expectedPath}"',
  ]
  let result = source
  for (const message of messages) {
    const lines = result.split('\n'), matches = lines.filter(line => line.includes(message) && line.includes('throw new Error('))
    if (matches.length !== 1) throw Error('Unrecognized session identity validation')
    result = result.replace(matches[0], matches[0].replace('throw new Error(', 'throw new SessionPersistenceCorruptionError('))
  }
  // DSH 0.2.1 already maps unsupported/corrupt headers to an omitted catalog
  // entry; add the one-time warning that tells users the original is retained.
  const old = `if (error instanceof SessionFormatUnsupportedError || error instanceof SessionPersistenceCorruptionError) return {
					selected,
					metadata: void 0
				};`
  if (result.split(old).length !== 2) throw Error('Unrecognized session catalog boundary')
  return result.replace(old, `if (error instanceof SessionFormatUnsupportedError || error instanceof SessionPersistenceCorruptionError) {
					if (error instanceof SessionPersistenceCorruptionError) {
						this.catalogCorruptionWarnings ??= new Set();
						if (!this.catalogCorruptionWarnings.has(selected.sourcePath)) {
							this.catalogCorruptionWarnings.add(selected.sourcePath);
							this.ctx.logger.warn('session-persistence: excluded an invalid session from the catalog; original file retained. Back up and inspect its storage path before repair: ' + String(error));
						}
					}
					return { selected, metadata: void 0 };
				}`)
}

// Web boot rejects when any client entry fails, so one broken third-party
// plugin leaves the whole window blank. Keep failing for DSH's own packages;
// skip other entries, log them and show a dismissible notice.
const REQUIRED = '@deepseek-ai/'
export function adaptNativeBootTolerance(source) {
  const anchor = /if\(([\w$]+)\.length>0\)throw new Error\(`web boot: /g
  const matches = [...source.matchAll(anchor)]
  if (matches.length !== 1) throw Error('Native boot audit anchor changed')
  const [match, list] = matches[0]
  const tolerate = `(l=>{const r=l.filter(x=>x.startsWith(${JSON.stringify(REQUIRED)})),s=l.filter(x=>!x.startsWith(${JSON.stringify(REQUIRED)}));` +
    `if(s.length>0){console.error("web boot: skipped entries that did not activate\\n"+s.join("\\n"));` +
    `try{const zh=/^zh/i.test(navigator.language||""),d=document.createElement("div");d.setAttribute("role","alert");` +
    `d.style.cssText="position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;max-width:560px;margin:0 auto;padding:10px 14px;border-radius:10px;background:#3b2a12;color:#fff;font:13px/1.5 system-ui,sans-serif;box-shadow:0 8px 24px #0004;cursor:pointer";` +
    `d.textContent=(zh?"以下插件未能加载，已跳过（点击关闭）：":"These plugins failed to load and were skipped (click to dismiss): ")+s.map(x=>x.split(": ")[0]).join(zh?"、":", ");` +
    `d.onclick=()=>d.remove();(document.body||document.documentElement).appendChild(d)}catch(e){console.error(e)}}return r})(${list})`
  const adapted = source.replace(match, `if(${tolerate}.length>0)throw new Error(\`web boot: `)
  return adapted
}

export const runtimeResiliencePatches = Object.freeze({
  imageLimit: Object.freeze({
    id: 'gateway-image-count-offload-v1', package: '@deepseek-ai/dsh-llm-pi-ai', version: '0.2.1-rc.3', file: 'lib/index.js',
    // Untouched npm bytes, and the same file after the prompt cache key backport.
    beforeSHA256: ['99b5c20830a52f69641df8a18a39206079b0c725201958cce2c4a934f1d4f7cd', '1cdb36b16b7a72e29a9609b52eb07fa6d1325c471f19422cfa40c9431f8b8406'],
    adapt: adaptNativeImageLimit,
  }),
  sessionIsolation: Object.freeze({
    id: 'corrupt-session-catalog-isolation-v1', package: '@deepseek-ai/dsh-session-persistence-jsonl', version: '0.2.1-rc.3', file: 'lib/index.js',
    beforeSHA256: ['973dd78679b2661d6f492343bc22b124ae958aa597d3b36c698a2c650f909984'],
    adapt: adaptNativeSessionIsolation,
  }),
  bootTolerance: Object.freeze({
    id: 'web-boot-optional-entries-v1', package: '@deepseek-ai/dsh-web-frontend', version: '0.2.1-rc.3', file: /^dist\/assets\/index-[\w-]+\.js$/,
    beforeSHA256: ['0f3fc6b857e4f8bd4d69619ce1010240cdaaa443abf0826532a24ef8f6e32ef0'],
    adapt: adaptNativeBootTolerance,
  }),
})

async function patchFile(modules, patch) {
  const root = join(modules, patch.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== patch.package || manifest.version !== patch.version) throw new Error(`${patch.id} requires a newly qualified Runtime`)
  let file = patch.file
  if (file instanceof RegExp) {
    const names = (await readdir(join(root, 'dist/assets'))).map(name => `dist/assets/${name}`).filter(name => file.test(name))
    if (names.length !== 1) throw new Error(`${patch.id} expected one entry bundle`)
    file = names[0]
  }
  const input = await readFile(join(root, file))
  const beforeSHA256 = sha256(input)
  if (!patch.beforeSHA256.includes(beforeSHA256)) throw new Error(`${patch.id} input changed; review or retire the patch for the new Runtime`)
  const output = patch.adapt(input.toString('utf8'))
  await writeFile(join(root, file), output)
  return { id: patch.id, package: patch.package, version: patch.version, file, beforeSHA256, afterSHA256: sha256(output) }
}

export async function patchRuntimeResilience(modules) {
  return Promise.all(Object.values(runtimeResiliencePatches).map(patch => patchFile(modules, patch)))
}

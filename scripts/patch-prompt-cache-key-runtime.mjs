import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// A build-time backport to the copied product, never the verified npm cache.
// Retire this patch when the pinned upstream stops sending prompt_cache_key to
// non-OpenAI OpenAI-compatible endpoints. See docs/PROMPT-CACHE-KEY-BACKPORT.md.
export const promptCacheKeyPatch = Object.freeze({
  id: 'prompt-cache-key-non-openai-v1',
  package: '@deepseek-ai/dsh-llm-pi-ai',
  version: '0.2.1-rc.3',
  file: 'lib/index.js',
  beforeSHA256: '99b5c20830a52f69641df8a18a39206079b0c725201958cce2c4a934f1d4f7cd',
})
// rc.3 ships a byte-identical file; both reviewed versions share the hash.
const reviewedVersions = new Set(['0.2.1-rc.2', '0.2.1-rc.3'])
const sha256 = value => createHash('sha256').update(value).digest('hex')

const site = '\t\tmaxRetries: 0\n\t};\n}\n'
const replacement = '\t\tmaxRetries: 0,\n'
  + '\t\t...profile.cacheRetention === void 0 ? { onPayload: eduworkStripPromptCacheKey } : {}\n'
  + '\t};\n}\n'
  + '/** EduWork backport: non-OpenAI gateways (litellm etc.) reject prompt_cache_key with 400. */\n'
  + 'function eduworkStripPromptCacheKey(payload, model) {\n'
  + '\tif (model?.baseUrl?.includes("api.openai.com")) return void 0;\n'
  + '\tif (payload === null || typeof payload !== "object" || !("prompt_cache_key" in payload)) return void 0;\n'
  + '\tconst { prompt_cache_key: _key, prompt_cache_retention: _retention, ...rest } = payload;\n'
  + '\treturn rest;\n'
  + '}\n'

export function patchPromptCacheKeySource(input) {
  if (sha256(input) !== promptCacheKeyPatch.beforeSHA256) {
    throw new Error('Prompt cache key backport input changed; review or retire the patch for the new Runtime')
  }
  const output = input.toString('utf8')
  if (output.split(site).length !== 2) throw new Error('Unexpected prompt cache key patch site')
  return output.replace(site, replacement)
}

export async function patchPromptCacheKeyRuntime(modules) {
  const root = join(modules, promptCacheKeyPatch.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== promptCacheKeyPatch.package || !reviewedVersions.has(manifest.version)) {
    throw new Error('Prompt cache key backport requires a newly qualified Runtime')
  }
  const path = join(root, promptCacheKeyPatch.file)
  const output = patchPromptCacheKeySource(await readFile(path))
  await writeFile(path, output)
  return { ...promptCacheKeyPatch, version: manifest.version, afterSHA256: sha256(output) }
}

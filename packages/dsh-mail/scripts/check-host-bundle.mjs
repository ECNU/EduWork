import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const publishedRuntimeDependencies = Object.keys(manifest.dependencies ?? {})
if (publishedRuntimeDependencies.length > 0) {
  throw new Error(
    `Host runtime must stay self-contained; move build-only packages to devDependencies instead of publishing runtime dependencies: ${publishedRuntimeDependencies.join(', ')}`,
  )
}

const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
for (const specifier of ['imapflow', 'mailparser', 'nodemailer', 'schemastery', '@deepseek-ai/schemastery']) {
  const bareImport = new RegExp(`(?:from\\s*|import\\s*\\()(['\"])${specifier}(?:/[^'\"]*)?\\1`)
  if (bareImport.test(source)) {
    throw new Error(`Host bundle still depends on external runtime package: ${specifier}`)
  }
}

const module = await import(new URL(`../lib/index.js?bundle-check=${Date.now()}`, import.meta.url))
if (module.name !== 'dsh-mail-assistant' || typeof module.apply !== 'function') {
  throw new Error('Host bundle does not expose the DSH plugin contract.')
}

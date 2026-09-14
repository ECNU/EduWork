import { access, readdir, readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const ignored = new Set(['.git', 'node_modules', 'lib', 'coverage', 'dist'])
const failures = []
const documents = []
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

function isPublished(relativePath) {
  return manifest.files.some(pattern => {
    if (!pattern.includes('*')) return pattern === relativePath
    const [prefix, suffix] = pattern.split('/**/*')
    return suffix !== undefined && relativePath.startsWith(`${prefix}/`) && relativePath.endsWith(suffix)
  })
}

async function walk(directory, relativeDirectory = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const target = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    const relativePath = relativeDirectory === '' ? entry.name : `${relativeDirectory}/${entry.name}`
    if (entry.isDirectory()) { await walk(target, relativePath); continue }
    if (!entry.name.endsWith('.md')) continue
    const content = await readFile(target, 'utf8')
    const localTargets = []
    documents.push({ name: entry.name, relativePath, target, content, localTargets })
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1].trim().replace(/^<|>$/g, '')
      if (href === '' || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue
      const path = decodeURIComponent(href.split('#')[0])
      const resolved = new URL(path, target)
      localTargets.push(decodeURIComponent(resolved.pathname.slice(root.pathname.length)))
      try { await access(resolved) }
      catch { failures.push(`${target.pathname}: missing local link ${href}`) }
    }
  }
}

await walk(root)
for (const document of documents) {
  if (isPublished(document.relativePath)) {
    for (const linkedPath of document.localTargets) {
      if (!isPublished(linkedPath)) failures.push(`${document.target.pathname}: package omits linked file ${linkedPath}`)
    }
  }
  if (document.name.endsWith('.en.md')) {
    const defaultName = document.name.replace(/\.en\.md$/, '.md')
    try { await access(new URL(defaultName, document.target)) }
    catch { failures.push(`${document.target.pathname}: missing Chinese default ${defaultName}`) }
    if (!document.content.includes(`[简体中文](${defaultName})`)) {
      failures.push(`${document.target.pathname}: missing Chinese language entry`)
    }
    continue
  }
  const englishName = document.name.replace(/\.md$/, '.en.md')
  try { await access(new URL(englishName, document.target)) }
  catch { failures.push(`${document.target.pathname}: missing English mirror ${englishName}`) }
  if (!document.content.includes(`[English](${englishName})`)) {
    failures.push(`${document.target.pathname}: missing English language entry`)
  }
  if (!/[\u3400-\u9fff]/u.test(document.content)) {
    failures.push(`${document.target.pathname}: default documentation must be Chinese`)
  }
}
if (failures.length > 0) throw new Error(`Broken documentation links:\n${failures.join('\n')}`)
console.log('Local Markdown links resolve, package links stay inside published files, and every document has a Chinese default plus English mirror.')

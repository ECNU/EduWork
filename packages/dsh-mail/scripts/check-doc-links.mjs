import { access, readdir, readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const ignored = new Set(['.git', '.tmp', 'node_modules', 'lib', 'coverage'])
const failures = []
const documents = []

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const target = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    if (entry.isDirectory()) { await walk(target); continue }
    if (!entry.name.endsWith('.md')) continue
    const content = await readFile(target, 'utf8')
    documents.push({ name: entry.name, target, content })
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1].trim().replace(/^<|>$/g, '')
      if (href === '' || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue
      const path = decodeURIComponent(href.split('#')[0])
      try { await access(new URL(path, target)) }
      catch { failures.push(`${target.pathname}: missing local link ${href}`) }
    }
  }
}

await walk(root)
for (const document of documents) {
  if (document.name.endsWith('.en.md')) {
    const defaultName = document.name.replace(/\.en\.md$/, '.md')
    try { await access(new URL(defaultName, document.target)) }
    catch { failures.push(`${document.target.pathname}: missing Chinese default ${defaultName}`) }
    if (!document.content.includes(`[简体中文](${defaultName})`)) failures.push(`${document.target.pathname}: missing Chinese language entry`)
    continue
  }
  const englishName = document.name.replace(/\.md$/, '.en.md')
  try { await access(new URL(englishName, document.target)) }
  catch { failures.push(`${document.target.pathname}: missing English mirror ${englishName}`) }
  if (!document.content.includes(`[English](${englishName})`)) failures.push(`${document.target.pathname}: missing English language entry`)
  if (!/[\u3400-\u9fff]/u.test(document.content)) failures.push(`${document.target.pathname}: default documentation must be Chinese`)
}
if (failures.length > 0) throw new Error(`Broken documentation links:\n${failures.join('\n')}`)
console.log('Local Markdown links resolve and every document has a Chinese default plus English mirror.')

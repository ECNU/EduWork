import { createHash } from 'node:crypto'
import { scanWorkspace } from './indexer.js'
import { parseDocument, isSupportedPdfPath } from './parser.js'
import { parsePdfBytes } from './pdf.js'
import { tokenize } from './tokenizer.js'

const hash = value => createHash('sha256').update(value).digest('hex')

// Bounded, ephemeral file reads through the host FS. No database or model call.
export async function basicEvidence(fs, workspace, query, { signal, limit = 32, pathPrefix = '' } = {}) {
  const scan = await scanWorkspace(fs, workspace, { signal, maxReadDocuments: 48,
    pathPrefix, maxFiles: 2000, maxTextFileBytes: 256 * 1024, maxPdfFileBytes: 8 * 1024 * 1024 })
  const terms = new Set(tokenize(query))
  const candidates = []
  for (const document of scan.documents) {
    const parsed = document.parsed ?? parseDocument({ path: document.path, text: document.text })
    for (const section of parsed.sections) for (const chunk of section.chunks) {
      const revisionHash = hash(document.text ?? JSON.stringify(parsed))
      const excerptHash = hash(chunk.content)
      const id = hash(`${workspace.id}\0${document.path}\0${revisionHash}\0${chunk.lineStart}\0${chunk.pageStart}\0${excerptHash}`)
      const tokens = new Set(tokenize(`${document.path} ${section.title} ${chunk.content}`))
      candidates.push({ ...chunk, path: document.path, heading: section.title,
        id: `file_${id}`, chunkId: `file_${id}`, evidenceId: `file_${id}`,
        revisionHash, excerptHash, score: [...terms].filter(term => tokens.has(term)).length })
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, limit)
}

// Revalidate a persisted file citation without relying on an ephemeral index.
export async function verifyBasicCitation(fs, workspace, citation) {
  try {
    const root = await fs.resolve(workspace.path)
    const target = await fs.resolve(citation.path, { cwd: workspace.path })
    if (!fs.contains(root, target)) return false
    const stat = await fs.stat(target)
    const pdf = isSupportedPdfPath(citation.path)
    if (stat?.type !== 'file' || stat.size > (pdf ? 8 * 1024 * 1024 : 256 * 1024)) return false
    const text = pdf ? null : await fs.readText(target)
    const parsed = pdf ? await parsePdfBytes({ path: citation.path, bytes: await fs.readBytes(target, undefined, 8 * 1024 * 1024) }) : null
    return hash(text ?? JSON.stringify(parsed)) === citation.revisionHash
  } catch { return false }
}

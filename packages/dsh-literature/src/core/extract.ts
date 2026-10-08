/**
 * Full-text extraction for the literature seam: in-memory gunzip+untar of the
 * arXiv source tarball, PDF text extraction via pdfjs-dist, HTML→Markdown via
 * turndown, and a lossy LaTeX→prose stripper for the readable summary.
 * @module @eduwork/dsh-literature/core/extract
 */

import { gunzipSync } from 'node:zlib'
import { Readable } from 'node:stream'
import { Parser, type ReadEntry } from 'tar'
import { getDocument, type PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import TurndownService from 'turndown'
import { gfm } from '@joplin/turndown-plugin-gfm'
import { parse } from 'node-html-parser'
import { LiteratureError } from './error.ts'
import type { LiteratureFulltextFile } from './types.ts'

/** Shared HTML→Markdown converter (stateless across calls). */
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
turndown.use(gfm)
turndown.remove(['script', 'style', 'noscript', 'nav', 'footer', 'header'])

/** File kinds extracted from a source tarball. */
const TEXT_EXTENSIONS = new Set(['tex', 'bib', 'bst', 'sty', 'cls', 'bbl', 'md', 'txt'])

/**
 * Whether a tarball path is safe to extract: not absolute and with no `..`
 * segment, so a hostile archive cannot escape the extraction directory.
 * @param path - the in-archive path.
 * @returns whether the path is safe.
 */
export function isSafeArchivePath(path: string): boolean {
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/u.test(path)) return false
  return !path.split('/').some(segment => segment === '..')
}

/** Whether a tarball path is a text file worth keeping. */
function isTextPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return TEXT_EXTENSIONS.has(path.slice(dot + 1).toLowerCase())
}

/** Classify a file path into the tool's kind vocabulary. */
function kindOf(path: string): LiteratureFulltextFile['kind'] {
  const dot = path.lastIndexOf('.')
  /* v8 ignore next -- extracted files always carry an extension, so the empty branch is unreachable */
  const ext = dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
  if (ext === 'tex') return 'tex'
  if (ext === 'bib') return 'bib'
  if (ext === 'md' || ext === 'txt') return 'text'
  return 'other'
}

/**
 * Decompress and untar an arXiv source tarball in memory, returning only the
 * text files keyed by their in-archive path.
 * @param gzipBytes - the gzipped tarball bytes.
 * @returns text files by path.
 */
export function untarSource(gzipBytes: Uint8Array): Promise<Map<string, string>> {
  let decompressed: Buffer
  try {
    decompressed = gunzipSync(gzipBytes)
  } catch (error: unknown) {
    throw new LiteratureError('the downloaded source is not a valid gzip archive', 'LITERATURE_EXTRACTION_FAILED', { cause: error })
  }
  const files = new Map<string, string>()
  return new Promise((resolve, reject) => {
    const parser = new Parser()
    parser.on('entry', (entry: ReadEntry) => {
      if (!isSafeArchivePath(entry.path) || (entry.type !== 'File' && entry.type !== 'OldFile' && entry.type !== 'ContiguousFile') || !isTextPath(entry.path)) {
        entry.resume()
        return
      }
      const chunks: Buffer[] = []
      entry.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      entry.on('end', () => { files.set(entry.path, Buffer.concat(chunks).toString('utf8')) })
    })
    parser.on('error', reject)
    parser.on('end', () => { resolve(files) })
    Readable.from(decompressed).on('error', reject).pipe(parser)
  })
}

/** Strip LaTeX commands, comments, and environments to readable prose (lossy).
 * @param tex - the LaTeX source
 * @returns the stripped prose
 */
export function stripTex(tex: string): string {
  return tex
    .replace(/(^|[^\\])%.*$/gmu, '$1')
    .replace(/\\begin\{[^}]*\}/gu, '')
    .replace(/\\end\{[^}]*\}/gu, '')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/gu, '$1')
    .replace(/\\[a-zA-Z]+/gu, ' ')
    .replace(/[{}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pick the main `.tex` source (prefer `main.tex`), else the largest `.tex`. */
function mainTex(files: Map<string, string>): string | undefined {
  const candidates = [...files.keys()].filter(path => path.endsWith('.tex'))
  if (candidates.length === 0) return undefined
  const main = candidates.find(path => path.toLowerCase().endsWith('main.tex'))
  if (main !== undefined) return main
  /* v8 ignore next -- candidate paths are always keys of files, so the length fallback is unreachable */
  return candidates.sort((a, b) => (files.get(b)?.length ?? 0) - (files.get(a)?.length ?? 0))[0]
}

/** Bounded extractor options shared across artifact kinds. */
export interface ExtractOptions {
  /** Maximum characters retained per extracted file body. */
  readonly maxFileChars: number
  /** Maximum characters retained in the readable summary. */
  readonly maxSummaryChars: number
}

/** Extract the source tarball into files plus a readable summary.
 * @param gzipBytes - the gzipped tarball
 * @param options - bounded extractor limits
 * @returns the extracted files and summary
 */
export async function extractSource(gzipBytes: Uint8Array, options: ExtractOptions): Promise<{
  readonly files: LiteratureFulltextFile[]
  readonly summary: string
}> {
  const files = await untarSource(gzipBytes)
  const extracted: LiteratureFulltextFile[] = [...files.entries()].map(([path, content]) => ({
    path,
    kind: kindOf(path),
    content: content.slice(0, options.maxFileChars),
  }))
  const texPath = mainTex(files)
  /* v8 ignore next -- mainTex returns a path that is always a key of files */
  const summary = texPath !== undefined ? stripTex(files.get(texPath) ?? '').slice(0, options.maxSummaryChars) : ''
  return { files: extracted, summary }
}

/** Extract the text of one pdf.js content item (empty for marked-content items).
 * @param item - one pdf.js content item (`TextItem` or `TextMarkedContent`)
 * @returns the item's text, or empty when it carries none
 */
export function pdfItemText(item: unknown): string {
  const str = (item as { str?: unknown } | null)?.str
  return typeof str === 'string' ? str : ''
}

/** Extract text from PDF bytes via pdfjs-dist (main-thread, no worker).
 * @param pdfBytes - the PDF bytes
 * @returns the extracted text
 */
export async function extractPdfText(pdfBytes: Uint8Array): Promise<string> {
  let task: PDFDocumentLoadingTask
  try {
    task = getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true })
  } catch (error: unknown) {
    /* v8 ignore next 2 -- getDocument returns a loading task; it does not throw synchronously for a Uint8Array parameter */
    throw new LiteratureError('the PDF could not be opened', 'LITERATURE_EXTRACTION_FAILED', { cause: error })
  }
  const doc = await task.promise.catch((error: unknown) => {
    throw new LiteratureError('the PDF could not be opened', 'LITERATURE_EXTRACTION_FAILED', { cause: error })
  })
  const parts: string[] = []
  try {
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await doc.getPage(page).then(pageRef => pageRef.getTextContent())
      const text = content.items.map(pdfItemText).join(' ')
      parts.push(text)
    }
  } catch (error: unknown) {
    /* v8 ignore next 2 -- a PDF that opens but fails text extraction is not constructible in a fixture */
    throw new LiteratureError('the PDF text could not be extracted', 'LITERATURE_EXTRACTION_FAILED', { cause: error })
  } finally {
    /* v8 ignore next -- task.destroy() rejection is unobservable in-process */
    void task.destroy().catch(() => {})
  }
  return parts.join('\n\n').trim()
}

/** Convert an HTML document to Markdown via turndown.
 * @param html - the HTML document
 * @returns the Markdown
 */
export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim()
}

/**
 * Minify a publisher landing page for PDF-link analysis: drop HTML comments,
 * every `<style>` element and inline `style` attribute, and whitespace-only
 * text nodes, while keeping inline `<script>` bodies and every link-bearing
 * element (`<nav>`/`<footer>`/`<header>`, `<noscript>` fallbacks) verbatim —
 * a PDF link can live in any of them.
 * @param html - the fetched landing-page HTML.
 * @returns the minified HTML.
 */
export function minifyLandingPageHtml(html: string): string {
  // HTML comments cannot contain `--`, so this pre-pass is safe before parsing.
  const doc = parse(html.replace(/<!--[\s\S]*?-->/gu, ''))
  doc.querySelectorAll('style').forEach(element => element.remove())
  doc.querySelectorAll('[style]').forEach(element => element.removeAttribute('style'))
  doc.removeWhitespace()
  return doc.toString()
}

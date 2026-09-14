import { parsePdfDocument } from './parser.js'

export async function parsePdfBytes({ path, bytes, maxChunkChars = 1200 }) {
  const { extractPdfText } = await import('./pdf-runtime.js')
  const result = await extractPdfText(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  const pages = Array.isArray(result.text) ? result.text : [result.text]
  return parsePdfDocument({ path, pages, maxChunkChars })
}

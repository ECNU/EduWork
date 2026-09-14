import { extractText } from 'unpdf'

export function extractPdfText(bytes: Uint8Array) {
  return extractText(bytes, { mergePages: false })
}

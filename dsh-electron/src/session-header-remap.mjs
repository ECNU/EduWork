import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

// Session logs are concatenated, independently decodable checksummed Zstandard
// frames (dsh-session-persistence-jsonl): the first frame carries the session
// header, later frames carry event batches. The runtime asserts the header cwd
// names the physical project directory, so moving a workspace must rewrite the
// header cwd, not just the directory name. Event frames stay byte-identical.

const ZSTD_MAGIC = 0xFD2FB528
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const SESSION_LOG = /^session\.v\d+\.jsonl(?:\.zstd)?$/u

// End offset of the first complete frame, or -1 when the artifact is torn or
// malformed. Mirrors the persistence backend's frame scan for a single frame.
function firstFrameEnd(buffer) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== ZSTD_MAGIC) return -1
  let offset = 4
  if (offset === buffer.length) return -1
  const descriptor = buffer.readUInt8(offset)
  offset += 1
  if ((descriptor & 24) !== 0) return -1
  const contentSizeFlag = descriptor >>> 6
  const singleSegment = (descriptor & 32) !== 0
  const checksum = (descriptor & 4) !== 0
  const dictionaryFlag = descriptor & 3
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
  const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
  const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
  if (buffer.length - offset < remainingHeaderBytes) return -1
  offset += remainingHeaderBytes
  for (;;) {
    if (buffer.length - offset < 3) return -1
    const blockHeader = buffer.readUIntLE(offset, 3)
    offset += 3
    const lastBlock = (blockHeader & 1) !== 0
    const blockType = (blockHeader >>> 1) & 3
    const blockSize = blockHeader >>> 3
    if (blockType === 3) return -1
    const payloadBytes = blockType === 1 ? 1 : blockSize
    if (buffer.length - offset < payloadBytes) return -1
    offset += payloadBytes
    if (lastBlock) break
  }
  if (checksum) {
    if (buffer.length - offset < 4) return -1
    offset += 4
  }
  return offset
}

// Rewrite the header line's cwd, preserving any remaining lines verbatim.
// Returns null when the first line is not a session header naming oldPath.
function rewriteHeaderText(text, oldPath, newPath) {
  const newline = text.indexOf('\n')
  const firstLine = newline === -1 ? text : text.slice(0, newline)
  let header
  try { header = JSON.parse(firstLine) } catch { return null }
  if (header === null || typeof header !== 'object' || Array.isArray(header)) return null
  if (header.type !== 'session' || header.cwd !== oldPath) return null
  header.cwd = newPath
  return JSON.stringify(header) + (newline === -1 ? '' : text.slice(newline))
}

export function rewriteSessionHeaderCwd(bytes, { compressed, oldPath, newPath }) {
  if (compressed) {
    const end = firstFrameEnd(bytes)
    if (end < 0) return null
    let text
    try { text = zstdDecompressSync(bytes.subarray(0, end)).toString('utf8') } catch { return null }
    const rewritten = rewriteHeaderText(text, oldPath, newPath)
    if (rewritten === null) return null
    return Buffer.concat([zstdCompressSync(Buffer.from(rewritten, 'utf8'), CHECKSUM_OPTIONS), bytes.subarray(end)])
  }
  const rewritten = rewriteHeaderText(bytes.toString('utf8'), oldPath, newPath)
  return rewritten === null ? null : Buffer.from(rewritten, 'utf8')
}

// A project directory holds one subdirectory per session; rewrite each session
// log whose header still names the old workspace path. Unparsable artifacts are
// left untouched so a corrupt source session cannot block the whole import.
export async function remapSessionLogCwd(projectDir, oldPath, newPath) {
  const rewritten = []
  for (const sessionName of await readdir(projectDir)) {
    const sessionDir = join(projectDir, sessionName)
    for (const name of await readdir(sessionDir).catch(() => [])) {
      if (!SESSION_LOG.test(name)) continue
      const path = join(sessionDir, name)
      const bytes = await readFile(path)
      const next = rewriteSessionHeaderCwd(bytes, { compressed: name.endsWith('.zstd'), oldPath, newPath })
      if (next === null) continue
      await writeFile(path, next)
      rewritten.push(`${sessionName}/${name}`)
    }
  }
  return rewritten
}

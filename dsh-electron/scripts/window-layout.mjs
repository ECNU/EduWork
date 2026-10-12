import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

// The frame's viewport is its layout width. A compositor transform must not
// change responsive breakpoints or the preferred width of an open right panel.
export function adaptWindowLayout(source) {
  const before = 'const width = el.getBoundingClientRect().width;'
  const after = 'const width = el.clientWidth;'
  if (source.split(before).length !== 2) throw new Error('Pinned client layout measurement changed; review the window motion adapter')
  return source.replace(before, after)
}

export async function prepareWindowLayout(product, receiptPath) {
  const relative = 'd/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js'
  const path = join(product, relative)
  const before = await readFile(path)
  const after = Buffer.from(adaptWindowLayout(before.toString('utf8')))
  const hash = data => createHash('sha256').update(data).digest('hex')
  await writeFile(path, after)
  await writeFile(receiptPath, JSON.stringify({ schemaVersion: 1, path: relative,
    originalSHA256: hash(before), derivedSHA256: hash(after), reason: 'Measure layout pixels independently of native-window presentation transforms' }, null, 2) + '\n')
}

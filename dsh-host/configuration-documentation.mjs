import * as jsonc from './vendor/jsonc-parser/parser.js'
import { createScanner } from './vendor/jsonc-parser/scanner.js'
import { configurationFields, configurationReference } from './configuration-reference.mjs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function editionConfigurationFields(product) {
  if (!product) return {}
  const text = await readFile(join(product, 'resources/desktop/configuration-options.json'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error })
  if (!text) return {}
  if (Buffer.byteLength(text) > 65536) throw Error('发行配置说明超过大小限制')
  const fields = JSON.parse(text)
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw Error('发行配置说明必须为对象')
  for (const [path, entry] of Object.entries(fields)) {
    if (!/^plugins\.[a-z][a-z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(path) || !Array.isArray(entry) || entry.length !== 2
      || typeof entry[0] !== 'string' || /[\r\n\u0000-\u001f]/.test(entry[0]) || entry[0].length > 1000) throw Error('发行配置说明字段无效')
  }
  return fields
}

export function explicitConfigurationDefaults(value) {
  if (!Array.isArray(value.organizations)) return value
  return { ...value, organizations: value.organizations.map(profile => profile?.schemaVersion === 'dsh-oidc/v1alpha1'
    ? { allowInsecureDevelopment: false, ...profile } : profile) }
}

export function configurationComments(text) {
  const scanner = createScanner(text, false), result = []
  for (let token = scanner.scan(); token !== 17; token = scanner.scan()) {
    if (token === 12 || token === 13) result.push(text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength()))
  }
  return result
}

/** Add help to the actual editable file, including downloaded JSON. No values change. */
export function documentConfiguration(text, extra = {}) {
  // Remove only comments owned by this formatter. User comments and string values survive.
  const scanner = createScanner(text, false), removals = []
  let reference = false
  for (let token = scanner.scan(); token !== 17; token = scanner.scan()) {
    if (token !== 12) continue
    const offset = scanner.getTokenOffset(), length = scanner.getTokenLength(), comment = text.slice(offset, offset + length)
    if (comment === '// <eduwork-configuration-reference>') reference = true
    if (reference || comment.startsWith('// [eduwork] ')) {
      let start = offset, end = offset + length
      while (start > 0 && /[ \t]/.test(text[start - 1])) start--
      if (start === 0 || /[\r\n]/.test(text[start - 1])) { if (text[end] === '\r') end++; if (text[end] === '\n') end++ }
      else start = offset
      removals.push({ start, end })
    }
    if (comment === '// </eduwork-configuration-reference>') reference = false
  }
  for (const { start, end } of removals.reverse()) text = text.slice(0, start) + text.slice(end)
  const prefix = text.startsWith('\uFEFF') ? 1 : 0, errors = []
  const tree = jsonc.parseTree(text.slice(prefix), errors, { allowTrailingComma: true })
  if (errors.length || !tree) throw Error('无法为无效 JSONC 添加配置说明')
  const insertions = [], newline = text.includes('\r\n') ? '\r\n' : '\n'
  function visit(node, path = '', depth = 0) {
    if (node.type === 'object') for (const property of node.children ?? []) {
      const key = property.children[0].value, route = path ? path + '.' + key : key
      const help = (extra[route] ?? configurationFields[route])?.[0]
      if (help) {
        const offset = property.offset + prefix, line = text.lastIndexOf('\n', offset - 1) + 1
        const indentation = text.slice(line, offset), ownLine = /^[ \t]*$/.test(indentation)
        const indent = ownLine ? indentation : '  '.repeat(depth + 1)
        let start = ownLine ? line : offset
        if (!ownLine) while (start > line && /[ \t]/.test(text[start - 1])) start--
        insertions.push({ offset: start, length: ownLine ? 0 : offset - start, value: (ownLine ? '' : newline) + indent + '// [eduwork] ' + help + newline + (ownLine ? '' : indent) })
      }
      visit(property.children[1], route, depth + 1)
    }
    else if (node.type === 'array') for (const item of node.children ?? []) visit(item, path + '[]', depth + 1)
  }
  visit(tree)
  for (const { offset, length, value } of insertions.sort((a, b) => b.offset - a.offset)) text = text.slice(0, offset) + value + text.slice(offset + length)
  return text.trimEnd() + newline + newline + configurationReference(extra).replaceAll('\n', newline)
}

import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import * as jsonc from './vendor/jsonc-parser/parser.js'
import { normalizeMediaConfig } from './media-config.mjs'
import { contentUpdateSource } from './content-update-protocol.mjs'

const allowed = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label}.${key} 不是支持的配置项`)
}
function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || /[\x00-\x1f]/u.test(value)) throw new Error(`${label} 必须是有效文本`)
  return value
}
function within(root, path) {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
}
function logo(path, filename) {
  text(filename, 'product.logoFile', 1024)
  const root = realpathSync(dirname(path)), file = resolve(root, filename)
  if (isAbsolute(filename) || !within(root, file) || !within(root, realpathSync(file))) throw new Error('product.logoFile 必须位于配置目录内')
  const mime = { '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[extname(file).toLowerCase()]
  if (!mime || !statSync(file).isFile() || statSync(file).size > 256 * 1024) throw new Error('Logo 请使用不超过 256 KiB 的 PNG、WebP 或 SVG 文件')
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`
}

/** File-owned settings are read at process startup, never written by the UI. */
export function loadUserConfig(path, { overlay } = {}) {
  path = resolve(path)
  const source = { path, examplesPath: join(dirname(path), 'examples') }
  let body
  try { body = readFileSync(path, 'utf8').replace(/^\uFEFF/u, '') }
  catch (error) { if (error.code === 'ENOENT') body = '{"schemaVersion":1}'; else throw error }
  try {
    if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('配置文件超过 1 MiB')
    const errors = [], tree = jsonc.parseTree(body, errors, { allowTrailingComma: true })
    if (errors.length) {
      const before = body.slice(0, errors[0].offset).split('\n')
      throw new Error(`JSONC 格式错误，第 ${before.length} 行、第 ${before.at(-1).length + 1} 列`)
    }
    function unique(node) {
      if (node?.type === 'object') {
        const seen = new Set()
        for (const property of node.children ?? []) {
          const key = property.children[0].value
          if (seen.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('配置中有重复或不允许的字段')
          seen.add(key)
        }
      }
      for (const child of node?.children ?? []) unique(child)
    }
    unique(tree)
    const original = jsonc.getNodeValue(tree)
    if (overlay) allowed(overlay, ['organizations', 'features', 'media'], '内容配置')
    const value = overlay ? { ...original, ...overlay, features: { ...original.features, ...overlay.features } } : original
    allowed(value, ['schemaVersion', 'product', 'organizations', 'desktop', 'updates', 'features', 'media', 'contentUpdates'], '配置')
    if (value.schemaVersion !== 1) throw new Error('schemaVersion 必须是 1')
    allowed(value.product ?? {}, ['name', 'logoFile'], 'product')
    allowed(value.desktop ?? {}, ['closeAction'], 'desktop')
    const closeAction = value.desktop?.closeAction ?? 'tray'
    if (!['tray', 'exit'].includes(closeAction)) throw new Error('desktop.closeAction 必须为 tray 或 exit')
    const product = {}
    if (value.product?.name !== undefined) product.name = text(value.product.name, 'product.name', 80)
    if (value.product?.logoFile !== undefined) product.logoUrl = value.product.logoFile === '' ? '' : logo(path, value.product.logoFile)
    if (!Array.isArray(value.organizations ?? []) || (value.organizations?.length ?? 0) > 32) throw new Error('organizations 必须是最多含 32 个企业的数组')
    allowed(value.updates ?? {}, ['provider', 'repository', 'manifestURL', 'releasesURL', 'defaultPolicy'], 'updates')
    const updates = {}
    if (value.updates?.provider !== undefined) {
      if (!['github','static','disabled'].includes(value.updates.provider)) throw new Error('updates.provider 必须为 github、static 或 disabled')
      updates.provider = value.updates.provider
    }
    if (value.updates?.repository !== undefined) {
      if (typeof value.updates.repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value.updates.repository)) throw new Error('updates.repository 必须为 owner/repo')
      updates.repository = value.updates.repository
    }
    if (updates.provider === 'github' && value.updates.manifestURL) throw new Error('GitHub 更新源不能同时设置 manifestURL')
    if (updates.provider === 'static' && !value.updates.manifestURL) throw new Error('静态更新源需要 manifestURL')
    if (value.updates?.defaultPolicy !== undefined) {
      if (!['stable', 'development'].includes(value.updates.defaultPolicy)) throw new Error('updates.defaultPolicy 必须为 stable 或 development')
      updates.defaultPolicy = value.updates.defaultPolicy
    }
    allowed(value.features ?? {}, ['visionFallback','maxConcurrentRequests','maxParallelSubagents'], 'features')
    if (value.features?.maxConcurrentRequests !== undefined && (!Number.isSafeInteger(value.features.maxConcurrentRequests) || value.features.maxConcurrentRequests < 1 || value.features.maxConcurrentRequests > 64)) throw new Error('features.maxConcurrentRequests 必须是 1–64 的整数')
    if (value.features?.maxParallelSubagents !== undefined && (!Number.isSafeInteger(value.features.maxParallelSubagents) || value.features.maxParallelSubagents < 1 || value.features.maxParallelSubagents > 32)) throw new Error('features.maxParallelSubagents 必须是 1–32 的整数')
    if (value.features?.visionFallback !== undefined && typeof value.features.visionFallback !== 'boolean') throw new Error('features.visionFallback 必须为 true 或 false')
    for (const key of ['manifestURL', 'releasesURL']) {
      if (!value.updates?.[key]) continue
      const url = new URL(text(value.updates[key], `updates.${key}`, 2048))
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`updates.${key} 必须使用不含凭据的 HTTPS 地址`)
      updates[key] = url.href
    }
    const features = { ...value.features }
    if (features.maxConcurrentRequests === undefined && features.maxParallelSubagents !== undefined) features.maxConcurrentRequests = features.maxParallelSubagents + 1
    return { source, product, organizations: value.organizations ?? [], closeAction, updates, features, contentUpdates: contentUpdateSource(value.contentUpdates),
      ...(value.media !== undefined ? { media: normalizeMediaConfig(value.media) } : {}) }
  } catch (error) {
    throw new Error(`请检查配置文件 ${path}\n${error.message}`, { cause: error })
  }
}

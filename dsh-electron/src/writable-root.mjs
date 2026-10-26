import { constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'

const MARKER = '.eduwork-writable-root.json'
const SCHEMA_VERSION = 1

function readMarker(path) {
  const info = lstatSync(path, { throwIfNoEntry: false })
  if (!info) return null
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`可写数据目录的归属回执不是普通文件：${path}`)
  let marker
  try { marker = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error(`可写数据目录的归属回执无效：${path}`) }
  if (marker?.schemaVersion !== SCHEMA_VERSION || marker.layout !== 'installed' || typeof marker.distribution !== 'string' || !marker.distribution) {
    throw new Error(`可写数据目录的归属回执不匹配：${path}`)
  }
  return marker
}

function desktopTemplate(product) {
  const desktop = join(product, 'resources/desktop')
  const template = join(desktop, 'eduwork.jsonc')
  if (existsSync(template)) return { config: template, examples: join(desktop, 'examples') }
  // A prepared product normally carries resources/desktop. Keep the packaged
  // desktop config as a fallback for shells assembled from an older product.
  const packaged = join(product, '..', '..', 'config')
  const fallback = join(packaged, 'eduwork.jsonc')
  if (existsSync(fallback)) return { config: fallback, examples: join(packaged, 'examples') }
  throw new Error(`安装布局缺少桌面配置模板：${template}`)
}

/**
 * Create the installed-mode writable root (W) atomically and write a receipt.
 * An existing directory without a receipt is never adopted or overwritten.
 */
export function prepareWritableRoot({ root, distribution, product, productVersion, now = () => new Date().toISOString() }) {
  if (typeof distribution !== 'string' || !/^[a-z0-9-]+$/u.test(distribution)) throw new Error('Invalid writable root distribution')
  root = resolve(root)
  product = resolve(product)
  const existing = lstatSync(root, { throwIfNoEntry: false })
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error(`可写数据目录必须是普通目录：${root}`)
    const marker = readMarker(join(root, MARKER))
    if (marker) {
      if (marker.distribution !== distribution) throw new Error(`可写数据目录属于其他发行版：${root}`)
      return { root, created: false, marker }
    }
    if (readdirSync(root).length > 0) {
      throw new Error(`可写数据目录已有数据但缺少归属回执，已停止且未覆盖：${root}`)
    }
  }

  const template = desktopTemplate(product)
  const parent = dirname(root)
  mkdirSync(parent, { recursive: true })
  const temporary = join(parent, `.eduwork-writable-root-${randomUUID()}.tmp`)
  try {
    mkdirSync(temporary)
    const config = join(temporary, 'config')
    mkdirSync(config, { recursive: true })
    copyFileSync(template.config, join(config, 'eduwork.jsonc'), constants.COPYFILE_EXCL)
    if (existsSync(template.examples)) cpSync(template.examples, join(config, 'examples'), { recursive: true, force: false, errorOnExist: false })
    mkdirSync(join(temporary, 'data'), { recursive: true })
    const marker = { schemaVersion: SCHEMA_VERSION, layout: 'installed', distribution, productVersion, createdAt: now() }
    writeFileSync(join(temporary, MARKER), JSON.stringify(marker, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    if (existing) rmdirSync(root)
    renameSync(temporary, root)
    return { root, created: true, marker }
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    throw error
  }
}

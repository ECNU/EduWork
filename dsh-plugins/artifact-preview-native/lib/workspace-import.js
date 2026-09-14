import { chmod, copyFile, lstat, mkdir, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import { COPYFILE_EXCL } from 'node:constants'
import { extname, isAbsolute, join, relative, sep } from 'node:path'

export const MAX_IMPORT_FILES = 20
export const MAX_IMPORT_FILE_BYTES = 64 * 1024 * 1024
export const MAX_IMPORT_TOTAL_BYTES = 128 * 1024 * 1024
export const WORKSPACE_IMPORT_DIRECTORY = '.chatecnu/attachments'

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const GRANT_ID = /^[a-f0-9]{32}$/u

export function safeImportName(value) {
  const source = String(value ?? '').normalize('NFC').split(/[\\/]/u).pop() ?? ''
  let name = source.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/gu, '_').replace(/[. ]+$/u, '').trim()
  if (name === '' || name === '.' || name === '..') name = 'file'
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`
  const detectedExtension = extname(name)
  const extension = detectedExtension.length <= 32 ? detectedExtension : ''
  if (name.length > 140) name = `${name.slice(0, Math.max(1, 140 - extension.length))}${extension}`
  return name
}

export function decodeImportFile(file) {
  if (file === null || typeof file !== 'object' || Array.isArray(file)) throw new Error('文件导入参数无效')
  const bytes = Number(file.bytes)
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_IMPORT_FILE_BYTES) {
    throw new Error('单个文件不能超过 64 MiB')
  }
  if (typeof file.data !== 'string' || !BASE64.test(file.data)) throw new Error('文件内容不是规范 Base64')
  const content = Buffer.from(file.data, 'base64')
  if (content.byteLength !== bytes || content.toString('base64') !== file.data) throw new Error('文件内容长度校验失败')
  return { name: safeImportName(file.name), content, bytes }
}

function contained(root, candidate) {
  const rel = relative(root, candidate)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

function numberedName(name, index) {
  if (index === 1) return name
  const detectedExtension = extname(name)
  const extension = detectedExtension.length <= 32 ? detectedExtension : ''
  const stem = name.slice(0, name.length - extension.length) || 'file'
  const suffix = ` (${index})`
  return `${stem.slice(0, Math.max(1, 140 - extension.length - suffix.length))}${suffix}${extension}`
}

async function workspaceImportDirectory(rootPath) {
  const root = await realpath(rootPath)
  const productDirectory = join(root, '.chatecnu')
  const directory = join(productDirectory, 'attachments')
  for (const candidate of [productDirectory, directory]) {
    try {
      await mkdir(candidate)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    const info = await lstat(candidate)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('工作区附件目录必须是工作区内的普通目录')
  }
  const canonicalDirectory = await realpath(directory)
  if (!contained(root, canonicalDirectory)) throw new Error('工作区附件目录不能指向工作区外部')
  return canonicalDirectory
}

async function publishWorkspaceFiles(rootPath, files) {
  const canonicalDirectory = await workspaceImportDirectory(rootPath)
  const created = []
  try {
    for (const file of files) {
      let index = 1
      while (true) {
        const name = numberedName(file.name, index)
        const target = join(canonicalDirectory, name)
        if (!contained(canonicalDirectory, target)) throw new Error('文件名超出工作区附件目录')
        try {
          await file.publish(target)
          created.push({ target, name, bytes: file.bytes })
          break
        } catch (error) {
          if (error?.code === 'EEXIST') {
            index += 1
            if (index > 9999) throw new Error(`无法为文件“${file.name}”分配可用名称`)
            continue
          }
          throw error
        }
      }
    }
  } catch (error) {
    await Promise.allSettled(created.map(file => rm(file.target, { force: true })))
    throw error
  }

  return created.map(file => ({
    path: `${WORKSPACE_IMPORT_DIRECTORY}/${file.name}`,
    name: file.name,
    bytes: file.bytes,
  }))
}

export async function importWorkspaceFiles(rootPath, files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('请选择需要导入的文件')
  if (files.length > MAX_IMPORT_FILES) throw new Error(`一次最多导入 ${MAX_IMPORT_FILES} 个文件`)
  const decoded = files.map(decodeImportFile)
  const total = decoded.reduce((sum, file) => sum + file.bytes, 0)
  if (total > MAX_IMPORT_TOTAL_BYTES) throw new Error('一次导入的文件总大小不能超过 128 MiB')

  return publishWorkspaceFiles(rootPath, decoded.map(file => ({
    name: file.name,
    bytes: file.bytes,
    publish: target => writeFile(target, file.content, { flag: 'wx', mode: 0o600 }),
  })))
}

// Redeem one desktop-created grant without moving file bytes through browser
// JSON. The opaque grant root is application-private and deleted after this
// single import attempt.
export async function importGrantedWorkspaceFiles(rootPath, intakeRoot, grantID) {
  if (typeof intakeRoot !== 'string' || !isAbsolute(intakeRoot)) throw new Error('桌面文件暂存区不可用')
  if (typeof grantID !== 'string' || !GRANT_ID.test(grantID)) throw new Error('桌面文件授权无效')
  const rootInfo = await lstat(intakeRoot)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('桌面文件暂存区不可用')
  const canonicalRoot = await realpath(intakeRoot)
  const requestedGrant = join(canonicalRoot, grantID)
  const grantInfo = await lstat(requestedGrant)
  if (grantInfo.isSymbolicLink() || !grantInfo.isDirectory()) throw new Error('桌面文件授权无效')
  const canonicalGrant = await realpath(requestedGrant)
  if (!contained(canonicalRoot, canonicalGrant) || canonicalGrant === canonicalRoot) throw new Error('桌面文件授权越界')

  try {
    const entries = await readdir(canonicalGrant, { withFileTypes: true })
    if (entries.length === 0) throw new Error('桌面文件授权为空')
    if (entries.length > MAX_IMPORT_FILES) throw new Error(`一次最多导入 ${MAX_IMPORT_FILES} 个文件`)
    const files = []
    let total = 0
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('桌面文件授权只能包含普通文件')
      const source = join(canonicalGrant, entry.name)
      if (!contained(canonicalGrant, source)) throw new Error('桌面文件授权越界')
      const info = await lstat(source)
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('桌面文件授权只能包含普通文件')
      if (info.size > MAX_IMPORT_FILE_BYTES) throw new Error('单个文件不能超过 64 MiB')
      total += info.size
      if (total > MAX_IMPORT_TOTAL_BYTES) throw new Error('一次导入的文件总大小不能超过 128 MiB')
      files.push({
        name: safeImportName(entry.name),
        bytes: info.size,
        publish: async target => {
          try {
            await copyFile(source, target, COPYFILE_EXCL)
            await chmod(target, 0o600)
          } catch (error) {
            await rm(target, { force: true })
            throw error
          }
        },
      })
    }
    return await publishWorkspaceFiles(rootPath, files)
  } finally {
    await rm(canonicalGrant, { recursive: true, force: true })
  }
}

import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sanitizeFilename } from './sanitize.js'

function workspaceOf(exec) {
  const cwd = exec.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '' || !isAbsolute(cwd)) {
    throw new Error('This mail operation requires a session with an absolute workspace path')
  }
  return cwd
}

function within(parent, child) {
  const path = relative(resolve(parent), resolve(child))
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

export async function readWorkspaceAttachments(ctx, paths, exec, maxBytes) {
  if (paths === undefined) return []
  if (!Array.isArray(paths) || paths.length > 10 || paths.some(path => typeof path !== 'string' || path.trim() === '')) {
    throw new Error('attachments must be an array of at most 10 non-empty workspace paths')
  }
  const workspace = workspaceOf(exec)
  const workspaceTarget = await ctx.fs.resolve(workspace, { signal: exec.signal })
  const attachments = []
  let total = 0
  for (const raw of paths) {
    const target = await ctx.fs.resolve(raw.trim(), { cwd: workspace, signal: exec.signal })
    if (!ctx.fs.contains(workspaceTarget, target)) throw new Error(`Attachment is outside the session workspace: ${raw}`)
    const info = await ctx.fs.stat(target, exec.signal)
    if (info === undefined || info.type !== 'file') throw new Error(`Attachment is not a regular file: ${raw}`)
    total += Number(info.size ?? 0)
    if (total > maxBytes) throw new Error(`Attachments exceed the configured ${maxBytes} byte limit`)
    const bytes = await ctx.fs.readBytes(target, exec.signal, Math.max(0, maxBytes - (total - Number(info.size ?? 0))))
    attachments.push({ filename: sanitizeFilename(raw), content: Buffer.from(bytes) })
  }
  return attachments
}

export async function writeWorkspaceAttachment(ctx, file, exec) {
  const workspace = workspaceOf(exec)
  const workspaceTarget = await ctx.fs.resolve(workspace, { signal: exec.signal })
  const directoryTarget = await ctx.fs.resolve('.dsh-mail-assistant/attachments', { cwd: workspace, signal: exec.signal })
  if (!ctx.fs.contains(workspaceTarget, directoryTarget)) throw new Error('Attachment destination escaped the session workspace')

  const workspaceProcessPath = ctx.fs.processPath(workspaceTarget)
  const directoryProcessPath = ctx.fs.processPath(directoryTarget)
  if (!within(workspaceProcessPath, directoryProcessPath)) throw new Error('Filesystem provider cannot expose a safe local attachment destination')
  await mkdir(directoryProcessPath, { recursive: true })

  // Re-check the real paths after mkdir so a pre-existing symlink/junction
  // cannot redirect attachment writes outside the session workspace.
  const [realWorkspace, realDirectory] = await Promise.all([
    realpath(workspaceProcessPath),
    realpath(directoryProcessPath),
  ])
  if (!within(realWorkspace, realDirectory)) throw new Error('Attachment destination resolves outside the session workspace')

  const filename = `${randomUUID()}-${sanitizeFilename(file.filename)}`
  const destination = join(realDirectory, filename)
  if (!within(realDirectory, destination)) throw new Error('Invalid attachment filename')
  await writeFile(destination, file.bytes, { flag: 'wx', mode: 0o600 })
  return destination
}

export const internals = Object.freeze({ workspaceOf, within })

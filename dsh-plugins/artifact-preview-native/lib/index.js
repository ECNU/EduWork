import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { randomBytes } from 'node:crypto'
import { isOfficePreview, isStreamPreview, isTextPreview, previewLimit, previewType } from './core.js'
import { assertOfficeSourceSize, renderOfficePreview } from './office.js'
import { revealInFileManager } from './reveal.js'
import { importGrantedWorkspaceFiles, importWorkspaceFiles } from './workspace-import.js'
import { PREVIEW_FETCH_PATH, PREVIEW_LEGACY_PREFIX, fileResponse, serveLegacyStream, streamFailure, streamToken } from './stream.js'

export const name = 'artifact-preview-native'
const initializers = []

export class ArtifactPreviewService extends TypertRemoteService {
  static inject = ['sessions', 'fs']
  constructor(ctx) {
    super(ctx, 'artifactPreview')
    this.streams = new Map()
    this.fetchAvailable = false
    this.legacyAvailable = false
    ctx.inject(['connection'], connectionCtx => {
      // Older hosts may have Connection RPC without the Fetch registry.
      if (typeof connectionCtx.connection.fetch?.register !== 'function') return
      connectionCtx.effect(() => connectionCtx.connection.fetch.register({
        path: PREVIEW_FETCH_PATH, methods: ['GET', 'HEAD'], requestBody: 'buffered',
        fetch: request => this.fetchStream(request),
      }), 'artifact-preview: shared Fetch stream')
      connectionCtx.effect(() => {
        this.fetchAvailable = true
        return () => { this.fetchAvailable = false }
      })
    })
    // Keep old issued URLs working whenever an HTTP carrier is present.
    ctx.inject(['webServer'], webCtx => {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'prefix', path: PREVIEW_LEGACY_PREFIX.slice(0, -1),
        handler: (request, response) => this.serveStream(request, response),
      }), 'artifact-preview: legacy media stream')
      webCtx.effect(() => {
        this.legacyAvailable = true
        return () => { this.legacyAvailable = false }
      })
    })
    ctx.effect(() => () => this.streams.clear(), 'artifact-preview: clear private tickets')
    for (const initialize of initializers) initialize.call(this)
  }
  issueStream(target, mime, size, root) {
    if (!this.fetchAvailable && !this.legacyAvailable) throw new Error('artifact preview transport is unavailable')
    const now = Date.now()
    for (const [token, entry] of this.streams) if (entry.expiresAt <= now) this.streams.delete(token)
    while (this.streams.size >= 32) this.streams.delete(this.streams.keys().next().value)
    const token = randomBytes(24).toString('base64url')
    this.streams.set(token, {
      path: this.ctx.fs.processPath(target), root, mime, size, expiresAt: now + 30 * 60_000,
    })
    return this.fetchAvailable ? `${PREVIEW_FETCH_PATH}?token=${token}` : `${PREVIEW_LEGACY_PREFIX}${token}`
  }
  async serveStream(request, response) {
    return serveLegacyStream(request, response, request => this.fetchStream(request))
  }
  async fetchStream(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return streamFailure(405, { Allow: 'GET, HEAD' })
    }
    const token = streamToken(request)
    const entry = this.streams.get(token)
    if (entry === undefined || entry.expiresAt <= Date.now()) {
      this.streams.delete(token)
      return streamFailure(404)
    }
    // Recheck realpath containment when reopening a ticket (e.g. after a symlink changes).
    try {
      const target = await this.ctx.fs.resolve(entry.path, { signal: request.signal })
      if (!entry.root || !this.ctx.fs.contains(entry.root, target)) return streamFailure(404)
      entry.expiresAt = Date.now() + 30 * 60_000
      return await fileResponse(request, { ...entry, path: this.ctx.fs.processPath(target) })
    } catch (error) {
      if (request.signal.aborted) throw request.signal.reason
      if (['FS_NOT_FOUND', 'FS_PERMISSION_DENIED', 'FS_SANDBOX_DENIED'].includes(error?.code)) return streamFailure(404)
      throw error
    }
  }
  async resolveTarget(sessionId, relativePath, signal) {
    if (typeof sessionId !== 'string' || typeof relativePath !== 'string' || relativePath.trim().length === 0) throw new Error('preview request is incomplete')
    const session = this.ctx.sessions.get(sessionId)
    const cwd = session?.header?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('the session workspace is unavailable')
    const root = await this.ctx.fs.resolve('.', { cwd, signal })
    const target = await this.ctx.fs.resolve(relativePath, { cwd, signal })
    if (!this.ctx.fs.contains(root, target)) throw new Error('preview target must stay inside the current workspace')
    const info = await this.ctx.fs.stat(target, signal)
    if (info?.type !== 'file') throw new Error('preview target is not a regular file')
    return { root, target, info }
  }
  async read(sessionId, relativePath) {
    const signal = AbortSignal.timeout(15_000)
    const { root, target, info } = await this.resolveTarget(sessionId, relativePath, signal)
    const mime = previewType(target.displayPath)
    if (mime === undefined) throw new Error('this file type does not support inline preview yet; use Open instead')
    const streamUrl = this.issueStream(target, mime, Number(info.size), root)
    // A desktop carrier may redirect across origins, where browsers ignore the
    // link's download attribute. Declare download intent in the response too.
    const downloadUrl = `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}download=1`
    if (isOfficePreview(mime)) {
      assertOfficeSourceSize(Number(info?.size))
      const rendered = await renderOfficePreview(this.ctx.fs.processPath(target), signal)
      return {
        path: relativePath, name: target.displayPath.split(/[\\/]/).pop() ?? relativePath,
        mime: 'text/html', bytes: rendered.bytes, encoding: 'utf8', data: rendered.html,
        officePreview: rendered.description, downloadUrl,
      }
    }
    if (isStreamPreview(mime)) {
      return {
        path: relativePath, name: target.displayPath.split(/[\\/]/).pop() ?? relativePath,
        mime, bytes: Number(info.size), encoding: 'url', data: streamUrl, downloadUrl,
      }
    }
    const bytes = await this.ctx.fs.readBytes(target, signal, previewLimit(mime))
    return {
      path: relativePath, name: target.displayPath.split(/[\\/]/).pop() ?? relativePath,
      mime, bytes: bytes.byteLength,
      encoding: isTextPreview(mime) ? 'utf8' : 'base64',
      data: isTextPreview(mime) ? Buffer.from(bytes).toString('utf8') : Buffer.from(bytes).toString('base64'), downloadUrl,
    }
  }
  async reveal(sessionId, relativePath) {
    const signal = AbortSignal.timeout(12_000)
    const { target } = await this.resolveTarget(sessionId, relativePath, signal)
    await revealInFileManager(this.ctx.fs.processPath(target), signal)
    return { path: relativePath, revealed: true }
  }
  async importFiles(sessionId, files) {
    if (typeof sessionId !== 'string') throw new Error('文件导入请求缺少会话')
    const session = this.ctx.sessions.get(sessionId)
    const cwd = session?.header?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('当前会话没有可用的工作区')
    const signal = AbortSignal.timeout(120_000)
    const root = await this.ctx.fs.resolve('.', { cwd, signal })
    const info = await this.ctx.fs.stat(root, signal)
    if (info?.type !== 'directory') throw new Error('当前会话工作区不可用')
    return { files: await importWorkspaceFiles(this.ctx.fs.processPath(root), files) }
  }
  async importNativeFiles(sessionId, grantID) {
    if (typeof sessionId !== 'string') throw new Error('文件导入请求缺少会话')
    const session = this.ctx.sessions.get(sessionId)
    const cwd = session?.header?.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('当前会话没有可用的工作区')
    const signal = AbortSignal.timeout(120_000)
    const root = await this.ctx.fs.resolve('.', { cwd, signal })
    const info = await this.ctx.fs.stat(root, signal)
    if (info?.type !== 'directory') throw new Error('当前会话工作区不可用')
    return {
      files: await importGrantedWorkspaceFiles(
        this.ctx.fs.processPath(root), process.env.CHATECNU_WORK_FILE_INTAKE_ROOT, grantID,
      ),
    }
  }
}

Remote('read')(ArtifactPreviewService.prototype.read, {
  kind: 'method', name: 'read', static: false, private: false,
  addInitializer(initializer) { initializers.push(initializer) },
})
Remote('reveal')(ArtifactPreviewService.prototype.reveal, {
  kind: 'method', name: 'reveal', static: false, private: false,
  addInitializer(initializer) { initializers.push(initializer) },
})
Remote('importFiles')(ArtifactPreviewService.prototype.importFiles, {
  kind: 'method', name: 'importFiles', static: false, private: false,
  addInitializer(initializer) { initializers.push(initializer) },
})
Remote('importNativeFiles')(ArtifactPreviewService.prototype.importNativeFiles, {
  kind: 'method', name: 'importNativeFiles', static: false, private: false,
  addInitializer(initializer) { initializers.push(initializer) },
})
export default ArtifactPreviewService

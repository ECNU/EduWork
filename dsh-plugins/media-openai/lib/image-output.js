import { execFile } from 'node:child_process'
import { isAbsolute, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectImage, detectImageDimensions, revalidateManagedOutput, writeUniqueFile, projectRelative } from './core.js'

const runner = fileURLToPath(new URL('./resize-image.py', import.meta.url))

export async function resizeImage(bytes, size, fit, { environment = process.env, signal } = {}) {
  const python = String(environment.DSH_OFFICE_PYTHON ?? '').trim()
  if (!isAbsolute(python) && !win32.isAbsolute(python)) throw new Error('managed image processing runtime is unavailable')
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = execFile(python, ['-I', runner, size, fit], {
      windowsHide: true, encoding: 'buffer', maxBuffer: 65 * 1024 * 1024,
      timeout: 30_000, signal, env: environment,
    }, (error, stdout) => error ? reject(new Error('local image resizing failed')) : resolve(stdout))
    child.stdin.on('error', () => {}) // An early child exit is reported by execFile.
    child.stdin.end(bytes)
  })
}

export async function saveGeneratedImage({ generated, request, managed, projectPath, signal, resize = resizeImage, write = writeUniqueFile }) {
  signal?.throwIfAborted()
  await revalidateManagedOutput(managed, projectPath, 'images')
  const sourcePath = await write(managed.output, 'image', generated.format.extension, generated.bytes)
  const source = {
    path: sourcePath, relativePath: projectRelative(managed.project, sourcePath),
    size: generated.dimensions.size, mime: generated.format.mime, bytes: generated.bytes.byteLength,
    requestedSize: request.size, generationSize: generated.generationSize,
    sourceSize: generated.dimensions.size, sourceRelativePath: projectRelative(managed.project, sourcePath),
    resized: false,
  }
  if (request.size === generated.dimensions.size) return source
  const keepOriginal = () => ({ ...source, resizeWarning: `Image generated and saved at ${source.size}; local resizing to ${request.size} did not complete. Use the saved original for local processing; do not regenerate it.` })
  let bytes, format, dimensions
  try {
    bytes = await resize(generated.bytes, request.size, request.fit, { signal })
    signal?.throwIfAborted()
    format = detectImage(bytes)
    dimensions = detectImageDimensions(bytes, format)
    if (dimensions.size !== request.size) throw new Error('local image resizing returned incorrect dimensions')
  } catch {
    signal?.throwIfAborted()
    // A successful paid generation remains usable even if local processing is
    // unavailable. Report actual dimensions and retain the original for retry.
    return keepOriginal()
  }
  await revalidateManagedOutput(managed, projectPath, 'images')
  let path
  try {
    path = await write(managed.output, 'image-sized', format.extension, bytes)
  } catch {
    signal?.throwIfAborted()
    // Keep permission/path failures distinct from a failed second file write.
    await revalidateManagedOutput(managed, projectPath, 'images')
    return keepOriginal()
  }
  return { ...source, path, relativePath: projectRelative(managed.project, path), size: dimensions.size,
    mime: format.mime, bytes: bytes.byteLength, resized: true }
}

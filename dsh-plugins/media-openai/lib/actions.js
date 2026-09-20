import { generateImage, normalizeImageRequest, normalizeSpeechRequest, prepareManagedOutput, projectRelative,
  revalidateManagedOutput, synthesizeSpeech, writeUniqueFile } from './core.js'
import { saveGeneratedImage } from './image-output.js'

async function workspace(ctx, exec) {
  const cwd = exec.agent?.session.header.cwd
  if (typeof cwd !== 'string' || !cwd.trim()) throw new Error('Media generation requires a session workspace')
  const root = await ctx.fs.resolve('.', { cwd, signal: exec.signal })
  if ((await ctx.fs.stat(root, exec.signal))?.type !== 'directory') throw new Error('the session workspace is unavailable')
  return ctx.fs.processPath(root)
}

export async function resolveMediaCredential(ctx, config) {
  if (config.oidcProfileId) return undefined
  return ctx.credentials.resolve(config.credentialRef)
}

export async function mediaAuthorization(ctx, config) {
  if (!config.oidcProfileId) return { apiKey: await key(ctx, config) }
  const account = ctx.get?.('oidcAccounts')
  if (!await account?.modelAuthorization?.(config.oidcProfileId, config.baseURL)) throw new Error('Sign in to the configured model service')
  return { requestImpl: (url, init) => account.authorizedFetch(config.oidcProfileId, url, init) }
}

async function key(ctx, config) {
  const hit = await resolveMediaCredential(ctx, config)
  if (!hit?.value?.trim()) throw new Error('Media credentials unavailable; sign in to the configured organization or configure its API key')
  return hit.value
}

const signalFor = parent => AbortSignal.any([...(parent ? [parent] : []), AbortSignal.timeout(180_000)])

// Called only after the shared image/speech Tool permission seam.
export async function generateImageForAgent(ctx, config, args, exec) {
  const request = normalizeImageRequest(args, config)
  const projectPath = await workspace(ctx, exec)
  const managed = await prepareManagedOutput(projectPath, 'images')
  const generated = await generateImage({ baseURL: config.baseURL, ...await mediaAuthorization(ctx, config), model: config.images.model,
    prompt: request.prompt, size: request.size, nativeSizes: config.images.nativeSizes, responseFormat: config.images.responseFormat, signal: signalFor(exec.signal) })
  const saved = await saveGeneratedImage({ generated, request, managed, projectPath, signal: exec.signal })
  return { model: config.images.model, ...saved,
    ...(generated.created === undefined ? {} : { created: generated.created }),
    ...(typeof generated.revisedPrompt !== 'string' || !generated.revisedPrompt ? {} : { revisedPrompt: generated.revisedPrompt }) }
}

export async function synthesizeSpeechForAgent(ctx, config, args, exec) {
  const request = normalizeSpeechRequest(args, config)
  const projectPath = await workspace(ctx, exec)
  const managed = await prepareManagedOutput(projectPath, 'audio')
  const generated = await synthesizeSpeech({ baseURL: config.baseURL, ...await mediaAuthorization(ctx, config), model: config.speech.model,
    ...request, signal: signalFor(exec.signal) })
  exec.signal?.throwIfAborted()
  await revalidateManagedOutput(managed, projectPath, 'audio')
  const path = await writeUniqueFile(managed.output, 'speech', generated.format.extension, generated.bytes)
  return { model: config.speech.model, voice: request.voice, format: request.format, speed: request.speed,
    path, relativePath: projectRelative(managed.project, path), mime: generated.format.mime, bytes: generated.bytes.byteLength }
}

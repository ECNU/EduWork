import { open, lstat, mkdir, realpath, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const MAX_IMAGE_RESPONSE_BYTES = 32 * 1024 * 1024
const MAX_AUDIO_RESPONSE_BYTES = 64 * 1024 * 1024

function codePointLength(value) {
  return Array.from(value).length
}

function requiredText(value, field, maximum) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`${field} must not be empty`)
  const length = codePointLength(normalized)
  if (length > maximum) throw new Error(`${field} has ${length} characters; maximum is ${maximum}`)
  return normalized
}

function choice(value, fallback, allowed, field) {
  const normalized = typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : fallback
  if (!allowed.includes(normalized)) throw new Error(`${field} received ${JSON.stringify(normalized)}; expected one of: ${allowed.join(', ')}`)
  return normalized
}

export function normalizeImageSize(value, fallback = '512x512') {
  const normalized = typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : fallback
  const match = /^(\d{2,4})x(\d{2,4})$/u.exec(normalized)
  if (match === null) throw new Error(`size received ${JSON.stringify(normalized)}; expected WIDTHxHEIGHT`)
  const width = Number(match[1])
  const height = Number(match[2])
  if (width < 64 || width > 4096 || height < 64 || height > 4096) {
    throw new Error(`size received ${JSON.stringify(normalized)}; width and height must each be between 64 and 4096 pixels`)
  }
  return `${width}x${height}`
}

// Each configured provider accepts its own discrete source sizes. User-facing dimensions can
// differ, but must never reach the provider unchanged when unsupported.
export function selectImageGenerationSize(value, nativeSizes) {
  const requested = normalizeImageSize(value)
  if (nativeSizes.includes(requested)) return requested
  const [width, height] = requested.split('x').map(Number)
  return nativeSizes.map(size => {
    const [w, h] = size.split('x').map(Number)
    return { size, crop: Math.abs(Math.log((w / h) / (width / height))), scale: Math.max(width / w, height / h), area: w * h }
  }).sort((a, b) => {
    if (Math.abs(a.crop - b.crop) > 1e-9) return a.crop - b.crop
    // For equally suitable aspect ratios, avoid upscaling where possible;
    // otherwise use the largest source. Do not enlarge a small draft needlessly.
    if ((a.scale > 1) !== (b.scale > 1)) return a.scale > 1 ? 1 : -1
    return a.scale > 1 ? a.scale - b.scale : a.area - b.area
  })[0].size
}

export function normalizeImageRequest(args, config = {}) {
  return {
    prompt: requiredText(args.prompt, 'prompt', config.images.promptMaxChars),
    size: normalizeImageSize(args.size, config.images.defaultSize),
    fit: choice(args.fit, 'crop', ['crop', 'pad'], 'fit'),
  }
}

export function normalizeSpeechRequest(args, config) {
  const speed = args.speed === undefined || args.speed === 0 ? 1 : Number(args.speed)
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) throw new Error('speed must be between 0.25 and 4')
  return {
    input: requiredText(args.input, 'input', config.speech.inputMaxChars),
    voice: speechVoice(args.voice, config.speech),
    format: choice(args.format, 'wav', ['wav'], 'format'),
    speed,
  }
}

function speechVoice(value, speech) {
  const voice = value || speech.defaultVoice
  if (!speech.voices.some(v => v.id === voice)) throw new Error('voice is not present in the configured voice catalog')
  return voice
}

function isContained(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export async function prepareManagedOutput(projectPath, leaf) {
  const project = await realpath(resolve(projectPath))
  const projectInfo = await stat(project)
  if (!projectInfo.isDirectory()) throw new Error('the session workspace is not a directory')
  let current = project
  for (const part of ['.eduwork', 'generated', leaf]) {
    current = join(current, part)
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      try {
        await mkdir(current, { mode: 0o700 })
      } catch (createError) {
        if (createError?.code !== 'EEXIST') throw createError
      }
      info = await lstat(current)
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`managed output path is not a trusted directory: ${current}`)
    }
  }
  const output = await realpath(current)
  if (!isContained(project, output)) throw new Error('managed output path escaped the session workspace')
  return { project, output }
}

export async function revalidateManagedOutput(expected, projectPath, leaf) {
  const current = await prepareManagedOutput(projectPath, leaf)
  if (current.project !== expected.project || current.output !== expected.output) {
    throw new Error('the managed output directory changed while the request was running; retry the operation')
  }
  return current
}

function timestamp(now) {
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export async function writeUniqueFile(directory, stem, extension, bytes, now = new Date()) {
  const prefix = `${stem}-${timestamp(now)}`
  for (let index = 1; index <= 10_000; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`
    const path = join(directory, `${prefix}${suffix}${extension}`)
    let handle
    try {
      handle = await open(path, 'wx', 0o600)
      await handle.writeFile(bytes)
      await handle.close()
      return path
    } catch (error) {
      if (handle !== undefined) await handle.close().catch(() => undefined)
      if (error?.code === 'EEXIST') continue
      await rm(path, { force: true }).catch(() => undefined)
      throw new Error('failed to save the generated media file')
    }
  }
  throw new Error('could not allocate a unique generated media filename')
}

async function readBoundedResponse(response, maximum) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximum) throw new Error('provider response exceeded the safety size limit')
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximum) throw new Error('provider response exceeded the safety size limit')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function providerRequest(fetchImpl, url, apiKey, init, maximum) {
  let response
  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: 'manual',
      headers: {
        ...(apiKey === undefined ? {} : { Authorization: `Bearer ${apiKey}` }),
        ...init.headers,
      },
    })
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error
    throw new Error('the configured media service could not be reached')
  }
  const bytes = await readBoundedResponse(response, maximum)
  if (!response.ok) throw new Error(`the configured media service returned HTTP ${response.status}`)
  return { response, bytes }
}

function decodeJSON(bytes, label) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error(`the configured ${label} response was not valid JSON`)
  }
}

export function detectImage(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { mime: 'image/png', extension: '.png' }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', extension: '.jpg' }
  }
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 12))
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return { mime: 'image/gif', extension: '.gif' }
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return { mime: 'image/webp', extension: '.webp' }
  throw new Error('the configured image response used an unsupported image format')
}

function u16BE(bytes, offset) {
  return bytes[offset] * 0x100 + bytes[offset + 1]
}

function u16LE(bytes, offset) {
  return bytes[offset] + bytes[offset + 1] * 0x100
}

function u24LE(bytes, offset) {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000
}

function u32BE(bytes, offset) {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]
}

function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('the configured image response declared invalid pixel dimensions')
  }
  return { width, height, size: `${width}x${height}` }
}

export function detectImageDimensions(bytes, format = detectImage(bytes)) {
  if (format.mime === 'image/png' && bytes.length >= 24) return dimensions(u32BE(bytes, 16), u32BE(bytes, 20))
  if (format.mime === 'image/gif' && bytes.length >= 10) return dimensions(u16LE(bytes, 6), u16LE(bytes, 8))
  if (format.mime === 'image/jpeg') {
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
    let offset = 2
    while (offset + 8 < bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
      if (offset >= bytes.length) break
      const marker = bytes[offset++]
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 1 >= bytes.length) break
      const length = u16BE(bytes, offset)
      if (length < 2 || offset + length > bytes.length) break
      if (sof.has(marker) && length >= 7) return dimensions(u16BE(bytes, offset + 5), u16BE(bytes, offset + 3))
      offset += length
    }
  }
  if (format.mime === 'image/webp' && bytes.length >= 30) {
    const chunk = new TextDecoder('latin1').decode(bytes.slice(12, 16))
    if (chunk === 'VP8X') return dimensions(u24LE(bytes, 24) + 1, u24LE(bytes, 27) + 1)
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return dimensions(u16LE(bytes, 26) & 0x3fff, u16LE(bytes, 28) & 0x3fff)
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      return dimensions(
        1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      )
    }
  }
  throw new Error('the configured image response did not contain readable pixel dimensions')
}

export async function generateImage({ fetchImpl = fetch, requestImpl = fetchImpl, baseURL, apiKey, model, prompt, size, nativeSizes, responseFormat = 'auto', signal }) {
  const generationSize = selectImageGenerationSize(size, nativeSizes)
  const { bytes } = await providerRequest(requestImpl, `${baseURL}/images/generations`, apiKey, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, size: generationSize, ...(responseFormat === 'auto' ? {} : { response_format: responseFormat }) }),
  }, MAX_IMAGE_RESPONSE_BYTES)
  const decoded = decodeJSON(bytes, 'image generation')
  const item = decoded?.data?.[0]
  let image
  if (typeof item?.b64_json === 'string' && item.b64_json) {
    const compact = item.b64_json.replace(/\s/g, '')
    if (compact.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) throw new Error('image response contained invalid base64 data')
    image = new Uint8Array(Buffer.from(compact, 'base64'))
  } else if (typeof item?.url === 'string') {
    // Signed result URLs never receive the model credential. Do not follow
    // redirects or surface potentially sensitive signed URLs in errors.
    let url
    try { url = new URL(item.url) } catch { throw new Error('image result URL is invalid') }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('image result URL must use HTTPS without credentials')
    let response
    try { response = await fetchImpl(url.href, { signal, redirect: 'error' }) }
    catch (error) {
      signal?.throwIfAborted()
      throw new Error('could not download the generated image')
    }
    if (!response.ok) throw new Error(`image download returned HTTP ${response.status}`)
    image = await readBoundedResponse(response, MAX_IMAGE_RESPONSE_BYTES)
  } else throw new Error('image response did not contain b64_json or a result URL')
  const format = detectImage(image)
  const imageDimensions = detectImageDimensions(image, format)
  return { bytes: image, format, dimensions: imageDimensions, generationSize, created: Number(decoded.created) || undefined, revisedPrompt: decoded.data[0].revised_prompt }
}

const AUDIO_TYPES = Object.freeze({
  mp3: ['audio/mpeg', '.mp3'],
  opus: ['audio/ogg', '.opus'],
  aac: ['audio/aac', '.aac'],
  flac: ['audio/flac', '.flac'],
  wav: ['audio/wav', '.wav'],
  pcm: ['audio/pcm', '.pcm'],
})

function contentType(response) {
  return (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase()
}

export function validateAudio(format, declaredType, bytes) {
  const [mime, extension] = AUDIO_TYPES[format]
  const aliases = {
    opus: ['audio/ogg', 'audio/opus'],
    flac: ['audio/flac', 'audio/x-flac'],
    wav: ['audio/wav', 'audio/wave', 'audio/x-wav'],
    pcm: ['audio/pcm', 'audio/l16', 'audio/x-pcm'],
  }
  if (declaredType !== mime && !(aliases[format] ?? []).includes(declaredType)) {
    throw new Error(`the configured speech response declared unexpected content type ${declaredType || '(missing)'}`)
  }
  const ascii = new TextDecoder('latin1').decode(bytes.slice(0, 64))
  let valid = bytes.length > 0
  if (format === 'mp3') valid = bytes.length >= 4 && (ascii.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
  if (format === 'opus') valid = ascii.startsWith('OggS') && ascii.includes('OpusHead')
  if (format === 'aac') valid = bytes.length >= 7 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0
  if (format === 'flac') valid = ascii.startsWith('fLaC')
  if (format === 'wav') valid = ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE'
  if (!valid) throw new Error(`the configured speech response was not valid ${format} audio`)
  return { mime, extension }
}

export async function synthesizeSpeech({ fetchImpl = fetch, requestImpl = fetchImpl, baseURL, apiKey, model, input, voice, format, speed, signal }) {
  const { response, bytes } = await providerRequest(requestImpl, `${baseURL}/audio/speech`, apiKey, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: AUDIO_TYPES[format][0], 'Accept-Encoding': 'identity' },
    body: JSON.stringify({ model, input, voice, response_format: format, speed }),
  }, MAX_AUDIO_RESPONSE_BYTES)
  return { bytes, format: validateAudio(format, contentType(response), bytes) }
}

export function projectRelative(project, path) {
  if (!isContained(project, path)) throw new Error('generated file escaped the session workspace')
  return relative(project, path).split(sep).join('/')
}

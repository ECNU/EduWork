import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

function object(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  for (const field of Object.keys(value)) if (!fields.includes(field)) throw new Error(`${label}.${field} 不是支持的配置项`)
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[\x00-\x1f]/u.test(value)) throw new Error(`${label} 必须是有效文本`)
  return value
}
function enabled(value, label) {
  if (value !== undefined && typeof value !== 'boolean') throw new Error(`${label}.enabled 必须为 true 或 false`)
  return value === true
}
function positive(value, fallback, label) {
  if (!Number.isSafeInteger(value ?? fallback) || (value ?? fallback) <= 0) throw new Error(`${label} 必须是正整数`)
  return value ?? fallback
}
function size(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{1,3}x[1-9]\d{1,3}$/u.test(value) || value.split('x').some(n => +n < 64 || +n > 4096)) throw new Error('media 图片尺寸必须为 64–4096 像素的 WIDTHxHEIGHT')
  return value
}

/** Shared by file loading, Web and the provider. No deployment defaults or keys. */
export function normalizeMediaConfig(value = { providers: [] }) {
  object(value, ['providers'], 'media')
  if (!Array.isArray(value.providers)) throw new Error('media.providers 必须是数组')
  const ids = new Set()
  return { providers: value.providers.map(raw => {
    object(raw, ['id', 'title', 'protocol', 'baseURL', 'credentialRef', 'oidcProfileId', 'images', 'speech'], 'media.providers[]')
    const id = text(raw.id, 'media.provider.id')
    if (!/^[a-z][a-z0-9_-]*$/u.test(id) || ['system', 'local'].includes(id) || ids.has(id)) throw new Error('media.provider.id 必须唯一，且不能使用 system/local')
    ids.add(id)
    if (raw.protocol !== 'openai-compatible') throw new Error('media.provider.protocol 必须为 openai-compatible')
    const url = new URL(text(raw.baseURL, 'media.provider.baseURL'))
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error('media.provider.baseURL 请使用不含凭据的 HTTPS API 基地址（本机服务可用 HTTP）')
    const provider = { id, title: text(raw.title ?? id, 'media.provider.title'), protocol: raw.protocol,
      baseURL: url.href.replace(/\/+$/u, ''), credentialRef: text(raw.credentialRef ?? 'EDUWORK_API_KEY', 'media.provider.credentialRef') }
    if (raw.oidcProfileId !== undefined) provider.oidcProfileId = text(raw.oidcProfileId, 'media.provider.oidcProfileId')
    object(raw.images ?? {}, ['enabled', 'model', 'nativeSizes', 'defaultSize', 'responseFormat', 'promptMaxChars'], 'media.provider.images')
    if (enabled(raw.images?.enabled, 'media.provider.images')) {
      const image = raw.images
      if (!Array.isArray(image.nativeSizes) || !image.nativeSizes.length) throw new Error('启用图像服务时请填写 images.nativeSizes')
      const nativeSizes = [...new Set(image.nativeSizes.map(size))]
      const defaultSize = size(image.defaultSize ?? nativeSizes[0])
      if (!nativeSizes.includes(defaultSize)) throw new Error('images.defaultSize 必须是服务支持的 nativeSizes 之一')
      const responseFormat = image.responseFormat ?? 'auto'
      if (!['auto', 'b64_json', 'url'].includes(responseFormat)) throw new Error('images.responseFormat 必须为 auto、b64_json 或 url')
      provider.images = { enabled: true, model: text(image.model, 'images.model'), nativeSizes, defaultSize, responseFormat,
        promptMaxChars: positive(image.promptMaxChars, 4096, 'images.promptMaxChars') }
    }
    object(raw.speech ?? {}, ['enabled', 'model', 'voices', 'defaultVoice', 'inputMaxChars'], 'media.provider.speech')
    if (enabled(raw.speech?.enabled, 'media.provider.speech')) {
      const speech = raw.speech
      if (!Array.isArray(speech.voices) || !speech.voices.length) throw new Error('启用语音服务时请填写 speech.voices')
      const voices = speech.voices.map(voice => {
        object(voice, ['id', 'title', 'language'], 'speech.voices[]')
        return { id: text(voice.id, 'voice.id'), title: text(voice.title ?? voice.id, 'voice.title'), ...(voice.language ? { language: text(voice.language, 'voice.language') } : {}) }
      })
      if (new Set(voices.map(v => v.id)).size !== voices.length) throw new Error('speech.voices 的 id 不能重复')
      const defaultVoice = speech.defaultVoice ?? voices[0].id
      if (!voices.some(v => v.id === defaultVoice)) throw new Error('speech.defaultVoice 必须在 voices 中')
      provider.speech = { enabled: true, model: text(speech.model, 'speech.model'), voices, defaultVoice,
        inputMaxChars: positive(speech.inputMaxChars, 4096, 'speech.inputMaxChars') }
    }
    return provider
  }) }
}

export async function loadMediaProviders(product, user) {
  let media = user?.media
  if (media === undefined) {
    try { media = JSON.parse(await readFile(join(product, 'resources/desktop/media-defaults.json'), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    // Edition defaults apply only while that organization is still configured.
    if (media && user) media = { providers: media.providers.filter(p => !p.oidcProfileId || user.organizations.some(o => o.id === p.oidcProfileId)) }
  }
  const normalized = normalizeMediaConfig(media)
  if (user) for (const provider of normalized.providers) {
    if (provider.oidcProfileId && !user.organizations.some(o => o.id === provider.oidcProfileId)) throw new Error(`media 的 oidcProfileId ${provider.oidcProfileId} 不在 organizations 中`)
  }
  return normalized
}

// Skin packages are data only: a manifest and images. The Host validates
// packages with this module and the pet page plays them with the same rules.
// No Node or DOM APIs here; both runtimes import this file unchanged.

export const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u
export const DEFAULT_SKIN = 'eduwork-page'
export const LIMITS = Object.freeze({ animations: 32, frames: 64, fps: 30, frameMs: 60_000, repeat: 20, image: 4096, manifestBytes: 64 * 1024, packageBytes: 20 * 1024 * 1024 })
// Every state of a built-in skin is drawn; imported skins may fall back.
export const BUILTIN_ANIMATIONS = Object.freeze(['idle', 'think', 'attention', 'done', 'failed', 'sleep', 'drag', 'react', 'peek', 'greet'])
export const MOTIONS = Object.freeze(['float', 'hop', 'dangle', 'breathe', 'sway', 'shake'])
const PLAYBACK = ['loop', 'once', 'pingpong', 'blink']
const FALLBACK = { work: 'think', think: 'idle', attention: 'idle', done: 'react', react: 'idle', greet: 'react', failed: 'idle', sleep: 'idle', drag: 'idle', peek: 'idle' }
const LINES = ['done', 'attention', 'failed', 'working', 'react', 'greet']
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(?:svg|png|webp)$/u
const NAME = /^[a-z][a-z0-9-]{0,31}$/u
const LICENSE = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u

const fail = message => { throw new Error(`形象包无效：${message}`) }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function only(value, keys, label) {
  if (!object(value)) fail(`${label} 必须是对象`)
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}.${key} 不是支持的字段`)
}
function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/u.test(value)) fail(`${label} 必须是不超过 ${max} 字的单行文本`)
  return value
}
function localized(value, label, max) {
  if (typeof value === 'string') return { 'zh-CN': text(value, label, max), en: value }
  only(value, ['zh-CN', 'en'], label)
  if (!value['zh-CN'] && !value.en) fail(`${label} 至少需要一种语言`)
  return Object.fromEntries(Object.entries(value).map(([locale, item]) => [locale, text(item, `${label}.${locale}`, max)]))
}
const integer = (value, min, max, label) => Number.isSafeInteger(value) && value >= min && value <= max ? value : fail(`${label} 必须是 ${min}–${max} 的整数`)
const file = (value, label) => typeof value === 'string' && FILE.test(value) ? value : fail(`${label} 必须是形象目录内的 SVG、PNG 或 WebP 文件名`)

function animation(value, name, frame) {
  const label = `animations.${name}`
  only(value, ['frames', 'image', 'sheet', 'columns', 'row', 'fps', 'frameMs', 'playback', 'repeat', 'motion'], label)
  const sources = ['image', 'sheet'].filter(key => value[key] !== undefined).length + (Array.isArray(value.frames) ? 1 : 0)
  if (sources !== 1) fail(`${label} 需要 frames、image 或 sheet 中的一种`)
  let frames
  if (value.sheet !== undefined) {
    const sheet = file(value.sheet, `${label}.sheet`), count = integer(value.frames, 1, LIMITS.frames, `${label}.frames`)
    const columns = value.columns === undefined ? count : integer(value.columns, 1, LIMITS.frames, `${label}.columns`)
    const row = value.row === undefined ? 0 : integer(value.row, 0, LIMITS.frames, `${label}.row`)
    frames = Array.from({ length: count }, (_, i) => ({ file: sheet, crop: { x: i % columns * frame.width, y: (row + Math.floor(i / columns)) * frame.height, width: frame.width, height: frame.height } }))
  } else if (value.image !== undefined) {
    if (value.columns !== undefined || value.row !== undefined) fail(`${label} 只有精灵图可以设置 columns 和 row`)
    frames = [{ file: file(value.image, `${label}.image`) }]
  } else {
    if (value.columns !== undefined || value.row !== undefined) fail(`${label} 只有精灵图可以设置 columns 和 row`)
    if (!value.frames.length || value.frames.length > LIMITS.frames) fail(`${label}.frames 需要 1–${LIMITS.frames} 帧`)
    frames = value.frames.map((item, i) => ({ file: file(item, `${label}.frames[${i}]`) }))
  }
  if (value.fps !== undefined && !(typeof value.fps === 'number' && value.fps > 0 && value.fps <= LIMITS.fps)) fail(`${label}.fps 必须大于 0 且不超过 ${LIMITS.fps}`)
  const fallbackMs = Math.round(1000 / (value.fps ?? 8))
  if (value.frameMs !== undefined && (!Array.isArray(value.frameMs) || value.frameMs.length !== frames.length)) fail(`${label}.frameMs 必须与帧数相同`)
  frames.forEach((item, i) => { item.ms = value.frameMs ? integer(value.frameMs[i], 1, LIMITS.frameMs, `${label}.frameMs[${i}]`) : fallbackMs })
  const playback = value.playback ?? 'loop'
  if (!PLAYBACK.includes(playback)) fail(`${label}.playback 必须是 ${PLAYBACK.join('、')} 之一`)
  if (value.motion !== undefined && !MOTIONS.includes(value.motion)) fail(`${label}.motion 必须是 ${MOTIONS.join('、')} 之一`)
  return { frames, playback, ...(value.repeat === undefined ? {} : { repeat: integer(value.repeat, 1, LIMITS.repeat, `${label}.repeat`) }),
    ...(value.motion ? { motion: value.motion } : {}) }
}

/**
 * Validate a skin manifest and convert its three animation notations (frame
 * list, sprite sheet, still image with a built-in motion) into frame lists.
 * @param {unknown} manifest parsed skin.json
 * @param {{ strict?: boolean }} options strict requires every built-in state
 */
export function normalizeSkin(manifest, { strict = false } = {}) {
  only(manifest, ['schemaVersion', 'id', 'name', 'description', 'author', 'license', 'frame', 'pixelated', 'anchors', 'animations', 'states', 'lines'], 'skin.json')
  if (manifest.schemaVersion !== 1) fail('schemaVersion 必须是 1')
  if (typeof manifest.id !== 'string' || !SKIN_ID.test(manifest.id)) fail('id 只能包含小写字母、数字和连字符')
  only(manifest.frame, ['width', 'height'], 'frame')
  const frame = { width: integer(manifest.frame.width, 16, LIMITS.image, 'frame.width'), height: integer(manifest.frame.height, 16, LIMITS.image, 'frame.height') }
  if (manifest.pixelated !== undefined && typeof manifest.pixelated !== 'boolean') fail('pixelated 必须是 true 或 false')
  let badge = [frame.width * 0.8, frame.height * 0.15]
  if (manifest.anchors !== undefined) {
    only(manifest.anchors, ['badge'], 'anchors')
    if (manifest.anchors.badge !== undefined) {
      const [x, y] = Array.isArray(manifest.anchors.badge) && manifest.anchors.badge.length === 2 ? manifest.anchors.badge : []
      if (!(x >= 0 && x <= frame.width && y >= 0 && y <= frame.height)) fail('anchors.badge 必须是画布内的 [x, y]')
      badge = [x, y]
    }
  }
  if (!object(manifest.animations)) fail('animations 必须是对象')
  const names = Object.keys(manifest.animations)
  if (names.length > LIMITS.animations) fail(`最多 ${LIMITS.animations} 段动画`)
  const animations = {}
  for (const name of names) {
    if (!NAME.test(name)) fail(`动画名 ${name} 无效`)
    animations[name] = animation(manifest.animations[name], name, frame)
  }
  if (!animations.idle) fail('缺少 idle 动画')
  if (strict) for (const name of BUILTIN_ANIMATIONS) if (!animations[name]) fail(`内置形象缺少 ${name} 动画`)
  const states = { idle: ['idle'], working: ['think'] }
  if (manifest.states !== undefined) {
    only(manifest.states, ['idle', 'working'], 'states')
    for (const [state, list] of Object.entries(manifest.states)) {
      if (!Array.isArray(list) || !list.length || list.length > 8) fail(`states.${state} 需要 1–8 段动画`)
      for (const name of list) if (!animations[name]) fail(`states.${state} 引用了不存在的动画 ${name}`)
      states[state] = [...list]
    }
  }
  const lines = {}
  if (manifest.lines !== undefined) {
    only(manifest.lines, LINES, 'lines')
    for (const [state, value] of Object.entries(manifest.lines)) {
      only(value, ['zh-CN', 'en'], `lines.${state}`)
      lines[state] = Object.fromEntries(Object.entries(value).map(([locale, list]) => {
        if (!Array.isArray(list) || !list.length || list.length > 8) fail(`lines.${state}.${locale} 需要 1–8 句`)
        return [locale, list.map((line, i) => text(line, `lines.${state}.${locale}[${i}]`, 60))]
      }))
    }
  }
  const skin = { id: manifest.id, name: localized(manifest.name, 'name', 40), frame, pixelated: manifest.pixelated === true, badge, animations, states, lines }
  if (manifest.description !== undefined) skin.description = localized(manifest.description, 'description', 200)
  if (manifest.author !== undefined) skin.author = text(manifest.author, 'author', 80)
  if (manifest.license !== undefined) skin.license = LICENSE.test(manifest.license) ? manifest.license : fail('license 请使用 SPDX 许可证标识')
  skin.files = [...new Set(Object.values(animations).flatMap(item => item.frames.map(frame => frame.file)))]
  return skin
}

/** The drawn animation for a state, following the fallback chain to idle. */
export function resolveAnimation(skin, name) {
  let current = name
  while (current && !skin.animations[current]) current = FALLBACK[current]
  return skin.animations[current] ?? skin.animations.idle
}

export function localize(value, locale) {
  return value?.[locale] ?? value?.['zh-CN'] ?? value?.en
}

const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end))
function dimensions(bytes) {
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG') return { type: 'png', width: (bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19]) >>> 0, height: (bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23]) >>> 0 }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    const chunk = ascii(bytes, 12, 16)
    if (chunk === 'VP8X') return { type: 'webp', width: 1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16), height: 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16) }
    if (chunk === 'VP8 ') return { type: 'webp', width: (bytes[26] | bytes[27] << 8) & 0x3fff, height: (bytes[28] | bytes[29] << 8) & 0x3fff }
    if (chunk === 'VP8L') {
      const bits = bytes[21] | bytes[22] << 8 | bytes[23] << 16 | bytes[24] << 24
      return { type: 'webp', width: 1 + (bits & 0x3fff), height: 1 + (bits >>> 14 & 0x3fff) }
    }
  }
  return null
}

/**
 * SVG is loaded as an image, which never runs scripts or fetches resources.
 * The rules below also keep the canvas readable for click-through hit tests
 * (foreignObject taints it) and keep external references out of packages.
 */
export function svgProblem(source) {
  if (!/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/u.test(source)) return '不是 SVG 文件'
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) return 'SVG 不能包含 DOCTYPE 或实体声明'
  if (/<\s*(?:script|foreignObject|iframe|object|embed|audio|video)\b/iu.test(source)) return 'SVG 不能包含脚本、foreignObject 或嵌入内容'
  if (/\son[a-z]+\s*=/iu.test(source)) return 'SVG 不能包含事件处理属性'
  if (/@import|url\(\s*['"]?(?!#)/iu.test(source) || /\b(?:xlink:)?href\s*=\s*['"](?!#)/iu.test(source)) return 'SVG 只能引用文件内部的定义'
  if (!/<svg\b[^>]*\sviewBox\s*=/u.test(source)) return 'SVG 需要 viewBox'
  return null
}

/** Check that an image matches its extension, its safety rules and size limits. */
export function imageProblem(name, bytes) {
  if (name.toLowerCase().endsWith('.svg')) return svgProblem(new TextDecoder('utf-8', { fatal: false }).decode(bytes))
  const info = dimensions(bytes), type = name.toLowerCase().endsWith('.png') ? 'png' : 'webp'
  if (info?.type !== type) return `文件内容不是 ${type.toUpperCase()}`
  if (!info.width || !info.height || info.width > LIMITS.image || info.height > LIMITS.image) return `图片尺寸不能超过 ${LIMITS.image}×${LIMITS.image}`
  return null
}

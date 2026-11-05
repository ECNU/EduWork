// Desktop pet page. It runs sandboxed in the shell's pet window, plays the
// skin, derives the visible state, and reports pointer intent through the
// narrow `eduworkPet` preload API. Text is only ever set as textContent.
// One clock drives frames, motions and the badge; it stops while the user is away.
import { localize, normalizeSkin, resolveAnimation } from '../skin.js'
import { PACE, STILL, animationLength, badgeText, between, deriveStatus, frameAt, motionAt, pick } from '../pet-state.js'

const api = window.eduworkPet
const canvas = document.getElementById('pet'), badge = document.getElementById('badge'), bubble = document.getElementById('bubble')
const context = canvas.getContext('2d', { willReadFrequently: true })
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const COPY = {
  'zh-CN': { attention: '需要你确认一下', failed: '遇到问题了，点我查看', done: '完成啦，点我查看', doneMany: n => `${n} 项工作已完成`,
    working: n => `${n} 个会话正在进行`, titles: { attention: '需要确认：', failed: '出错了：', done: '已完成：' } },
  en: { attention: 'I need your input', failed: 'Something went wrong', done: 'Done! Click me', doneMany: n => `${n} tasks are done`,
    working: n => n === 1 ? '1 conversation in progress' : `${n} conversations in progress`, titles: { attention: 'Needs you: ', failed: 'Problem: ', done: 'Done: ' } },
}

let skin, layout, settings, locale, copy
const images = new Map(), rasters = new Map()
let status = deriveStatus([], 0), running = 0, acknowledged
let away = false, tucked = null, bubbleSide = 'above', dragging = false, direction = 0
let shot = null, interlude = null, interludeAt = 0, pool = ''
let view = null, blink = null, blinkAt = 0
let workingUntil = 0, lastActivity = Date.now()
let badgeAt = 0, bubbleUntil = 0, bubbleFor = null, drawn = '', timer
// A hovered bubble freezes its countdown instead of running it down while it is read.
let bubbleHeld = 0, bubbleOver = false, bubbleUp = false, hostInside = false, hostAt = 0

function load(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`无法加载形象图片 ${file}`))
    image.src = `../skin/${encodeURIComponent(file)}`
  })
}

// Vector frames are rasterized once per size; drawing them is then a copy.
function source(frame) {
  const image = images.get(frame.file)
  if (!frame.file.toLowerCase().endsWith('.svg')) return { image, crop: frame.crop }
  const key = frame.crop ? `${frame.file}@${frame.crop.x},${frame.crop.y}` : frame.file
  if (!rasters.has(key)) {
    const raster = new OffscreenCanvas(Math.round(layout.pet.width * devicePixelRatio), Math.round(layout.pet.height * devicePixelRatio))
    const crop = frame.crop ?? { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }
    raster.getContext('2d').drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, raster.width, raster.height)
    rasters.set(key, raster)
  }
  return { image: rasters.get(key), crop: null }
}

function draw(animation, index, mirror, motion) {
  const frame = animation.frames[index], key = [frame.file, frame.crop?.x, frame.crop?.y, mirror, motion.dx, motion.dy, motion.rotate, motion.scaleY].join()
  if (key === drawn) return
  drawn = key
  const box = layout.pet, pivot = motion.origin === 'top' ? box.y : box.y + box.height, { image, crop } = source(frame)
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  context.translate(box.x + box.width / 2 + motion.dx, pivot + motion.dy)
  context.rotate(motion.rotate * Math.PI / 180)
  context.scale(mirror ? -1 : 1, motion.scaleY)
  context.translate(-box.width / 2, box.y - pivot)
  context.imageSmoothingEnabled = !skin.pixelated
  if (crop) context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, box.width, box.height)
  else context.drawImage(image, 0, 0, box.width, box.height)
}

// Short goal-mode pauses between turns still look like work.
const base = now => status.state === 'idle' && now < workingUntil ? 'working' : status.state
const asleep = (now, state) => settings.sleep && state === 'idle' && (away || now - lastActivity >= PACE.sleepAfter)
function startShot(name, now, length) {
  shot = { name, start: now, until: now + (length ?? Math.min(animationLength(resolveAnimation(skin, name)), PACE.greet)) }
}
function activity(now) {
  if (asleep(now, base(now)) && !away) startShot('greet', now)
  lastActivity = now
}

function pose(now) {
  if (dragging) return { name: 'drag', face: direction > 0 ? 'right' : 'left' }
  if (shot && now < shot.until) return shot
  shot = null
  if (tucked) return { name: 'peek', face: tucked === 'left' ? 'right' : 'left' }
  const state = base(now)
  if (state === 'attention') return { name: 'attention' }
  if (asleep(now, state)) return { name: 'sleep' }
}
function choose(now) {
  const fixed = pose(now)
  // Interludes restart from scratch afterwards; no deadline outlives its pose.
  if (fixed) { pool = ''; interlude = null; interludeAt = 0; return fixed }
  // Rest on the first animation of the state and now and then insert another.
  const kind = base(now) === 'working' ? 'working' : 'idle', list = skin.states[kind]
  if (pool !== kind || interlude && now >= interlude.until) { pool = kind; interlude = null; interludeAt = 0 }
  if (!interlude && list.length > 1) {
    interludeAt ||= now + between(kind === 'working' ? PACE.workGap : PACE.idleGap, Math.random)
    if (now >= interludeAt) {
      const name = pick(list.slice(1), Math.random)
      const length = kind === 'working' ? between(PACE.workLength, Math.random) : Math.min(animationLength(resolveAnimation(skin, name)), PACE.idleLength)
      interlude = { name, start: now, until: now + length }
      interludeAt = 0
    }
  }
  return interlude ?? { name: list[0] }
}

// Blink: hold frame 0, then play the other frames once at a random moment.
function blinking(animation, now) {
  if (blink === null) {
    blinkAt ||= now + between(PACE.blinkGap, Math.random)
    if (now < blinkAt) return { index: 0, next: blinkAt - now }
    blink = now
    blinkAt = 0
  }
  const step = frameAt({ frames: animation.frames.slice(1), playback: 'once' }, now - blink)
  if (!step.finished) return { index: step.index + 1, next: step.next }
  blink = null
  return blinking(animation, now)
}

function placeBadge(now) {
  const text = dragging ? '' : badgeText(status)
  if (text !== badge.textContent || status.state !== badge.className) { badge.textContent = text; badge.className = status.state; badgeAt = now }
  badge.hidden = !text
  if (!text) return Infinity
  const scale = layout.pet.width / skin.frame.width
  let [x, y] = skin.badge
  // Keep the badge on the side that stays on screen.
  if (tucked === 'right') x = Math.min(x, skin.frame.width * 0.3)
  if (tucked === 'left') x = Math.max(x, skin.frame.width * 0.7)
  badge.style.left = `${layout.pet.x + x * scale}px`
  badge.style.top = `${layout.pet.y + y * scale}px`
  const t = now - badgeAt, bouncing = !reduced.matches && !away && t < 2400
  badge.style.transform = bouncing ? `translateY(${(-4 * Math.abs(Math.sin(Math.PI * t / 600))).toFixed(1)}px)` : ''
  return bouncing ? PACE.motionFrame : Infinity
}

function say(text, ms = 4000, about = null) {
  if (!settings.bubbles || !text) return
  bubbleFor = about
  bubble.textContent = text
  bubble.hidden = false
  showBubble()
  // A bubble that appears under the cursor starts out held, not half expired.
  if (bubbleOver) { bubbleHeld = ms; bubbleUntil = 0 }
  else bubbleUntil = Date.now() + ms
  placeBubble()
}
// Above the pet, or below it when the pet sits at the top of the screen.
function placeBubble() {
  const center = layout.pet.x + layout.pet.width / 2
  bubble.style.left = tucked === 'right' ? '4px' : tucked === 'left' ? 'auto' : `${center}px`
  bubble.style.right = tucked === 'left' ? '4px' : 'auto'
  bubble.style.transform = tucked ? 'none' : ''
  // A wrapped bubble grows upwards, so above the pet it is anchored by its bottom edge and
  // always clears the pet's head; below the pet it still hangs from its top edge.
  if (bubbleSide === 'below') {
    bubble.style.top = `${layout.pet.y + layout.pet.height + 6}px`
    bubble.style.bottom = 'auto'
  }
  else {
    bubble.style.top = 'auto'
    bubble.style.bottom = `${layout.window.height - layout.pet.y + 6}px`
  }
}

// Only a mail reminder is worth pointing at. An agent message (a question, a failure, a
// finished task) is the pet reporting something, not offering it as something to click, so
// it keeps the original click-through bubble and never lights up.
const BUBBLE_FLOOR = 400
function bubbleIsMail() {
  return Boolean(bubbleFor) && status.target?.key === bubbleFor && status.target?.source === 'mail'
}
function overBubble(x, y) {
  if (bubble.hidden) return false
  const r = bubble.getBoundingClientRect()
  return x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2
}
// A frozen bubble keeps at least BUBBLE_FLOOR ms, so hovering can never strand it; the
// deadline in tick() closes it if the pointer leaves without another event arriving.
function holdBubble() {
  bubbleHeld = Math.max(BUBBLE_FLOOR, bubbleUntil ? bubbleUntil - Date.now() : bubbleHeld)
  bubbleUntil = 0
}
function releaseBubble() {
  if (bubble.hidden) { bubbleHeld = 0; bubbleUntil = 0; return }
  bubbleUntil = Date.now() + Math.max(BUBBLE_FLOOR, bubbleHeld)
  bubbleHeld = 0
  schedule()
}
function setHover(over) {
  if (!bubbleUp) over = false
  if (over === bubbleOver) return
  bubbleOver = over
  bubble.classList.toggle('held', over)
  if (over) holdBubble()
  else releaseBubble()
}
function noteCursor(x, y) { setHover(overBubble(x, y)) }
// The host polls the real cursor and pushes it here, because forwarded mouse events may
// arrive with no position at all. Either source can hold the bubble.
function hostPointer(value) {
  hostInside = value.inside === true
  hostAt = Date.now()
  if (hostInside) noteCursor(value.x, value.y)
  else setHover(false)
}
// While a mail bubble is up the window takes the pointer: the bubble then gets real hover
// events and a click can no longer fall through it. Once it is gone, click-through comes
// back. Recomputed on every show, so a bubble that replaces a mail reminder hands the
// pointer straight back instead of inheriting the mail bubble's state.
function showBubble() {
  bubbleUp = bubbleIsMail()
  if (!bubbleUp) setHover(false)
  setInteractive(bubbleUp)
}
function hideBubble() {
  bubble.hidden = true
  bubbleUntil = 0
  bubbleHeld = 0
  bubbleUp = false
  setHover(false)
  setInteractive(false)
}
function announce() {
  const { state, target, count } = status
  if (!['attention', 'failed', 'done'].includes(state)) return
  if (target.kind === 'plugin') return say(target.title || target.label, 4000, target.key)
  if (target.title) return say(copy.titles[state] + target.title, 4000, target.key)
  const lines = localize(skin.lines[state], locale)
  say(state === 'done' && count > 1 ? copy.doneMany(count) : lines ? pick(lines, Math.random) : copy[state], 4000, target.key)
}

function tick() {
  timer = undefined
  const now = Date.now(), next = choose(now), animation = resolveAnimation(skin, next.name)
  // Directional poses name the side to face; artwork faces left unless its skin says otherwise.
  const mirror = next.face !== undefined && next.face !== (animation.facing ?? 'left')
  if (!view || view.name !== next.name || view.mirror !== mirror || next.start !== undefined && next.start !== view.start) {
    view = { name: next.name, mirror, start: next.start ?? now }
    blink = null
    blinkAt = 0
  }
  const frame = view.name === 'sleep' && !skin.animations.sleep ? { index: 0, next: Infinity }
    : animation.playback === 'blink' && animation.frames.length > 1 ? blinking(animation, now) : frameAt(animation, now - view.start)
  const motion = animation.motion && !reduced.matches && !away ? motionAt(animation.motion, now - view.start) : STILL
  draw(animation, frame.index, view.mirror, motion)
  // A visible bubble always has a deadline, even if nothing set one.
  if (!bubble.hidden && !bubbleUntil && !bubbleHeld) bubbleUntil = now + BUBBLE_FLOOR
  if (bubbleUntil && now >= bubbleUntil) hideBubble()
  if (away) { placeBadge(now); return }
  const waits = [frame.next, motion === STILL ? Infinity : PACE.motionFrame, placeBadge(now), bubbleUntil ? bubbleUntil - now : Infinity]
  if (shot) waits.push(shot.until - now)
  waits.push(interlude ? interlude.until - now : interludeAt ? interludeAt - now : Infinity)
  if (workingUntil > now) waits.push(workingUntil - now)
  // Only a sleep still ahead wakes the clock; once asleep, activity reschedules it.
  const sleepAt = lastActivity + PACE.sleepAfter
  if (settings.sleep && base(now) === 'idle' && sleepAt > now) waits.push(sleepAt - now)
  const wait = Math.min(...waits)
  if (wait < Infinity) timer = setTimeout(tick, Math.min(Math.max(16, wait), 2 ** 31 - 1))
}
function schedule() {
  clearTimeout(timer)
  if (skin) timer = setTimeout(tick, 0)
}

let resolution
function resize() {
  canvas.width = Math.round(layout.window.width * devicePixelRatio)
  canvas.height = Math.round(layout.window.height * devicePixelRatio)
  canvas.style.width = `${layout.window.width}px`
  canvas.style.height = `${layout.window.height}px`
  rasters.clear()
  drawn = ''
  // Moving to a display with another scale factor re-rasterizes once.
  resolution?.removeEventListener('change', rescale)
  resolution = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
  resolution.addEventListener('change', rescale)
}
function rescale() { resize(); schedule() }

// Click-through: only opaque pet pixels, the badge and the bubble take the pointer.
let interactive = false, pointer = null
function setInteractive(value) {
  // A mail bubble is on screen only while the pointer may reach it, so keep taking events.
  if (bubbleUp) value = true
  if (interactive === value) return
  interactive = value
  api.interactive(value)
}
function hit(x, y) {
  for (const element of [badge, bubble]) {
    if (element.hidden) continue
    const r = element.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
  }
  const px = Math.floor(x * devicePixelRatio), py = Math.floor(y * devicePixelRatio)
  return px >= 0 && py >= 0 && px < canvas.width && py < canvas.height && context.getImageData(px, py, 1, 1).data[3] > 40
}
function click() {
  const now = Date.now(), wasAsleep = asleep(now, base(now))
  activity(now)
  // The desktop consumes a notification once it has been viewed, so this click is the only
  // chance to open it: the bubble leaves with the click instead of staying behind as a
  // button that no longer does anything.
  const pending = status.target?.key ?? (bubble.hidden ? '' : bubbleFor)
  if (pending) { api.open(pending); hideBubble() }
  else if (tucked) api.untuck()
  else if (!wasAsleep) {
    startShot('react', now)
    if (base(now) === 'working') say(copy.working(Math.max(1, running)), 2500)
  }
  schedule()
}
document.addEventListener('mousemove', event => { if (!pointer && skin) setInteractive(hit(event.clientX, event.clientY)) })
// A second listener: forwarded events may carry no position, so those are ignored here and
// the host's pointer message does the hit test instead.
document.addEventListener('mousemove', event => {
  if (event.clientX === 0 && event.clientY === 0) return
  noteCursor(event.clientX, event.clientY)
})
document.addEventListener('mouseleave', () => { if (!pointer) setInteractive(false) })
document.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !skin || !hit(event.clientX, event.clientY)) return
  pointer = { id: event.pointerId, x: event.screenX, y: event.screenY, clientX: event.clientX, clientY: event.clientY }
  document.body.setPointerCapture(event.pointerId)
})
// A drag starts after 6 px with the button still held; the shell moves the window.
document.addEventListener('pointermove', event => {
  if (!pointer || event.pointerId !== pointer.id || dragging || !(event.buttons & 1)) return
  if (Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y) < 6) return
  dragging = true
  direction = 0
  activity(Date.now())
  api.dragStart(pointer.clientX, pointer.clientY)
  schedule()
})
function release(event, cancelled) {
  if (!pointer || event.pointerId !== pointer.id) return
  pointer = null
  if (dragging) { dragging = false; api.dragEnd(); schedule() }
  else if (!cancelled) click()
}
document.addEventListener('pointerup', event => release(event, false))
document.addEventListener('pointercancel', event => release(event, true))
document.addEventListener('contextmenu', event => {
  event.preventDefault()
  if (skin && hit(event.clientX, event.clientY)) api.menu()
})

api.on('init', async value => {
  ({ layout, settings, locale } = value)
  copy = COPY[locale] ?? COPY['zh-CN']
  try {
    skin = normalizeSkin(await (await fetch('../skin/skin.json')).json())
    await Promise.all(skin.files.map(async file => images.set(file, await load(file))))
    resize()
    startShot('greet', Date.now())
    tick()
    api.ready()
  } catch (error) { api.failed(String(error?.message ?? error).slice(0, 300)) }
})
api.on('status', value => {
  const now = Date.now(), previous = status
  status = deriveStatus(value.items, value.running)
  running = value.running
  if (running > 0) workingUntil = Infinity
  else if (workingUntil === Infinity) workingUntil = now + PACE.workingGrace
  if (previous.state !== status.state || previous.target?.key !== status.target?.key || previous.count !== status.count || previous.target?.alert !== status.target?.alert) {
    activity(now)
    if (status.state === 'done' && (status.target?.kind !== 'plugin' || status.target.level === 'success') && (previous.state !== 'done' || status.count > previous.count)) startShot('done', now, PACE.celebrate)
    if (status.state === 'failed' && previous.target?.key !== status.target.key) startShot('failed', now, PACE.failed)
    if (previous.state !== status.state || previous.target?.key !== status.target?.key || previous.target?.alert !== status.target?.alert) announce()
  }
  // The bubble belongs to one notification: once that notification is no longer the current
  // target (opened, dismissed, replaced) the bubble goes with it instead of hanging on with
  // nothing left to open.
  if (bubbleFor && status.target?.key !== bubbleFor) { hideBubble(); bubbleFor = null }
  // Work finished in the conversation on screen: celebrate briefly, no badge.
  if (acknowledged !== undefined && value.acknowledged > acknowledged) { activity(now); startShot('done', now, PACE.celebrate) }
  acknowledged = value.acknowledged
  schedule()
})
api.on('settings', value => {
  settings = value
  if (!settings.bubbles) hideBubble()
  schedule()
})
api.on('presence', value => {
  const now = Date.now(), wasAsleep = asleep(now, base(now))
  away = value.away
  if (!away) {
    if (wasAsleep) startShot('greet', now)
    lastActivity = now
  }
  schedule()
})
api.on('placement', value => { ({ tucked, bubble: bubbleSide } = value); placeBubble(); schedule() })
api.on('pointer', value => { hostPointer(value); if (!pointer && skin) setInteractive(value.inside && hit(value.x, value.y)) })
api.on('drag-direction', value => { if (value !== direction) { direction = value; schedule() } })

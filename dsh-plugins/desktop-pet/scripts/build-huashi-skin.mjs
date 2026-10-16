// Generates the built-in skin 小花狮 (Huashi), the East China Normal University mascot.
// Every pose is assembled from the same parts, so proportions and the ground line
// stay identical between states. The SVG files in skins/ecnu-huashi are this
// script's output; edit here, then run `node scripts/build-huashi-skin.mjs`.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = fileURLToPath(new URL('../skins/ecnu-huashi/', import.meta.url))
const W = 192, H = 208
// Palette sampled from the official 小花狮 artwork (mane #B83040, fur #F0D888), slightly brightened for screens.
const C = {
  line: '#6A3D2C', fur: '#F4DA8C', furShade: '#E6C36A', belly: '#FFF4D8', muzzle: '#FFF9EE',
  mane: '#C3343F', maneDeep: '#A7283A', maneLine: '#86202F', maneLight: '#E0596A',
  emblem: '#A32035', cheek: '#F0B347', nose: '#4A2721', mouth: '#9A2535', tongue: '#F57C8A', eye: '#2B1A17',
  pad: '#FFE9C6', white: '#FFFFFF', star: '#FFD23F', starLine: '#D69A00', drop: '#9BD6FF', dropLine: '#3C8BD9',
}
const HEAD = [96, 89], NECK = [96, 128]
const n = value => Math.round(value * 100) / 100
const pt = ([x, y]) => `${n(x)} ${n(y)}`
const attrs = values => Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== false)
  .map(([key, value]) => `${key}="${typeof value === 'number' ? n(value) : value}"`).join(' ')
const el = (name, values, body) => body === undefined ? `<${name} ${attrs(values)}/>` : `<${name} ${attrs(values)}>${body}</${name}>`
const group = (values, ...body) => body.join('') ? el('g', values, body.join('')) : ''
const rotateAround = ([x, y], [cx, cy], degrees) => {
  const a = degrees * Math.PI / 180, dx = x - cx, dy = y - cy
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]
}
const stroke = (color, width, extra = {}) => ({ fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra })

// An outlined capsule along a straight or curved path: arms, legs and the tail.
function limb({ from, to, via, width, color = C.fur }) {
  const d = `M${pt(from)} ${via ? `Q${pt(via)} ` : 'L'}${pt(to)}`
  return el('path', { d, ...stroke(C.line, width + 5) }) + el('path', { d, ...stroke(color, width) })
}
function paw([x, y], { pad = false, angle = 0 } = {}) {
  return group({ transform: `translate(${pt([x, y])}) rotate(${n(angle)})` },
    el('ellipse', { cx: 0, cy: 0, rx: 10.6, ry: 10, fill: C.fur, stroke: C.line, 'stroke-width': 2.6 }),
    pad ? el('ellipse', { cx: 0, cy: 1, rx: 4.2, ry: 3.4, fill: C.pad }) + ['-4.6 -4', '0 -5.6', '4.6 -4'].map(at => el('circle', { cx: at.split(' ')[0], cy: at.split(' ')[1], r: 1.6, fill: C.pad })).join('') : '')
}
function arm(spec, side) {
  const shoulder = side === 'left' ? [68, 134] : [124, 134]
  return limb({ from: shoulder, via: spec.via, to: spec.to, width: 18 }) + paw(spec.to, spec)
}

// Flower mane: one scalloped silhouette (outline pass, then fill pass), a deeper ring around the face.
function mane() {
  const [cx, cy] = HEAD, petals = []
  for (let i = 0; i < 12; i++) {
    const a = (-90 + i * 30) * Math.PI / 180
    petals.push({ x: cx + 54 * Math.cos(a), y: cy + 50 * Math.sin(a) })
  }
  const petal = (p, extra) => el('circle', { cx: p.x, cy: p.y, r: 20.5, ...extra })
  return petals.map(p => petal(p, { fill: C.maneLine, stroke: C.maneLine, 'stroke-width': 5 })).join('')
    + el('ellipse', { cx, cy, rx: 57, ry: 53, fill: C.mane })
    + petals.map(p => petal(p, { fill: C.mane })).join('')
    + el('ellipse', { cx, cy: cy + 1, rx: 54.5, ry: 49.5, fill: C.maneDeep })
}
function ears() {
  return [[59, 57], [133, 57]].map(([x, y]) => el('circle', { cx: x, cy: y, r: 14, fill: C.fur, stroke: C.line, 'stroke-width': 2.6 })
    + el('circle', { cx: x, cy: y + 1, r: 7.6, fill: C.furShade })).join('')
}

// Face parts. Eyes sit slightly below the face's midline, which reads as younger and softer.
const EYES = [[74, 88], [118, 88]]
function eye([x, y], kind, [lx, ly], side) {
  const ink = { fill: C.eye }
  if (kind === 'closed') return el('path', { d: `M${pt([x - 7, y])} Q${pt([x, y + 6])} ${pt([x + 7, y])}`, ...stroke(C.eye, 2.8) })
  if (kind === 'happy') return el('path', { d: `M${pt([x - 7, y + 3])} Q${pt([x, y - 6.5])} ${pt([x + 7, y + 3])}`, ...stroke(C.eye, 2.8) })
  if (kind === 'squeeze') {
    const s = side === 'left' ? 1 : -1
    return el('path', { d: `M${pt([x - 5 * s, y - 5.5])} L${pt([x + 4 * s, y])} L${pt([x - 5 * s, y + 5.5])}`, ...stroke(C.eye, 2.8) })
  }
  const [rx, ry] = kind === 'wide' ? [8.8, 11] : [8, 10]
  const shine = el('circle', { cx: x + lx + 2.7, cy: y + ly - 3.7, r: kind === 'wide' ? 3.6 : 3.3, fill: C.white }) + el('circle', { cx: x + lx - 2.6, cy: y + ly + 3.9, r: 1.6, fill: C.white })
  return el('ellipse', { cx: x + lx, cy: y + ly, rx, ry, ...ink }) + shine
}
function brows(kind) {
  if (!kind) return ''
  return EYES.map(([x, y], i) => {
    const s = i === 0 ? 1 : -1
    if (kind === 'raised') return el('path', { d: `M${pt([x - 5, y - 15])} Q${pt([x, y - 19])} ${pt([x + 5, y - 15])}`, ...stroke(C.line, 2.4) })
    // worried: the inner ends rise toward the middle of the face
    return el('path', { d: `M${pt([x - 6 * s, y - 12])} L${pt([x + 5 * s, y - 16.5])}`, ...stroke(C.line, 2.4) })
  }).join('')
}
function mouth(kind) {
  const philtrum = el('path', { d: 'M96 102.5 L96 106', ...stroke(C.nose, 2.2) })
  const tongue = id => el('clipPath', { id }, el('path', { d: tongueClip })) + el('ellipse', { cx: 96, cy: 117, rx: 6.2, ry: 4.4, fill: C.tongue, 'clip-path': `url(#${id})` })
  let tongueClip
  switch (kind) {
    case 'smile':
      tongueClip = 'M86.5 106 Q96 108.5 105.5 106 Q104 117.5 96 118 Q88 117.5 86.5 106Z'
      return philtrum + el('path', { d: tongueClip, fill: C.mouth, stroke: C.line, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }) + tongue('tongue-smile')
    case 'laugh':
      tongueClip = 'M84 105 Q96 108 108 105 Q107 122.5 96 123 Q85 122.5 84 105Z'
      return philtrum + el('path', { d: tongueClip, fill: C.mouth, stroke: C.line, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }) + tongue('tongue-laugh')
    case 'w': return philtrum + el('path', { d: 'M86 106.5 Q91 112 96 106.5 Q101 112 106 106.5', ...stroke(C.line, 2.4) })
    case 'o': return philtrum + el('ellipse', { cx: 96, cy: 111.5, rx: 4.2, ry: 5, fill: C.mouth, stroke: C.line, 'stroke-width': 2 })
    case 'small': return el('ellipse', { cx: 96, cy: 109, rx: 2.6, ry: 3, fill: C.mouth, stroke: C.line, 'stroke-width': 1.8 })
    case 'frown': return philtrum + el('path', { d: 'M89 113 Q96 107.5 103 113', ...stroke(C.line, 2.4) })
    case 'wavy': return el('path', { d: 'M86.5 111 q2.4 -3 4.8 0 t4.8 0 t4.8 0 t4.8 0', ...stroke(C.line, 2.2) })
    default: throw Error('Unknown mouth ' + kind)
  }
}
function face({ eyes = 'open', mouth: mouthKind = 'smile', brows: browKind, look = [0, 0], blush = 1 }) {
  return el('path', { d: 'M96 47C125 47 145 66 146 93C147 117 125 131 96 131C67 131 45 117 46 93C47 66 67 47 96 47Z', fill: C.fur, stroke: C.line, 'stroke-width': 2.8 })
    + group({ transform: 'translate(0 4)' },
      el('ellipse', { cx: 96, cy: 106, rx: 29.5, ry: 18, fill: C.muzzle }),
      [[63.5, 101], [128.5, 101]].map(([x, y]) => el('ellipse', { cx: x, cy: y, rx: 9.6, ry: 6.4, fill: C.cheek, 'fill-opacity': 0.55 * blush })).join(''),
      EYES.map((at, i) => eye(at, eyes, look, i === 0 ? 'left' : 'right')).join(''),
      brows(browKind),
      el('path', { d: 'M89.5 97 Q96 93.8 102.5 97 Q101.2 102.4 96 103.2 Q90.8 102.4 89.5 97Z', fill: C.nose }),
      el('ellipse', { cx: 93.6, cy: 97.2, rx: 1.8, ry: 1, fill: C.white, 'fill-opacity': 0.55 }),
      mouth(mouthKind))
}

// Center of the ECNU emblem: white ring, red disc and the white tree, traced from the
// official artwork (1024 px units around the emblem center, strokes 40 units wide).
function emblem([cx, cy], radius) {
  const tree = [
    'M0 -270V240',
    ...[-228, -147, -66, 15].map(y => `M-186.5 ${y + 140}L0 ${y}L186.5 ${y + 140}`),
    'M-166.5 221L0 96L166.5 221',
    'M-141.5 -174V-122M141.5 -174V-122M-141.5 -41V121M141.5 -41V121',
  ].join('')
  return el('g', { transform: `translate(${pt([cx, cy])}) scale(${(radius / 335).toFixed(5)})` },
    el('circle', { r: 335, fill: C.white }) + el('circle', { r: 315, fill: C.emblem }) + el('path', { d: tree, ...stroke(C.white, 40) }))
}
// U-shaped bib as in the official artwork, emblem in the middle.
function collar() {
  // The top edge stays under the chin, so only the rounded lower part shows.
  return el('path', { d: 'M70 114 Q96 126 122 114 L127 131 C127 151 112 163 96 163 C80 163 65 151 65 131Z', fill: C.mane, stroke: C.maneLine, 'stroke-width': 2.6, 'stroke-linejoin': 'round' })
    + emblem([96, 146], 10.5)
}
function body({ sitting = false } = {}) {
  const d = sitting ? 'M72 122C56 138 51 166 57 182C63 196 81 200 96 200C111 200 129 196 135 182C141 166 136 138 120 122Z'
    : 'M74 120C60 134 54 158 58 175C62 189 80 194 96 194C112 194 130 189 134 175C138 158 132 134 118 120Z'
  return el('path', { d, fill: C.fur, stroke: C.line, 'stroke-width': 2.8, 'stroke-linejoin': 'round' })
    + el('ellipse', { cx: 96, cy: sitting ? 176 : 170, rx: 22, ry: 18, fill: C.belly })
}
function legs(kind) {
  if (kind === 'sit') return [[75, 190, -16], [117, 190, 16]].map(([x, y, a]) => group({ transform: `translate(${x} ${y}) rotate(${a})` },
    el('ellipse', { cx: 0, cy: 0, rx: 14, ry: 10.5, fill: C.fur, stroke: C.line, 'stroke-width': 2.6 }),
    el('ellipse', { cx: 0, cy: 1.8, rx: 5.4, ry: 4.2, fill: C.pad }),
    ...[-5.4, 0, 5.4].map(x => el('circle', { cx: x, cy: -4.6, r: 1.9, fill: C.pad })))).join('')
  if (kind === 'dangle') return limb({ from: [83, 182], to: [79, 195], width: 21 }) + limb({ from: [109, 182], to: [113, 195], width: 21 })
  return [79, 113].map(x => el('ellipse', { cx: x, cy: 191.5, rx: 14, ry: 8, fill: C.fur, stroke: C.line, 'stroke-width': 2.6 })
    + [-4.5, 4.5].map(dx => el('path', { d: `M${x + dx} ${195.5} v2.6`, ...stroke(C.line, 1.8) })).join('')).join('')
}
function tail(angle = 0) {
  const base = [122, 182], via = rotateAround([158, 194], base, angle), tip = rotateAround([158, 160], base, angle)
  const tuft = group({ transform: `translate(${pt(tip)}) rotate(${n(angle)})` },
    el('path', { d: 'M0 6 C-10 2 -11 -9 -4 -16 C-2 -10 1 -9 2 -4 C4 -11 9 -14 13 -11 C11 -6 12 0 8 4 C5 7 2 7 0 6Z', fill: C.mane, stroke: C.maneLine, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }))
  return limb({ from: base, via, to: tip, width: 5.4 }) + tuft
}

// Small props drawn in front of the character.
const star = ([x, y], r = 6) => el('path', { d: `M${x} ${y - r} Q${x + r * 0.22} ${y - r * 0.22} ${x + r} ${y} Q${x + r * 0.22} ${y + r * 0.22} ${x} ${y + r} Q${x - r * 0.22} ${y + r * 0.22} ${x - r} ${y} Q${x - r * 0.22} ${y - r * 0.22} ${x} ${y - r}Z`, fill: C.star, stroke: C.starLine, 'stroke-width': 1.4, 'stroke-linejoin': 'round' })
const drop = ([x, y]) => el('path', { d: `M${x} ${y - 8} C${x + 5} ${y - 2} ${x + 6} ${y + 2} ${x + 3.5} ${y + 4.5} C${x + 1.5} ${y + 6.5} ${x - 1.5} ${y + 6.5} ${x - 3.5} ${y + 4.5} C${x - 6} ${y + 2} ${x - 5} ${y - 2} ${x} ${y - 8}Z`, fill: C.drop, stroke: C.dropLine, 'stroke-width': 1.6 })
const zee = ([x, y], s) => el('path', { d: `M${x} ${y} h${s} l${-s} ${s * 1.1} h${s}`, ...stroke('#6C7BA8', Math.max(1.8, s / 4)) })
const book = page => group({},
  el('rect', { x: 70, y: 143, width: 52, height: 36, rx: 4.5, fill: '#3E7CC9', stroke: C.line, 'stroke-width': 2.6, transform: 'rotate(-3 96 161)' }),
  el('rect', { x: 70, y: 143, width: 8, height: 36, rx: 3, fill: '#2F63A6', transform: 'rotate(-3 96 161)' }),
  el('rect', { x: 85, y: 153, width: 25, height: 13, rx: 3, fill: C.white, 'fill-opacity': 0.92, transform: 'rotate(-3 96 161)' }),
  page ? el('path', { d: 'M106 144 Q117 129 130 133 Q125 142 121 148Z', fill: C.white, stroke: C.line, 'stroke-width': 2, 'stroke-linejoin': 'round' }) : '')

// One pose = parts with their per-state parameters.
function pose(spec) {
  const arms = spec.arms ?? {}
  const left = arms.left ?? { to: [56, 162], via: [56, 146] }, right = arms.right ?? { to: [136, 162], via: [136, 146] }
  const back = [left.front ? '' : arm(left, 'left'), right.front ? '' : arm(right, 'right')].join('')
  const front = [left.front ? arm(left, 'left') : '', right.front ? arm(right, 'right') : ''].join('')
  // The mane sits behind the body and bib; the face sits on top of the bib, as in the official artwork.
  const tilt = spec.tilt ? `rotate(${spec.tilt} ${pt(NECK)})` : undefined
  const shadow = spec.shadow === false ? '' : el('ellipse', { cx: 96, cy: 200, rx: 40 * (spec.shadow ?? 1), ry: 5.5 * (spec.shadow ?? 1), fill: '#000', 'fill-opacity': 0.14 })
  // Standing legs tuck under the body; sitting feet point toward the viewer, in front of it.
  const sitting = spec.legs === 'sit'
  const character = group({ transform: spec.transform }, tail(spec.tail ?? 0), group({ transform: tilt }, mane()),
    sitting ? '' : legs(spec.legs ?? 'stand'), body({ sitting }), sitting ? legs('sit') : '', back, collar(),
    group({ transform: tilt }, ears(), face(spec.face ?? {}), spec.headProps ?? ''), spec.props ?? '', front)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${shadow}${character}${spec.overlay ?? ''}</svg>\n`
}

const up = (to, via, extra = {}) => ({ to, via, pad: true, front: true, ...extra })
const poses = {
  idle: {},
  blink: { face: { eyes: 'closed', mouth: 'smile' } },
  'wag-1': { tail: -14, face: { eyes: 'happy', mouth: 'w' } },
  'wag-2': { tail: 10, face: { eyes: 'happy', mouth: 'w' } },
  greet: { arms: { right: up([147, 98], [140, 124], { angle: -18 }) }, face: { mouth: 'laugh' } },
  'greet-2': { arms: { right: up([152, 106], [141, 126], { angle: 12 }) }, face: { mouth: 'laugh' } },
  think: { tilt: -5, arms: { right: { to: [110, 127], via: [136, 142], front: true }, left: { to: [94, 162], via: [70, 162], front: true } }, face: { look: [2.2, -2.6], mouth: 'o', brows: 'raised' } },
  'work-1': { arms: { left: { to: [70, 160], via: [62, 152], front: true }, right: { to: [122, 158], via: [130, 152], front: true } }, props: book(false), face: { look: [0, 2.8], mouth: 'w' } },
  'work-2': { arms: { left: { to: [70, 160], via: [62, 152], front: true }, right: { to: [121, 144], via: [134, 148], front: true } }, props: book(true), face: { look: [1.6, 2.4], mouth: 'o' } },
  'work-3': { tilt: 3, arms: { left: { to: [70, 160], via: [62, 152], front: true }, right: { to: [122, 158], via: [130, 152], front: true } }, props: book(false), face: { look: [2.2, 2.8], mouth: 'w' } },
  'attention-1': { arms: { left: up([52, 74], [60, 108], { angle: -8 }) }, face: { eyes: 'wide', mouth: 'o', brows: 'raised', look: [2, 0] } },
  'attention-2': { tilt: 4, arms: { left: up([50, 78], [59, 110], { angle: -16 }) }, face: { eyes: 'wide', mouth: 'o', brows: 'raised', look: [-2, 0] } },
  'happy-1': { arms: { left: up([46, 96], [58, 120], { angle: -20 }), right: up([146, 96], [134, 120], { angle: 20 }) }, face: { eyes: 'happy', mouth: 'laugh' },
    overlay: star([30, 58]) + star([164, 50], 7) + star([158, 82], 4.5) },
  'happy-2': { arms: { left: up([48, 110], [58, 126], { angle: -34 }), right: up([144, 110], [134, 126], { angle: 34 }) }, face: { eyes: 'happy', mouth: 'laugh' },
    overlay: star([34, 52], 4.5) + star([160, 56], 5) + star([162, 86], 6) },
  'failed-1': { tilt: -3, transform: 'translate(0 2)', face: { eyes: 'squeeze', mouth: 'wavy' }, headProps: drop([142, 66]) },
  'failed-2': { face: { look: [0, 2.2], mouth: 'frown', brows: 'worried', blush: 0.6 } },
  sleep: { legs: 'sit', tilt: 7, arms: { left: { to: [84, 170], via: [66, 162], front: true }, right: { to: [108, 170], via: [126, 162], front: true } },
    face: { eyes: 'closed', mouth: 'small' }, headProps: el('circle', { cx: 106, cy: 109, r: 7, fill: '#D6EEFF', 'fill-opacity': 0.85, stroke: '#7DB7E8', 'stroke-width': 1.4 }),
    overlay: zee([150, 34], 10) + zee([166, 18], 7) },
  drag: { legs: 'dangle', shadow: false, transform: 'translate(0 -4)', arms: { left: up([58, 104], [62, 126], { angle: -10 }), right: up([134, 104], [130, 126], { angle: 10 }) },
    face: { eyes: 'wide', mouth: 'o', brows: 'raised' }, tail: 18 },
  'react-1': { transform: 'translate(96 200) scale(1.07 0.9) translate(-96 -200)', face: { eyes: 'happy', mouth: 'w' } },
  'react-2': { transform: 'translate(0 -14)', shadow: 0.7, arms: { left: up([50, 104], [60, 124], { angle: -16 }), right: up([142, 104], [132, 124], { angle: 16 }) }, face: { eyes: 'wide', mouth: 'laugh' }, tail: -10 },
  'react-3': { face: { eyes: 'happy', mouth: 'laugh' } },
  peek: { transform: 'translate(8 0) rotate(-9 96 200)', arms: { left: up([50, 112], [58, 130], { angle: -26 }) }, face: { look: [-2.6, 0], mouth: 'smile' } },
}

const manifest = {
  schemaVersion: 1,
  id: 'ecnu-huashi',
  name: { 'zh-CN': '小花狮', en: 'Huashi' },
  description: { 'zh-CN': '华东师范大学的吉祥物小花狮。', en: 'The East China Normal University mascot.' },
  author: 'EduWork contributors (drawing); character © East China Normal University',
  license: 'LicenseRef-ECNU-Mascot',
  frame: { width: W, height: H },
  anchors: { badge: [150, 34] },
  animations: {
    idle: { frames: ['idle.svg', 'blink.svg'], fps: 7, playback: 'blink' },
    wag: { frames: ['wag-1.svg', 'wag-2.svg'], fps: 5, playback: 'pingpong', repeat: 3 },
    greet: { frames: ['greet.svg', 'greet-2.svg'], fps: 4, repeat: 3 },
    think: { image: 'think.svg' },
    work: { frames: ['work-1.svg', 'work-2.svg', 'work-3.svg'], fps: 2, frameMs: [900, 500, 900] },
    attention: { frames: ['attention-1.svg', 'attention-2.svg'], fps: 1.5 },
    done: { frames: ['happy-1.svg', 'happy-2.svg'], fps: 3, motion: 'hop' },
    failed: { frames: ['failed-1.svg', 'failed-2.svg'], playback: 'once', frameMs: [1600, 1] },
    sleep: { image: 'sleep.svg' },
    drag: { image: 'drag.svg', motion: 'dangle' },
    react: { frames: ['react-1.svg', 'react-2.svg', 'react-3.svg'], playback: 'once', frameMs: [140, 260, 700] },
    peek: { image: 'peek.svg' },
  },
  states: { idle: ['idle', 'wag', 'greet'], working: ['think', 'work'] },
  lines: {
    done: { 'zh-CN': ['做完啦，点我看看！'], en: ['Done! Click me.'] },
    attention: { 'zh-CN': ['需要你来看一下～'], en: ['I need your input.'] },
    failed: { 'zh-CN': ['遇到一点问题…'], en: ['Something went wrong.'] },
  },
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const [name, spec] of Object.entries(poses)) writeFileSync(join(out, name + '.svg'), pose(spec))
writeFileSync(join(out, 'skin.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Wrote ${Object.keys(poses).length} poses to ${out}`)

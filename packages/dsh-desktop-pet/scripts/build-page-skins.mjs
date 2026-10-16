// Generates the built-in skins 小页 (Page): a chubby sheet of paper with the
// folded corner of the EduWork logo and a bookmark ribbon sticking out of its
// top edge. Two palettes match the app's red (default) and blue visual styles.
// The SVG files in skins/ are this script's output; edit here, then run
// `node scripts/build-page-skins.mjs`. Artwork license: CC BY 4.0.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../skins/', import.meta.url))
const W = 192, H = 208
const BASE = {
  line: '#3D3A57', paper: '#FFFCF3', paperShade: '#F1E9D6', flap: '#FFFFFF', flapShade: '#E4D9BF',
  rule: '#BCD0EE', margin: '#EBA5AE', crease: '#CDBF9F',
  cheek: '#FF8FA3', mouth: '#9A2535', tongue: '#F57C8A', eye: '#2A2838', white: '#FFFFFF',
  star: '#FFD23F', starLine: '#D69A00', drop: '#9BD6FF', dropLine: '#3C8BD9',
  pencil: '#FFC94A', pencilShade: '#E9A92C', wood: '#F6D9A6', eraser: '#F59AA6', ferrule: '#B9BFCB',
}
const PALETTES = {
  'eduwork-page': { ribbon: '#B42C3D', ribbonLight: '#D45A68', ribbonLine: '#6E1825', name: { 'zh-CN': '小页', en: 'Page' } },
  'eduwork-page-blue': { ribbon: '#2575FF', ribbonLight: '#6FA3FF', ribbonLine: '#143F8F', name: { 'zh-CN': '小页（蓝）', en: 'Page (blue)' } },
}
let C = BASE
const n = value => Math.round(value * 100) / 100
const pt = ([x, y]) => `${n(x)} ${n(y)}`
const attrs = values => Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== false)
  .map(([key, value]) => `${key}="${typeof value === 'number' ? n(value) : value}"`).join(' ')
const el = (name, values, body) => body === undefined ? `<${name} ${attrs(values)}/>` : `<${name} ${attrs(values)}>${body}</${name}>`
const group = (values, ...body) => body.join('') ? el('g', values, body.join('')) : ''
const stroke = (color, width, extra = {}) => ({ fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra })

function limb({ from, to, via, width, color = C.paper }) {
  const d = `M${pt(from)} ${via ? `Q${pt(via)} ` : 'L'}${pt(to)}`
  return el('path', { d, ...stroke(C.line, width + 5) }) + el('path', { d, ...stroke(color, width) })
}
function paw([x, y]) { return el('circle', { cx: x, cy: y, r: 9.2, fill: C.paper, stroke: C.line, 'stroke-width': 2.6 }) }
// Resting arms are small ovals hugging the sides; reaching arms are outlined capsules.
function arm(spec, side) {
  if (spec.rest) {
    const [x, angle] = side === 'left' ? [30, 18] : [162, -18]
    return el('ellipse', { cx: x, cy: 152, rx: 9.2, ry: 13.5, transform: `rotate(${angle} ${x} 152)`, fill: C.paper, stroke: C.line, 'stroke-width': 2.6 })
  }
  const shoulder = side === 'left' ? [44, 146] : [148, 146]
  return limb({ from: shoulder, via: spec.via, to: spec.to, width: 15 }) + paw(spec.to)
}

// The sheet: rounded corners and chubby sides, the top-right corner cut along the fold.
const SHEET = 'M33 102C33 74 50 58 78 58Q102 56 124 58L159 93C161 118 161 146 159 164C157 186 132 195 96 195C60 195 35 186 33 164C31 142 31 122 33 102Z'
function sheet({ creased = false, ruled = true }) {
  const clip = el('clipPath', { id: 'sheet' }, el('path', { d: SHEET }))
  const lines = ruled ? group({ 'clip-path': 'url(#sheet)' },
    ...[163, 173, 183].map(y => el('path', { d: `M28 ${y}H164`, ...stroke(C.rule, 1.5, { 'stroke-opacity': 0.8 }) })),
    el('path', { d: 'M48 150V198', ...stroke(C.margin, 1.5, { 'stroke-opacity': 0.8 }) }),
    el('path', { d: 'M146 96C152 124 152 154 147 174C142 188 126 194 110 196L164 198L164 90Z', fill: C.paperShade, 'fill-opacity': 0.7 })) : ''
  const creases = creased ? group({ 'clip-path': 'url(#sheet)' },
    el('path', { d: 'M36 126L58 134L50 150L74 160M156 118L134 130L144 146L122 156M66 178L86 168L100 182L120 172', ...stroke(C.crease, 1.8) })) : ''
  return clip + el('path', { d: SHEET, fill: C.paper }) + lines + creases
    + el('path', { d: SHEET, fill: 'none', stroke: C.line, 'stroke-width': 2.8, 'stroke-linejoin': 'round' })
}
// The folded corner from the EduWork logo. `lifted` turns it up like a perked ear.
function flap(kind = 'folded') {
  if (kind === 'lifted') return el('path', { d: 'M124 58L159 93L165 52Z', fill: C.paper, stroke: C.line, 'stroke-width': 2.6, 'stroke-linejoin': 'round' })
    + el('path', { d: 'M130 62L158 89L161 62Z', fill: C.paperShade, 'fill-opacity': 0.6 })
  return el('path', { d: 'M126 61L159 94L127 96Z', fill: C.flapShade, 'fill-opacity': 0.7 })
    + el('path', { d: 'M124 58L159 93L124 93Z', fill: C.flap, stroke: C.line, 'stroke-width': 2.6, 'stroke-linejoin': 'round' })
}
// Bookmark ribbon leaving the top edge, drawn behind the sheet; `sway` bends it in degrees.
function ribbon(sway = 0) {
  return group({ transform: `rotate(${sway} 72 60)` },
    el('path', { d: 'M63 62C62 52 58 45 50 40L44 37L50 34L47 28L55 31C67 37 75 47 78 62Z', fill: C.ribbon, stroke: C.ribbonLine, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }),
    el('path', { d: 'M70 59C68 51 63 45 56 40', ...stroke(C.ribbonLight, 2.4) }))
}
function feet(kind) {
  if (kind === 'sit') return [[68, 191, -16], [124, 191, 16]].map(([x, y, a]) => group({ transform: `translate(${x} ${y}) rotate(${a})` },
    el('ellipse', { cx: 0, cy: 0, rx: 13, ry: 9.5, fill: C.paper, stroke: C.line, 'stroke-width': 2.6 }),
    el('ellipse', { cx: 0, cy: 1.5, rx: 5, ry: 3.8, fill: C.paperShade }))).join('')
  if (kind === 'dangle') return limb({ from: [78, 186], to: [75, 199], width: 17 }) + limb({ from: [114, 186], to: [117, 199], width: 17 })
  return [75, 117].map(x => el('ellipse', { cx: x, cy: 193, rx: 13, ry: 7, fill: C.paper, stroke: C.line, 'stroke-width': 2.6 })).join('')
}

// Face: eyes slightly below the middle of the sheet, no nose, pink cheeks.
const EYES = [[72, 116], [120, 116]]
function eye([x, y], kind, [lx, ly], side) {
  if (kind === 'closed') return el('path', { d: `M${pt([x - 7.5, y])} Q${pt([x, y + 6.5])} ${pt([x + 7.5, y])}`, ...stroke(C.eye, 2.8) })
  if (kind === 'happy') return el('path', { d: `M${pt([x - 7.5, y + 3])} Q${pt([x, y - 7])} ${pt([x + 7.5, y + 3])}`, ...stroke(C.eye, 2.8) })
  if (kind === 'squeeze') {
    const s = side === 'left' ? 1 : -1
    return el('path', { d: `M${pt([x - 5 * s, y - 5.5])} L${pt([x + 4 * s, y])} L${pt([x - 5 * s, y + 5.5])}`, ...stroke(C.eye, 2.8) })
  }
  const [rx, ry] = kind === 'wide' ? [9, 11.2] : [8.2, 10.2]
  return el('ellipse', { cx: x + lx, cy: y + ly, rx, ry, fill: C.eye })
    + el('circle', { cx: x + lx + 2.8, cy: y + ly - 3.8, r: kind === 'wide' ? 3.7 : 3.4, fill: C.white })
    + el('circle', { cx: x + lx - 2.6, cy: y + ly + 4, r: 1.6, fill: C.white })
}
function brows(kind) {
  if (!kind) return ''
  return EYES.map(([x, y], i) => {
    const s = i === 0 ? 1 : -1
    if (kind === 'raised') return el('path', { d: `M${pt([x - 5, y - 16])} Q${pt([x, y - 20])} ${pt([x + 5, y - 16])}`, ...stroke(C.line, 2.4) })
    return el('path', { d: `M${pt([x - 6 * s, y - 13])} L${pt([x + 5 * s, y - 17.5])}`, ...stroke(C.line, 2.4) })
  }).join('')
}
function mouth(kind) {
  const open = (id, d, tongueY) => el('path', { d, fill: C.mouth, stroke: C.line, 'stroke-width': 2.2, 'stroke-linejoin': 'round' })
    + el('clipPath', { id }, el('path', { d })) + el('ellipse', { cx: 96, cy: tongueY, rx: 6, ry: 4.2, fill: C.tongue, 'clip-path': `url(#${id})` })
  switch (kind) {
    case 'smile': return open('m-smile', 'M88 114 Q96 116.5 104 114 Q102.5 124 96 124.5 Q89.5 124 88 114Z', 123.5)
    case 'laugh': return open('m-laugh', 'M85.5 113 Q96 116 106.5 113 Q105.5 129 96 129.5 Q86.5 129 85.5 113Z', 128.5)
    case 'w': return el('path', { d: 'M87 114 Q91.5 119.5 96 114 Q100.5 119.5 105 114', ...stroke(C.line, 2.4) })
    case 'o': return el('ellipse', { cx: 96, cy: 118, rx: 4.2, ry: 5, fill: C.mouth, stroke: C.line, 'stroke-width': 2 })
    case 'small': return el('ellipse', { cx: 96, cy: 117, rx: 2.6, ry: 3, fill: C.mouth, stroke: C.line, 'stroke-width': 1.8 })
    case 'frown': return el('path', { d: 'M89 121 Q96 115.5 103 121', ...stroke(C.line, 2.4) })
    case 'wavy': return el('path', { d: 'M86.5 119 q2.4 -3 4.8 0 t4.8 0 t4.8 0 t4.8 0', ...stroke(C.line, 2.2) })
    default: throw Error('Unknown mouth ' + kind)
  }
}
function face({ eyes = 'open', mouth: mouthKind = 'smile', brows: browKind, look = [0, 0], blush = 1 }) {
  return [[56, 131], [136, 131]].map(([x, y]) => el('ellipse', { cx: x, cy: y, rx: 10, ry: 6.4, fill: C.cheek, 'fill-opacity': 0.5 * blush })).join('')
    + EYES.map((at, i) => eye(at, eyes, look, i === 0 ? 'left' : 'right')).join('')
    + brows(browKind) + group({ transform: 'translate(0 14)' }, mouth(mouthKind))
}

// Props.
const star = ([x, y], r = 6) => el('path', { d: `M${x} ${y - r} Q${x + r * 0.22} ${y - r * 0.22} ${x + r} ${y} Q${x + r * 0.22} ${y + r * 0.22} ${x} ${y + r} Q${x - r * 0.22} ${y + r * 0.22} ${x - r} ${y} Q${x - r * 0.22} ${y - r * 0.22} ${x} ${y - r}Z`, fill: C.star, stroke: C.starLine, 'stroke-width': 1.4, 'stroke-linejoin': 'round' })
const drop = ([x, y]) => el('path', { d: `M${x} ${y - 8} C${x + 5} ${y - 2} ${x + 6} ${y + 2} ${x + 3.5} ${y + 4.5} C${x + 1.5} ${y + 6.5} ${x - 1.5} ${y + 6.5} ${x - 3.5} ${y + 4.5} C${x - 6} ${y + 2} ${x - 5} ${y - 2} ${x} ${y - 8}Z`, fill: C.drop, stroke: C.dropLine, 'stroke-width': 1.6 })
const zee = ([x, y], s) => el('path', { d: `M${x} ${y} h${s} l${-s} ${s * 1.1} h${s}`, ...stroke('#6C7BA8', Math.max(1.8, s / 4)) })
// A pencil from its tip; `angle` in degrees, 0 = pointing down.
const pencil = ([x, y], angle) => group({ transform: `translate(${pt([x, y])}) rotate(${n(angle)})` },
  el('path', { d: 'M0 0L-4.6 -9H4.6Z', fill: C.wood, stroke: C.line, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
  el('path', { d: 'M0 0L-1.6 -3.2H1.6Z', fill: C.line }),
  el('rect', { x: -4.6, y: -40, width: 9.2, height: 31, fill: C.pencil, stroke: C.line, 'stroke-width': 1.8 }),
  el('path', { d: 'M1.5 -39V-10', ...stroke(C.pencilShade, 2) }),
  el('rect', { x: -4.6, y: -46, width: 9.2, height: 6, fill: C.ferrule, stroke: C.line, 'stroke-width': 1.8 }),
  el('path', { d: 'M-4.6 -46V-49A4.6 4.6 0 0 1 4.6 -49V-46Z', fill: C.eraser, stroke: C.line, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }))
const scribble = length => el('path', { d: ['M58 161q4 -5 8 0t8 0', 'M58 161q4 -5 8 0t8 0t8 0t8 0', 'M58 161q4 -5 8 0t8 0t8 0t8 0t8 0 M58 171q4 -5 8 0t8 0'][length], ...stroke(C.line, 2) })
const plane = ([x, y], scale = 1, angle = -12) => group({ transform: `translate(${pt([x, y])}) rotate(${angle}) scale(${scale})` },
  el('path', { d: 'M-16 2L18 -6L-4 10Z', fill: C.white, stroke: C.line, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
  el('path', { d: 'M-16 2L18 -6L-6 -2Z', fill: C.paperShade, stroke: C.line, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
  el('path', { d: 'M-4 10L-6 -2', ...stroke(C.line, 1.6) }))
const motion = (x, y) => el('path', { d: `M${x} ${y}h-12M${x + 4} ${y + 7}h-14M${x} ${y + 14}h-10`, ...stroke('#A9B6CC', 2) })

function pose(spec) {
  const arms = spec.arms ?? {}
  const left = arms.left ?? { rest: true, front: true }, right = arms.right ?? { rest: true, front: true }
  const back = [left.front ? '' : arm(left, 'left'), right.front ? '' : arm(right, 'right')].join('')
  const front = [left.front ? arm(left, 'left') : '', right.front ? arm(right, 'right') : ''].join('')
  const shadow = spec.shadow === false ? '' : el('ellipse', { cx: 96, cy: 200, rx: 44 * (spec.shadow ?? 1), ry: 5.5 * (spec.shadow ?? 1), fill: '#000', 'fill-opacity': 0.13 })
  const sitting = spec.feet === 'sit'
  const character = group({ transform: spec.transform },
    ribbon(spec.ribbon ?? 0), sitting ? '' : feet(spec.feet ?? 'stand'), back, sheet(spec.sheet ?? {}), flap(spec.flap), sitting ? feet('sit') : '',
    spec.props ?? '', face(spec.face ?? {}), spec.headProps ?? '', spec.front ?? '', front)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${shadow}${character}${spec.overlay ?? ''}</svg>\n`
}

// Raised arms come out from behind the sides of the sheet.
const up = (to, via) => ({ to, via })
// Writing on its own ruled belly: the left paw holds the pencil, the right one rests.
const write = (tip, look, mouthKind, length) => ({ arms: { left: { to: [tip[0] - 16, tip[1] - 19], via: [48, 152], front: true } },
  front: pencil(tip, -40), props: scribble(length), face: { look, mouth: mouthKind } })
const poses = {
  idle: {},
  blink: { face: { eyes: 'closed' } },
  'flap-1': { flap: 'lifted', ribbon: -8, face: { eyes: 'happy', mouth: 'w' } },
  'flap-2': { face: { eyes: 'happy', mouth: 'w' } },
  greet: { arms: { right: up([166, 100], [168, 126]) }, face: { mouth: 'laugh' } },
  'greet-2': { arms: { right: up([172, 110], [168, 130]) }, face: { mouth: 'laugh' } },
  think: { transform: 'rotate(-4 96 194)', arms: { left: { to: [76, 146], via: [46, 166], front: true } }, face: { look: [2.4, -2.8], mouth: 'o', brows: 'raised' } },
  'work-1': write([74, 161], [-1.6, 2.8], 'w', 0),
  'work-2': write([90, 161], [0, 2.8], 'o', 1),
  'work-3': write([74, 171], [-1.2, 3], 'w', 2),
  'attention-1': { arms: { left: up([28, 88], [26, 118]) }, face: { eyes: 'wide', mouth: 'o', brows: 'raised', look: [2, 0] } },
  'attention-2': { transform: 'rotate(3 96 194)', arms: { left: up([26, 92], [24, 120]) }, face: { eyes: 'wide', mouth: 'o', brows: 'raised', look: [-2, 0] } },
  'happy-1': { flap: 'lifted', arms: { left: up([34, 82], [26, 116]), right: up([160, 100], [164, 126]) }, face: { eyes: 'happy', mouth: 'laugh' },
    overlay: plane([38, 64], 1.05, -14) + star([172, 70], 5) + star([20, 128], 4) },
  'happy-2': { flap: 'lifted', ribbon: 6, arms: { left: up([30, 98], [28, 124]), right: up([162, 98], [164, 124]) }, face: { eyes: 'happy', mouth: 'laugh' },
    overlay: plane([150, 26], 0.85, -24) + motion(126, 32) + star([28, 66], 5) + star([174, 84], 4) },
  'failed-1': { transform: 'translate(0 2)', sheet: { creased: true }, face: { eyes: 'squeeze', mouth: 'wavy' }, headProps: drop([146, 106]) },
  'failed-2': { sheet: { creased: true }, face: { look: [0, 2.2], mouth: 'frown', brows: 'worried', blush: 0.6 } },
  sleep: { feet: 'sit', transform: 'rotate(4 96 194)', arms: { left: { to: [82, 172], via: [48, 168], front: true }, right: { to: [110, 172], via: [144, 168], front: true } },
    face: { eyes: 'closed', mouth: 'small' }, headProps: el('circle', { cx: 106, cy: 131, r: 6.5, fill: '#D6EEFF', 'fill-opacity': 0.85, stroke: '#7DB7E8', 'stroke-width': 1.4 }),
    overlay: zee([156, 16], 10) + zee([172, 4], 7) },
  drag: { feet: 'dangle', flap: 'lifted', ribbon: 12, shadow: false, transform: 'translate(0 -6)', arms: { left: up([30, 108], [32, 126]), right: up([162, 108], [160, 126]) },
    face: { eyes: 'wide', mouth: 'o', brows: 'raised' } },
  'react-1': { transform: 'translate(96 200) scale(1.08 0.9) translate(-96 -200)', face: { eyes: 'happy', mouth: 'w' } },
  'react-2': { flap: 'lifted', ribbon: -10, transform: 'translate(0 -14)', shadow: 0.7, arms: { left: up([24, 100], [28, 124]), right: up([168, 100], [164, 124]) }, face: { eyes: 'wide', mouth: 'laugh' } },
  'react-3': { face: { eyes: 'happy', mouth: 'laugh' } },
  peek: { transform: 'translate(8 0) rotate(-8 96 200)', arms: { left: up([24, 112], [26, 132]) }, face: { look: [-2.6, 0], mouth: 'smile' } },
}

const manifest = (id, palette) => ({
  schemaVersion: 1,
  id,
  name: palette.name,
  description: { 'zh-CN': '从 EduWork 折页标志里长出来的纸页精灵。', en: 'A paper sprite grown from the folded page in the EduWork logo.' },
  author: 'EduWork contributors',
  license: 'CC-BY-4.0',
  frame: { width: W, height: H },
  anchors: { badge: [150, 36] },
  animations: {
    idle: { frames: ['idle.svg', 'blink.svg'], fps: 7, playback: 'blink' },
    flap: { frames: ['flap-1.svg', 'flap-2.svg'], fps: 4, playback: 'pingpong', repeat: 3 },
    greet: { frames: ['greet.svg', 'greet-2.svg'], fps: 4, repeat: 3 },
    think: { image: 'think.svg' },
    work: { frames: ['work-1.svg', 'work-2.svg', 'work-3.svg'], fps: 3 },
    attention: { frames: ['attention-1.svg', 'attention-2.svg'], fps: 1.5 },
    done: { frames: ['happy-1.svg', 'happy-2.svg'], frameMs: [700, 900], motion: 'hop' },
    failed: { frames: ['failed-1.svg', 'failed-2.svg'], playback: 'once', frameMs: [1600, 1] },
    sleep: { image: 'sleep.svg' },
    drag: { image: 'drag.svg', motion: 'dangle' },
    react: { frames: ['react-1.svg', 'react-2.svg', 'react-3.svg'], playback: 'once', frameMs: [140, 260, 700] },
    peek: { image: 'peek.svg' },
  },
  states: { idle: ['idle', 'flap', 'greet'], working: ['think', 'work'] },
  lines: {
    done: { 'zh-CN': ['写好啦，点我看看！'], en: ['All done! Click me.'] },
    attention: { 'zh-CN': ['需要你来看一下～'], en: ['I need your input.'] },
    failed: { 'zh-CN': ['这页出了点问题…'], en: ['Something went wrong.'] },
  },
})

for (const [id, palette] of Object.entries(PALETTES)) {
  C = { ...BASE, ...palette }
  const out = join(root, id)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  for (const [name, spec] of Object.entries(poses)) writeFileSync(join(out, name + '.svg'), pose(spec))
  writeFileSync(join(out, 'skin.json'), JSON.stringify(manifest(id, palette), null, 2) + '\n')
}
console.log(`Wrote ${Object.keys(poses).length} poses for ${Object.keys(PALETTES).join(', ')} to ${root}`)

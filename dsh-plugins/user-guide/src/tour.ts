// First-run tour: a mask highlights one area at a time and ends at the user guide.
// DSH class names change between builds, so targets are found by accessible labels and
// button text. A step whose target is missing is centered and dims the whole window.

import { guideCopy, type GuideCopy, type StepId } from './copy'

export interface Rect { left: number; top: number; width: number; height: number }

export interface TourStep {
  id: StepId
  /** The element to highlight; null centers the card. */
  find?: (doc: Document) => Element | null
}

const visible = (el: Element): boolean => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/** The topmost, then leftmost, visible element whose text equals one of the labels. */
export function findByText(doc: Document, selector: string, labels: string[], within?: (r: DOMRect) => boolean): Element | null {
  const hits = [...doc.querySelectorAll(selector)].filter(el => {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    return labels.includes(text) && visible(el) && (!within || within(el.getBoundingClientRect()))
  })
  hits.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left)
  return hits[0] ?? null
}

/** The first ancestor at least this large (grows the input to the whole composer card). */
export function growTo(el: Element | null, minWidth: number, minHeight: number): Element | null {
  let node: Element | null = el
  for (let i = 0; node && i < 8; i++, node = node.parentElement) {
    const r = node.getBoundingClientRect()
    if (r.width >= minWidth && r.height >= minHeight) return node
  }
  return el
}

const inSidebar = (r: DOMRect) => r.left < 480
export const composerInput = (doc: Document) =>
  [...doc.querySelectorAll('textarea, [contenteditable="true"]')].filter(visible)
    .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] ?? null
const PERMISSIONS = ['仅可查看', '工作区内修改', '完全权限', 'Read Only', 'Workspace Write', 'Full access', 'Auto review']

/** Step order and targets belong to the plugin; copy is selected separately by ID. */
export const STEPS: TourStep[] = [
  {
    id: 'welcome',
  },
  {
    id: 'new-session',
    find: doc => findByText(doc, 'button, a, [role="button"]', ['新会话', 'New Session'], inSidebar),
  },
  {
    id: 'workspaces',
    find: doc => findByText(doc, 'div, span, h2, h3, button', ['工作区', 'Workspaces'], inSidebar),
  },
  {
    id: 'composer',
    find: doc => {
      const input = composerInput(doc)
      return input ? growTo(input, input.getBoundingClientRect().width, 90) : null
    },
  },
  {
    id: 'permission-model',
    find: doc => {
      const permission = findByText(doc, 'button, [role="button"], [role="combobox"]', PERMISSIONS)
      const input = composerInput(doc)
      const width = input ? input.getBoundingClientRect().width * 0.8 : 300
      return permission ? growTo(permission, width, 24) : null
    },
  },
  {
    id: 'skills',
    find: doc => findByText(doc, 'button, a, [role="button"]', ['技能', 'Skills'], inSidebar),
  },
  {
    id: 'files',
    find: doc => doc.querySelector('[aria-label="打开右侧边栏"], [aria-label="收起右侧边栏"], [aria-label="Open right sidebar"], [aria-label="Collapse right sidebar"]'),
  },
  {
    id: 'guide',
  },
]

/** Spacing around the highlight. */
export const PADDING = 6

/** Card position: right of the target, then below, above, left; centered when none fits. */
export function placeCard(target: Rect | null, card: { width: number; height: number }, view: { width: number; height: number }, gap = 14): { left: number; top: number } {
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
  const margin = 16
  if (!target) return { left: (view.width - card.width) / 2, top: (view.height - card.height) / 2 }
  const t = { left: target.left - PADDING, top: target.top - PADDING, right: target.left + target.width + PADDING, bottom: target.top + target.height + PADDING }
  const fitsX = (left: number) => left >= margin && left + card.width <= view.width - margin
  const fitsY = (top: number) => top >= margin && top + card.height <= view.height - margin
  const vertical = clamp(t.top, margin, view.height - card.height - margin)
  const horizontal = clamp(t.left, margin, view.width - card.width - margin)
  const options = [
    { left: t.right + gap, top: vertical, ok: fitsX(t.right + gap) },
    { left: horizontal, top: t.bottom + gap, ok: fitsY(t.bottom + gap) },
    { left: horizontal, top: t.top - gap - card.height, ok: fitsY(t.top - gap - card.height) },
    { left: t.left - gap - card.width, top: vertical, ok: fitsX(t.left - gap - card.width) },
  ]
  const hit = options.find(option => option.ok)
  return hit ? { left: hit.left, top: hit.top } : { left: (view.width - card.width) / 2, top: (view.height - card.height) / 2 }
}

export interface TourOptions {
  copy?: GuideCopy
  onDone: (reason: 'finished' | 'skipped') => void
  onOpenGuide: () => void
  doc?: Document
}

const ROOT_ID = 'eduwork-user-guide-tour'
let stopCurrent: (() => void) | null = null
export const tourRunning = () => stopCurrent !== null
/** Closes a running tour without recording it as seen. */
export function stopTour(): void { stopCurrent?.() }

export function startTour({ copy = guideCopy('zh-CN'), onDone, onOpenGuide, doc = document }: TourOptions): void {
  if (doc.getElementById(ROOT_ID)) return
  const steps = STEPS
  const win = doc.defaultView ?? window
  const root = doc.createElement('div')
  root.id = ROOT_ID
  // A transparent layer blocks the page; the highlight's huge shadow forms the mask.
  root.style.cssText = 'position:fixed;inset:0;z-index:1100;pointer-events:auto'
  const hole = doc.createElement('div')
  hole.setAttribute('aria-hidden', 'true')
  hole.style.cssText = 'position:fixed;border-radius:12px;box-shadow:0 0 0 9999px rgba(8,12,20,.58);'
    + 'outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:0;transition:left .25s ease,top .25s ease,width .25s ease,height .25s ease,opacity .2s'
  const card = doc.createElement('div')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.style.cssText = 'position:fixed;width:340px;max-width:calc(100vw - 32px);box-sizing:border-box;padding:18px 18px 14px;border-radius:14px;'
    + 'background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f1115);border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));'
    + 'box-shadow:0 12px 40px rgba(0,0,0,.28);font-size:14px;line-height:1.7;transition:left .25s ease,top .25s ease'
  const title = doc.createElement('div')
  title.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:6px'
  const body = doc.createElement('div')
  body.style.cssText = 'color:var(--dsw-alias-label-secondary,#4a4f57)'
  const foot = doc.createElement('div')
  foot.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:14px'
  const count = doc.createElement('span')
  count.style.cssText = 'flex:1;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-variant-numeric:tabular-nums'
  const button = (label: string, primary = false) => {
    const b = doc.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.style.cssText = 'font:inherit;font-size:13px;line-height:20px;padding:5px 12px;border-radius:8px;cursor:pointer;'
      + (primary ? 'border:0;background:var(--dsw-alias-state-business-primary,#4176e6);color:var(--dsw-alias-bg-base,#fff)'
        : 'border:.5px solid var(--dsw-alias-border-l4,rgba(0,0,0,.2));background:transparent;color:inherit')
    return b
  }
  const skip = button(copy.ui.skip)
  const back = button(copy.ui.back)
  const next = button(copy.ui.next, true)
  const guide = button(copy.ui.openGuide, true)
  foot.append(count, skip, back, next, guide)
  card.append(title, body, foot)
  root.append(hole, card)

  let index = 0
  let timer: ReturnType<typeof setInterval> | undefined
  const layout = () => {
    const step = steps[index]
    const el = step.find?.(doc) ?? null
    const r = el?.getBoundingClientRect()
    const target = r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
    if (target) {
      hole.style.opacity = '1'
      Object.assign(hole.style, { left: `${target.left - PADDING}px`, top: `${target.top - PADDING}px`, width: `${target.width + PADDING * 2}px`, height: `${target.height + PADDING * 2}px` })
    } else {
      // Centered step: the mask covers everything and the highlight shrinks away.
      Object.assign(hole.style, { left: `${win.innerWidth / 2}px`, top: `${win.innerHeight / 2}px`, width: '0px', height: '0px', opacity: '0' })
    }
    if (!target) root.style.background = 'rgba(8,12,20,.58)'
    else root.style.background = 'transparent'
    const box = card.getBoundingClientRect()
    const at = placeCard(target, { width: box.width || 340, height: box.height || 180 }, { width: win.innerWidth, height: win.innerHeight })
    card.style.left = `${Math.round(at.left)}px`
    card.style.top = `${Math.round(at.top)}px`
  }
  const render = () => {
    const step = steps[index]
    const last = index === steps.length - 1
    title.textContent = copy.steps[step.id].title
    body.textContent = copy.steps[step.id].body
    card.setAttribute('aria-label', copy.steps[step.id].title)
    count.textContent = copy.ui.progress.replaceAll('{current}', String(index + 1)).replaceAll('{total}', String(steps.length))
    back.hidden = index === 0
    next.textContent = last ? copy.ui.done : copy.ui.next
    // On the last step Done turns secondary so Open user guide stands out.
    next.style.background = last ? 'transparent' : 'var(--dsw-alias-state-business-primary,#4176e6)'
    next.style.color = last ? 'inherit' : 'var(--dsw-alias-bg-base,#fff)'
    next.style.border = last ? '.5px solid var(--dsw-alias-border-l4,rgba(0,0,0,.2))' : '0'
    guide.hidden = !last
    skip.hidden = last
    layout()
    ;(last ? guide : next).focus()
  }
  const finish = (reason: 'finished' | 'skipped', notify = true) => {
    if (timer) clearInterval(timer)
    win.removeEventListener('resize', layout)
    doc.removeEventListener('keydown', onKey, true)
    root.remove()
    stopCurrent = null
    if (notify) onDone(reason)
  }
  const go = (delta: number) => {
    const target = index + delta
    if (target >= steps.length) return finish('finished')
    if (target < 0) return
    index = target
    render()
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(index === steps.length - 1 ? 'finished' : 'skipped') }
    else if (event.key === 'ArrowRight') { event.preventDefault(); go(1) }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1) }
  }
  skip.addEventListener('click', () => finish('skipped'))
  back.addEventListener('click', () => go(-1))
  next.addEventListener('click', () => go(1))
  guide.addEventListener('click', () => { finish('finished'); onOpenGuide() })
  doc.addEventListener('keydown', onKey, true)
  win.addEventListener('resize', layout)
  // Sidebars and lists move targets as they load: re-layout periodically.
  timer = setInterval(layout, 400)
  // Unloading the plugin closes the tour without recording it.
  stopCurrent = () => finish('skipped', false)
  doc.body.append(root)
  render()
}

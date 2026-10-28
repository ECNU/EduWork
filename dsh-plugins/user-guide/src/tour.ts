// First-run tour: a mask highlights one area at a time and ends at the user guide.
// DSH class names change between builds, so targets are found by accessible labels and
// button text. A step whose target is missing is centered and dims the whole window.

export interface Rect { left: number; top: number; width: number; height: number }

export interface TourStep {
  id: string
  title: [string, string]
  body: [string, string]
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

/** {product} in titles and bodies is replaced with the distribution's product name. */
export const STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: ['欢迎使用 {product}', 'Welcome to {product}'],
    body: ['花一分钟认识几个常用的地方。随时可以按 Esc 跳过。', 'Take a minute to see where things are. Press Esc to skip at any time.'],
  },
  {
    id: 'new-session',
    title: ['新会话', 'New session'],
    body: ['每个任务从这里开始。一个会话就是一段连续的对话，会记住其中的上下文。聊得太长会变慢，一个阶段做完就新开会话。', 'Start every task here. A session keeps its own conversation and context. Long sessions get slow; start a new one when a stage is done.'],
    find: doc => findByText(doc, 'button, a, [role="button"]', ['新会话', 'New Session'], inSidebar),
  },
  {
    id: 'workspaces',
    title: ['工作区', 'Workspaces'],
    body: ['工作区就是你电脑上的一个文件夹，{product} 只在其中读写文件。会话按创建时所在的文件夹分组。', 'A workspace is a folder on your computer; {product} reads and writes files only inside it. Sessions are grouped by the folder they started in.'],
    find: doc => findByText(doc, 'div, span, h2, h3, button', ['工作区', 'Workspaces'], inSidebar),
  },
  {
    id: 'composer',
    title: ['说明你的任务', 'Describe the task'],
    body: ['写清楚要做什么、相关文件在哪、怎样算完成。输入 @ 引用文件或对话，输入 / 调用指令和技能。', 'Say what to do, where the files are and what done looks like. Type @ to reference files or sessions, / for commands and skills.'],
    find: doc => {
      const input = composerInput(doc)
      return input ? growTo(input, input.getBoundingClientRect().width, 90) : null
    },
  },
  {
    id: 'permission-model',
    title: ['权限与模型', 'Permissions and model'],
    body: ['左边决定它能做什么：「工作区内修改」可以新建、修改工作区里的文件，拿不准时就用它；「完全权限」能改工作区以外的文件和系统设置，要慎用。右边选择模型和推理等级。', 'On the left, choose what it may do: Workspace Write can create and edit files in the workspace and is the safe default; Full Access can change files outside it and system settings, so use it with care. On the right, pick the model and reasoning level.'],
    find: doc => {
      const permission = findByText(doc, 'button, [role="button"], [role="combobox"]', PERMISSIONS)
      const input = composerInput(doc)
      const width = input ? input.getBoundingClientRect().width * 0.8 : 300
      return permission ? growTo(permission, width, 24) : null
    },
  },
  {
    id: 'skills',
    title: ['技能与插件', 'Skills and plugins'],
    body: ['这里列出可用的技能和插件。技能会在需要时自动使用，也可以输入 / 手动调用。', 'Available skills and plugins are listed here. Skills are used when needed, or call them with /.'],
    find: doc => findByText(doc, 'button, a, [role="button"]', ['技能', 'Skills'], inSidebar),
  },
  {
    id: 'files',
    title: ['文件栏', 'Files'],
    body: ['点这里展开右侧栏，浏览工作区里的文件，点开即可预览生成的文档、表格和图片。', 'Open the right sidebar to browse the workspace and preview generated documents, sheets and images.'],
    find: doc => doc.querySelector('[aria-label="打开右侧边栏"], [aria-label="收起右侧边栏"], [aria-label="Open right sidebar"], [aria-label="Collapse right sidebar"]'),
  },
  {
    id: 'guide',
    title: ['想了解更多？', 'Want to learn more?'],
    body: ['《使用教程》介绍了常用功能和常见问题，以后可以在顶部「应用」菜单里随时打开。', 'The user guide covers common tasks and troubleshooting. Open it any time from the application menu.'],
  },
]

export interface StepOverride {
  id: string
  title?: { zh?: string; en?: string }
  body?: { zh?: string; en?: string }
  selector?: string
}

const pair = (value: StepOverride['title'], fallback?: [string, string]): [string, string] =>
  [value?.zh || fallback?.[0] || value?.en || '', value?.en || fallback?.[1] || value?.zh || '']

/**
 * Builds the sequence from distribution settings: an empty list keeps the built-in steps;
 * otherwise the list replaces them in order. Built-in ids keep their target and copy
 * unless overridden; new steps need text and may name a CSS selector. {product} is filled in.
 */
export function resolveSteps(overrides: StepOverride[] = [], product = 'EduWork', builtins: TourStep[] = STEPS): TourStep[] {
  const fill = (p: [string, string]): [string, string] => [p[0].replaceAll('{product}', product), p[1].replaceAll('{product}', product)]
  const byId = new Map(builtins.map(step => [step.id, step]))
  const steps = !overrides.length ? builtins : overrides.flatMap((entry): TourStep[] => {
    const base = byId.get(entry?.id)
    const title = pair(entry?.title, base?.title), body = pair(entry?.body, base?.body)
    if (!entry?.id || !title[0] || !body[0]) return []
    const selector = entry.selector
    const find = selector ? (doc: Document) => { try { return [...doc.querySelectorAll(selector)].find(visible) ?? null } catch { return null } } : base?.find
    return [{ id: entry.id, title, body, ...find ? { find } : {} }]
  })
  return (steps.length ? steps : builtins).map(step => ({ ...step, title: fill(step.title), body: fill(step.body) }))
}

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
  zh: boolean
  onDone: (reason: 'finished' | 'skipped') => void
  onOpenGuide: () => void
  doc?: Document
  steps?: TourStep[]
}

const ROOT_ID = 'eduwork-user-guide-tour'
let stopCurrent: (() => void) | null = null
export const tourRunning = () => stopCurrent !== null
/** Closes a running tour without recording it as seen. */
export function stopTour(): void { stopCurrent?.() }

export function startTour({ zh, onDone, onOpenGuide, doc = document, steps = STEPS }: TourOptions): void {
  if (doc.getElementById(ROOT_ID)) return
  const L = (pair: [string, string]) => pair[zh ? 0 : 1]
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
  const skip = button(zh ? '跳过' : 'Skip')
  const back = button(zh ? '上一步' : 'Back')
  const next = button(zh ? '下一步' : 'Next', true)
  const guide = button(zh ? '打开使用教程' : 'Open user guide', true)
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
    title.textContent = L(step.title)
    body.textContent = L(step.body)
    card.setAttribute('aria-label', L(step.title))
    count.textContent = `${index + 1} / ${steps.length}`
    back.hidden = index === 0
    next.textContent = last ? (zh ? '完成' : 'Done') : (zh ? '下一步' : 'Next')
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

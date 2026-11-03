// Opens the bundled user guide (Host route /eduwork-user-guide/) in an in-app panel, from the
// application menu or, where a distribution provides one, the account menu; and plays the
// first-run tour once. The panel is plain DOM on <body> so it outlives the menu that opened it.

import { createElement } from 'react'
import { composerInput, resolveSteps, startTour, stopTour, tourRunning, type StepOverride } from './tour'

export const inject = ['configForms']

export const PLUGIN_ID = 'eduwork-user-guide'
export const GUIDE_URL = '/eduwork-user-guide/'
export const TOUR_URL = '/eduwork-user-guide/tour.json'
/** Dispatched by the desktop shell's "Application → User Guide" item. */
export const OPEN_EVENT = 'eduwork:open-user-guide'
const PANEL_ID = 'eduwork-user-guide-panel'
const h = createElement

export interface TourSettings { productName: string; autoStart: boolean; steps: StepOverride[] }
const DEFAULTS: TourSettings = { productName: 'EduWork', autoStart: true, steps: [] }
let settings: TourSettings = DEFAULTS

/** Follows <html lang>, like the rest of the client. */
const uiZh = () => String(document.documentElement.lang || navigator.language || 'zh').toLowerCase().startsWith('zh')

const BOOK = 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8 7h8M8 11h6'
const SVG = (d: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="${d}"/></svg>`

let closeCurrent: (() => void) | null = null
let replayTour: (() => void) | null = null

export function closeGuide(): void { closeCurrent?.() }

/** DSH writes its own light/dark choice to <body data-ds-dark-theme>. */
const appDark = () => document.body?.hasAttribute?.('data-ds-dark-theme') === true

export function openGuide(): void {
  if (document.getElementById(PANEL_ID)) return
  const zh = uiZh()
  const dark = appDark()
  const title = zh ? `${settings.productName} 使用教程` : `${settings.productName} user guide`
  const mask = document.createElement('div')
  mask.id = PANEL_ID
  mask.setAttribute('role', 'dialog')
  mask.setAttribute('aria-modal', 'true')
  mask.setAttribute('aria-label', title)
  // Windows draws its caption buttons natively above web content: keep the panel below the
  // title bar, and no-drag so the mask is not treated as a window drag region.
  mask.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;'
    + 'padding:calc(var(--dsh-windows-titlebar-height,0px) + 24px) 24px 24px;box-sizing:border-box;-webkit-app-region:no-drag'
  const panel = document.createElement('div')
  panel.style.cssText = 'width:min(1080px,100%);height:min(860px,100%);display:flex;flex-direction:column;overflow:hidden;border-radius:14px;'
    + 'background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#0f1115);border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));box-shadow:0 18px 60px rgba(0,0,0,.28)'
  const bar = document.createElement('div')
  bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px 10px 18px;border-bottom:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));font-size:14px;font-weight:500'
  bar.innerHTML = SVG(BOOK)
  const label = document.createElement('span')
  label.style.flex = '1'
  label.textContent = title
  const close = document.createElement('button')
  close.type = 'button'
  close.setAttribute('aria-label', zh ? '关闭' : 'Close')
  close.style.cssText = 'width:32px;height:32px;display:grid;place-items:center;border:none;border-radius:8px;background:transparent;color:inherit;cursor:pointer'
  close.innerHTML = SVG('M6 6l12 12M18 6L6 18')
  const replay = document.createElement('button')
  replay.type = 'button'
  replay.textContent = zh ? '重新播放引导' : 'Replay tour'
  replay.style.cssText = 'font:inherit;font-size:13px;padding:4px 10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l4,rgba(0,0,0,.2));background:transparent;color:inherit;cursor:pointer'
  replay.addEventListener('click', () => { dismiss(); replayTour?.() })
  bar.append(label, replay, close)
  const frame = document.createElement('iframe')
  frame.src = `${GUIDE_URL}?theme=${dark ? 'dark' : 'light'}`
  // A static bundled page: no scripts; only outside links may open a new window.
  frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox')
  frame.title = title
  frame.style.cssText = `flex:1;width:100%;border:0;background:${dark ? '#12161d' : '#fff'}`
  panel.append(bar, frame)
  mask.append(panel)

  const previous = document.activeElement as HTMLElement | null
  // Capture Escape so it closes only the guide, not DSH popups underneath.
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss() } }
  function dismiss() {
    document.removeEventListener('keydown', onKey, true)
    mask.remove()
    closeCurrent = null
    previous?.focus?.()
  }
  close.addEventListener('click', dismiss)
  mask.addEventListener('mousedown', event => { if (event.target === mask) dismiss() })
  document.addEventListener('keydown', onKey, true)
  closeCurrent = dismiss
  document.body.append(mask)
  close.focus()
}

const item = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: 'none', borderRadius: 8,
  background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 14, textAlign: 'left', cursor: 'pointer',
} as const
const hover = 'color-mix(in srgb, currentColor 7%, transparent)'

export function GuideEntry() {
  return h('button', {
    type: 'button', role: 'menuitem', style: item,
    onClick: () => {
      // Close the account menu (it closes on Escape) before opening the panel.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      openGuide()
    },
    onMouseEnter: (e: any) => { e.currentTarget.style.background = hover },
    onMouseLeave: (e: any) => { e.currentTarget.style.background = 'transparent' },
  }, h('span', { 'aria-hidden': true, style: { display: 'flex' }, dangerouslySetInnerHTML: { __html: SVG(BOOK) } }), h('span', { style: { flex: 1 } }, uiZh() ? '使用教程' : 'User guide'))
}

interface GuideForm {
  getSnapshot(): { value?: { tourSeen?: unknown } }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<unknown>
}

/** The main window is ready: the composer is on screen and no other modal (welcome notice, sign-in) is open. */
export function workbenchReady(doc: Document = document): boolean {
  if (!composerInput(doc)) return false
  return ![...doc.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"]')].some(el => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })
}

/**
 * Plays the tour once on first run; finishing or skipping both record it as seen. Waits until
 * settings have loaded, the workbench is ready and nothing else is on top. Returns a stop function.
 */
export function watchFirstRun(form: GuideForm, { delay = 1200, enabled = () => settings.autoStart, observe = (fn: () => void) => {
  const observer = new MutationObserver(fn)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-modal', 'role'] })
  return () => observer.disconnect()
} } = {}): () => void {
  let started = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const ready = () => {
    const value = form.getSnapshot().value
    return enabled() && Boolean(value) && value!.tourSeen !== true && workbenchReady() && !tourRunning() && !document.getElementById(PANEL_ID)
  }
  const check = () => {
    if (started || timer || !ready()) return
    timer = setTimeout(() => {
      timer = undefined
      if (started || !ready()) return
      started = true
      runTour(form)
    }, delay)
  }
  const unobserve = observe(check)
  const unsubscribe = form.subscribe(check)
  check()
  return () => { unobserve(); unsubscribe(); if (timer) clearTimeout(timer) }
}

export function runTour(form: GuideForm): void {
  startTour({
    zh: uiZh(),
    steps: resolveSteps(settings.steps, settings.productName),
    onDone: () => { void form.set('tourSeen', true).catch(() => {}) },
    onOpenGuide: () => openGuide(),
  })
}

/** Reads the distribution's tour settings from the Host; built-in defaults when unavailable. */
export async function loadSettings(fetcher: typeof fetch = fetch): Promise<TourSettings> {
  try {
    const response = await fetcher(TOUR_URL, { cache: 'no-store' })
    const value = response.ok ? await response.json() : {}
    return {
      productName: typeof value?.productName === 'string' && value.productName ? value.productName : DEFAULTS.productName,
      autoStart: value?.autoStart !== false,
      steps: Array.isArray(value?.steps) ? value.steps : [],
    }
  } catch { return DEFAULTS }
}

export function apply(ctx: any): void {
  const form: GuideForm = ctx.configForms.get(PLUGIN_ID)
  replayTour = () => runTour(form)
  let stopWatching = () => {}
  let active = true
  void loadSettings().then(value => { settings = value; if (active) stopWatching = watchFirstRun(form) })
  ctx.effect(() => () => { active = false; stopWatching(); stopTour(); replayTour = null }, 'eduwork-user-guide: first-run tour')
  const fromMenu = () => openGuide()
  window.addEventListener(OPEN_EVENT, fromMenu)
  ctx.effect(() => () => { window.removeEventListener(OPEN_EVENT, fromMenu); closeGuide() }, 'eduwork-user-guide: application menu')
  // Optional: only distributions that provide an account menu service get this entry.
  ctx.inject(['accountMenuEntries'], (scope: any) => {
    const unregister = scope.accountMenuEntries.register({ id: PLUGIN_ID, Component: GuideEntry })
    return () => { unregister(); closeGuide() }
  })
}

export { STEPS, findByText, placeCard, resolveSteps, startTour, stopTour } from './tour'

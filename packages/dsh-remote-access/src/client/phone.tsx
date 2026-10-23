/**
 * DSH's own interface on a phone. Below 1024px DSH narrows its sidebar to a
 * rail and opens it beside the conversation, which leaves a phone room for
 * neither. On a remote device at phone width this hides the rail, opens the
 * sidebar over the whole width and closes it once a Session or a panel is
 * chosen, and puts the sidebar's two controls (open it, new Session) at the
 * top left, where DSH itself puts them while its sidebar is hidden on macOS.
 * The settings dialog fills the screen likewise, its sections a row of tabs,
 * and the open Session's row shows the actions a pointer would reveal.
 * Settings say they are view only on any remote device, which may not change
 * them. Everything else is DSH's, unchanged.
 */
import { IconNewChatOutlineRegular, IconPanelLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import type { Key } from './locale.ts'

/** Set by the preamble in the document of a remote device. */
export const REMOTE = 'data-eduwork-remote'

export const inject = ['layout', 'uiSession', 'uiWorkspace']

const PHONE = '(max-width: 767px)'
/** Set while a global panel fills the main column instead of the conversation. */
const PANEL = 'data-eduwork-remote-panel'
/** DSH's frame: its children are the columns, the overlay layer and the resize handle. */
const FRAME = 'div:has(> [data-shell-overlay])'
/** DSH's settings dialog: the section list (`nav`: title, then cells) beside the content (header, then the section). */
const SETTINGS = '[data-shortcut-modal="settings"]'

const css = `
/* iOS zooms into a field whose text is under 16px as it takes focus, and stays zoomed. */
@supports (-webkit-touch-callout: none) { input, textarea, select, [contenteditable="true"] { font-size: 16px !important } }
/* The other header actions act on the Host's desktop. */
${SETTINGS} [data-slot="settings.action"] > :not(.eduwork-remote-view-only) { display: none }
.eduwork-remote-view-only { font-size: 12px; line-height: 28px; white-space: nowrap; color: var(--dsw-alias-label-secondary) }
.eduwork-remote-controls { display: none; position: absolute; top: 8px; left: 8px; gap: 4px }
.eduwork-remote-controls button {
  display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0;
  border: none; border-radius: var(--dsw-radius-sm); background: none; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
@media (hover: hover) { .eduwork-remote-controls button:hover { background: var(--dsw-alias-interactive-bg-hover) } }
@media ${PHONE} {
  ${FRAME} { grid-template-columns: 0 minmax(0, 1fr) 0 !important; --dsh-frame-leading-clearance: 96px }
  ${FRAME}:not([data-sidebar-collapsed]) { grid-template-columns: 100% 0 0 !important }
  ${FRAME} > :first-child > [data-slot] > * { width: 100% !important }
  ${FRAME} > [data-side] { display: none }
  /* The column out of sight leaves the tab order and the accessibility tree as well. */
  ${FRAME}[data-sidebar-collapsed] > :first-child, ${FRAME}:not([data-sidebar-collapsed]) > :first-child + * { visibility: hidden }
  /* No room for the conversation's width handles; off to the side, they would let it scroll sideways. */
  ${FRAME} [data-width-handle] { display: none }
  ${FRAME}[data-sidebar-collapsed]:not([data-rightbar-fullscreen]) .eduwork-remote-controls { display: flex }
  /* A touch opens a Session rather than hovering its row, so the open one shows its actions in place of its time. */
  ${FRAME} [role="treeitem"][aria-selected="true"] > :last-child:has(button) { display: inline-flex }
  ${FRAME} [role="treeitem"][aria-selected="true"] > :nth-child(n+3):not(:last-child) { display: none }
  /* Unlike the conversation, global panels leave no room for the controls in their heading. */
  html[${PANEL}] ${FRAME} > :first-child + * { padding-top: 52px }
  /* Beside the section list, a section would get a column a few characters wide. */
  ${SETTINGS} { flex-direction: column; width: 100%; height: 100%; max-width: none; border-radius: 0 }
  ${SETTINGS} > nav { width: auto; gap: 12px; padding: 22px 0 8px }
  ${SETTINGS} > nav > :first-child { padding: 0 24px }
  ${SETTINGS} > nav > :last-child { flex-direction: row; overflow-x: auto; padding: 0 16px; scrollbar-width: none }
  ${SETTINGS} > nav > :last-child > * { flex: none }
  /* Below the tabs, the content column has to shrink to what is left of the screen for the section to scroll. */
  ${SETTINGS} > :last-child { min-height: 0 }
  /* The section's actions and the close button go up beside the title. */
  ${SETTINGS} > :last-child > :first-child { position: absolute; top: 0; right: 0 }
  ${SETTINGS} > :last-child > :last-child { padding-top: 16px }
}`

interface Observable<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }

export interface PhoneSurface {
  layout: { panelInfo: Observable<{ activePanelId: string | null }>; toggleSidebar(): void }
  uiSession: { adapter: { current: Observable<{ key: string | undefined }> } }
  uiWorkspace: { startSession(): void }
  slots: { inject(name: string, register: () => () => void): void; register<P>(entry: object, component: (props: P) => ReactNode): () => void }
  effect(execute: () => () => void, label?: string): void
}

interface Props { toggleSidebar(): void; startSession(): void; t(key: Key): string }

function Controls({ toggleSidebar, startSession, t }: Props) {
  return (
    <div className="eduwork-remote-controls">
      <button type="button" aria-label={t('openSidebar')} onClick={toggleSidebar}><IconPanelLeftOutlineRegular size={18} /></button>
      <button type="button" aria-label={t('newSession')} onClick={startSession}><IconNewChatOutlineRegular size={18} /></button>
    </div>
  )
}

/** The gate refuses every settings change from a device, which DSH would show only as the control springing back. */
function ViewOnly({ t }: { t(key: Key): string }) {
  return <span className="eduwork-remote-view-only">{t('settingsViewOnly')}</span>
}

export function phone(ctx: PhoneSurface, t: (key: Key) => string): void {
  const { layout, uiSession, uiWorkspace } = ctx
  ctx.effect(() => {
    const style = document.head.appendChild(document.createElement('style'))
    style.textContent = css
    return () => style.remove()
  }, 'remote-access: phone layout')

  // A pick in the open drawer shows up as a new main Session or panel.
  // Subscribers hear of it before the frame renders it, so the drawer is
  // checked a frame later, once however many changes came together.
  let closing = false
  const closeDrawer = (): void => {
    if (closing) return
    closing = true
    requestAnimationFrame(() => {
      closing = false
      const frame = document.querySelector('[data-shell-overlay]')?.parentElement
      if (matchMedia(PHONE).matches && frame?.hasAttribute('data-sidebar-collapsed') === false) layout.toggleSidebar()
    })
  }
  const onChange = <T,>(source: Observable<T>, pick: (value: T) => unknown) => () => {
    let last = pick(source.getSnapshot())
    return source.subscribe(() => {
      const next = pick(source.getSnapshot())
      if (next !== last) closeDrawer()
      last = next
    })
  }
  ctx.effect(onChange(uiSession.adapter.current, binding => binding.key), 'remote-access: close the drawer on a Session')
  ctx.effect(onChange(layout.panelInfo, info => info.activePanelId), 'remote-access: close the drawer on a panel')
  ctx.effect(() => {
    const mark = (): void => void document.documentElement.toggleAttribute(PANEL, layout.panelInfo.getSnapshot().activePanelId !== null)
    mark()
    const unsubscribe = layout.panelInfo.subscribe(mark)
    return () => {
      unsubscribe()
      document.documentElement.removeAttribute(PANEL)
    }
  }, 'remote-access: mark global panels')
  // Picking the open Session again changes neither; its row closes the drawer itself.
  const onClick = (event: MouseEvent): void => {
    if ((event.target as Element).closest('[role="treeitem"][aria-selected="true"]') !== null) closeDrawer()
  }
  ctx.effect(() => {
    addEventListener('click', onClick)
    return () => removeEventListener('click', onClick)
  }, 'remote-access: close the drawer on the open Session')

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'remote-access.phone', inject: () => ({ toggleSidebar: () => layout.toggleSidebar(), startSession: () => uiWorkspace.startSession(), t }),
  }, Controls))
  ctx.slots.inject('settings.action', () => ctx.slots.register({
    name: 'settings.action', id: 'remote-access.view-only', inject: () => ({ t }),
  }, ViewOnly))
}

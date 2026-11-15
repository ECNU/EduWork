/**
 * DSH's own interface on a remote device. DSH fits itself to a phone (from
 * 0.2.2 its sidebar opens as a drawer below 768px and settings fill the
 * screen), so this only says that settings are view only on any remote
 * device, which may not change them, and keeps iOS from zooming into fields.
 * Everything else is DSH's, unchanged.
 */
import type { ReactNode } from 'react'
import type { Key } from './locale.ts'

/** Set by the preamble in the document of a remote device. */
export const REMOTE = 'data-eduwork-remote'

const css = `
/* iOS zooms into a field whose text is under 16px as it takes focus, and stays zoomed. */
@supports (-webkit-touch-callout: none) { input, textarea, select, [contenteditable="true"] { font-size: 16px !important } }
/* The other header actions act on the Host's desktop. */
[data-shortcut-modal="settings"] [data-slot="settings.action"] > :not(.eduwork-remote-view-only) { display: none }
.eduwork-remote-view-only { font-size: 12px; line-height: 28px; white-space: nowrap; color: var(--dsw-alias-label-secondary) }`

interface Props { t(key: Key): string }

export interface DeviceSurface {
  slots: { inject(name: string, register: () => () => void): void; register(entry: object, component: (props: Props) => ReactNode): () => void }
  effect(execute: () => () => void, label?: string): void
}

/** The gate refuses every settings change from a device, which DSH would show only as the control springing back. */
function ViewOnly({ t }: Props) {
  return <span className="eduwork-remote-view-only">{t('settingsViewOnly')}</span>
}

export function device(ctx: DeviceSurface, t: (key: Key) => string): void {
  ctx.effect(() => {
    const style = document.head.appendChild(document.createElement('style'))
    style.textContent = css
    return () => style.remove()
  }, 'remote-access: remote device styles')
  ctx.slots.inject('settings.action', () => ctx.slots.register({
    name: 'settings.action', id: 'remote-access.view-only', inject: () => ({ t }),
  }, ViewOnly))
}

import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import { pickDesktopDirectory } from './directory-request.js'

// Replace the auto Host backend only in Electron profiles. The existing client
// surface and import flows keep the official directoryPicker capability seam.
export default class DesktopDirectoryPicker extends DirectoryPicker {
  static inject = ['desktopBoundary']
  constructor(ctx) {
    super(ctx)
    const lifetime = new AbortController()
    ctx.effect(() => () => lifetime.abort())
    this.native = Object.freeze({ kind: 'native', pick: async signal => {
      const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
      combined.throwIfAborted()
      const { nativeBridge } = await ctx.desktopBoundary.ready
      return pickDesktopDirectory(nativeBridge, combined)
    } })
  }
  capability() { return this.native }
}

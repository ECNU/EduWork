import { revealInFileManager } from './reveal.js'

export const name = 'desktop-native-reveal'
export const inject = ['sessionController']

// The pinned rc.2 controller keeps its native opener in an instance field.
// Adapt only that delegate, with scoped disposal. Keep the official Loader
// row active: its package also owns the browser's sessions service.
export function installNativeReveal(controller, effect, platform = process.platform) {
  if (platform !== 'win32') return
  const descriptor = Object.getOwnPropertyDescriptor(controller, 'revealPath')
  if (!descriptor?.writable || typeof descriptor.value !== 'function') {
    throw new Error('The pinned SessionController native reveal hook has changed')
  }
  const previous = descriptor.value
  effect(() => {
    controller.revealPath = revealInFileManager
    return () => {
      if (controller.revealPath === revealInFileManager) controller.revealPath = previous
    }
  })
}

export function apply(ctx) {
  installNativeReveal(ctx.sessionController, setup => ctx.effect(setup))
}

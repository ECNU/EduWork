// Windows blends its old window bitmap with the resized Chromium surface during
// maximize/restore. Disable that bitmap transition for this window only, keeping
// the native frame, edge resizing, shadows and snap controls intact.
export function stabilizeWindowComposition(window, { platform = process.platform, loadNative, warn = console.warn } = {}) {
  if (platform !== 'win32' || window.isDestroyed()) return false
  try {
    const native = loadNative()
    const dwm = native.load('dwmapi.dll')
    const setAttribute = dwm.func('int32_t __stdcall DwmSetWindowAttribute(uintptr_t hwnd, uint32_t attribute, const void *value, uint32_t size)')
    const handle = window.getNativeWindowHandle()
    if (![4, 8].includes(handle.length)) throw new Error('Unexpected native window handle size')
    const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
    const disabled = Buffer.alloc(4)
    disabled.writeInt32LE(1)
    const result = setAttribute(hwnd, 3 /* DWMWA_TRANSITIONS_FORCEDISABLED */, disabled, disabled.length)
    if (result < 0) throw new Error(`DWM returned 0x${(result >>> 0).toString(16)}`)
    return true
  } catch (error) {
    // Appearance failure must not prevent the user from opening their work.
    warn(`Window composition stabilization unavailable: ${error.message}`)
    return false
  }
}

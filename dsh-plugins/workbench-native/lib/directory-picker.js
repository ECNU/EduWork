// Only the OS dialog differs between shells; inspection and merging stay shared.
export async function pickImportDirectory(workspace, bridge = globalThis.go?.main?.Startup) {
  const path = typeof bridge?.PickDirectory === 'function'
    ? await bridge.PickDirectory()
    : await workspace.pickDirectory()
  return path || null
}

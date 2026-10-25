// Node/npm use x64; the existing Go runtime download locks call it amd64.
// Keep that translation at the packaging boundary, never in product code.
export function macosArchitecture(arch = process.arch) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported macOS architecture: ${arch}`)
  return {
    arch,
    platform: `darwin-${arch}`,
    archivePlatform: `macos-${arch}`,
    runtimeKey: `darwin-${arch === 'x64' ? 'amd64' : arch}`,
    machoArch: arch === 'x64' ? 'x86_64' : arch,
    opensslTarget: arch === 'x64' ? 'darwin64-x86_64-cc' : 'darwin64-arm64-cc',
  }
}

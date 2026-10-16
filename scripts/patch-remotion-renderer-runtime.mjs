import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Remotion serves the bundle being rendered on every interface, and its port
// probe listens on them too. That exposes the bundle to the local network and
// makes Windows ask to let the bundled Node through the firewall. Keep both on
// loopback. A listener on another address still answers localhost on that
// port, so the probe also connects; a probe that gets no answer in time counts
// the port as taken and moves on. Retire this patch with a Remotion release
// that binds the render server to loopback.
export const remotionRendererPatch = Object.freeze({
  id: 'remotion-renderer-loopback-v1',
  package: '@remotion/renderer',
  version: '4.0.520',
  files: Object.freeze({
    'dist/port-config.js': 'a49a03c0844885280b93643a399729b3d4b6024c60fd2403a05977beec93d7eb',
    'dist/get-port.js': 'd9359929eb9238bb055d64dc6002ff636ac12b63d7f6aedde6dd8b6e0c77389c',
  }),
})
const sha256 = value => createHash('sha256').update(value).digest('hex')
const edits = {
  'dist/port-config.js': [
    [`    if (preferIpv4 || !(0, exports.isIpV6Supported)(flattened)) {
        return '0.0.0.0';
    }
    return '::';
`, `    return '127.0.0.1';
`],
    [`        (0, exports.hasIpv4LoopbackAddress)(flattened) ? '127.0.0.1' : null,
        (0, exports.isIpV6Supported)(flattened) ? '::' : null,
        '0.0.0.0',
`, `        '127.0.0.1',
`],
  ],
  'dist/get-port.js': [
    [`            server.close(() => {
                resolve('available');
            });
`, `            server.close(() => {
                const socket = net_1.default.connect({ port: portToTry, host });
                const settle = (result) => {
                    socket.destroy();
                    resolve(result);
                };
                socket.setTimeout(1000, () => settle('unavailable'));
                socket.on('connect', () => settle('unavailable'));
                socket.on('error', () => settle('available'));
            });
`],
  ],
}

export function patchRemotionRendererSource(file, input) {
  if (sha256(input) !== remotionRendererPatch.files[file]) {
    throw new Error(`Remotion renderer input changed: ${file}; review or retire the patch for the new Runtime`)
  }
  let output = input.toString('utf8')
  for (const [before, after] of edits[file]) {
    if (output.split(before).length !== 2) throw new Error(`Unexpected Remotion renderer patch site in ${file}`)
    output = output.replace(before, after)
  }
  return output
}

export async function patchRemotionRendererRuntime(modules) {
  const root = join(modules, remotionRendererPatch.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== remotionRendererPatch.package || manifest.version !== remotionRendererPatch.version) {
    throw new Error('Remotion renderer patch requires a newly qualified Runtime')
  }
  const receipts = []
  for (const [file, beforeSHA256] of Object.entries(remotionRendererPatch.files)) {
    const output = patchRemotionRendererSource(file, await readFile(join(root, file)))
    await writeFile(join(root, file), output)
    const { id, package: name, version } = remotionRendererPatch
    receipts.push({ id, package: name, version, file, beforeSHA256, afterSHA256: sha256(output) })
  }
  return receipts
}

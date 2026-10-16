// The official Host sends shutdown-complete and then waits for its event loop
// to drain. A plugin timer or keep-alive socket left behind (for example a
// pending WeChat QR poll) then holds every quit for the 10 s graceful window.
// Once teardown is acknowledged, give the process a short grace and end it.
// Update installs (requireGraceful) keep the official strict behaviour.
const ANCHOR = /^( *)const graceful = await exitsWithin\(exited, 10_000\);\n/m

export const ACKNOWLEDGED_GRACE_MS = 500

export function adaptHostQuit(source) {
  const matches = source.match(new RegExp(ANCHOR.source, 'gm')) ?? []
  if (matches.length !== 1) throw new Error('Official Host stop anchor changed')
  return source.replace(ANCHOR, (_line, indent) => [
    'const acknowledged = (async () => {',
    '    while (!this.shutdownCompleted && child.exitCode === null && child.signalCode === null) await new Promise((resolve) => setTimeout(resolve, 50));',
    `    await new Promise((resolve) => setTimeout(resolve, ${ACKNOWLEDGED_GRACE_MS}));`,
    '})();',
    'const graceful = await exitsWithin(requireGraceful ? exited : Promise.race([exited, acknowledged]), 10_000);',
    // The Host handles SIGTERM by re-entering its finished shutdown, so it would
    // linger until SIGKILL; teardown is already acknowledged, end it directly.
    'if (graceful && !requireGraceful && child.exitCode === null && child.signalCode === null) child.kill(\'SIGKILL\');',
  ].map(line => indent + line).join('\n') + '\n')
}

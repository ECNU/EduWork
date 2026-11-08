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

// The official exit message appends the Host's last stderr as if it were the
// cause. When Windows ends the process from outside (task manager, logoff,
// the user closing a stuck startup), that tail is just whatever a plugin
// printed last, e.g. a WeChat QR timeout. Name the external end or native
// crash instead.
// The shipped source uses single quotes; esbuild output uses double quotes.
const EXIT_ANCHOR = /const suffix = this\.stderr\.trim\(\) === (['"])\1 \? \1\1 : `: \$\{this\.stderr\.trim\(\)\}`;/

export const EXTERNAL_EXIT_CODES = [0x40010004, 0xC000013A]

export function adaptHostExit(source) {
  if ((source.match(new RegExp(EXIT_ANCHOR.source, 'g')) ?? []).length !== 1) throw new Error('Official Host exit anchor changed')
  return source.replace(EXIT_ANCHOR, () => [
    `const external = ${JSON.stringify(EXTERNAL_EXIT_CODES)}.includes(code);`,
    // NTSTATUS failures (0xC0000005 access violation, ...) are native crashes;
    // the stderr tail can be hours old and unrelated, so label it as such.
    'const crashed = !external && typeof code === "number" && code >= 0xC0000000 && code <= 0xFFFFFFFF;',
    'const suffix = this.stderr.trim() === "" ? (crashed ? ` (native crash 0x${code.toString(16).toUpperCase()})` : "") : external ? ` (ended from outside the app; last output: ${this.stderr.trim()})` : crashed ? ` (native crash 0x${code.toString(16).toUpperCase()}; last output, possibly unrelated: ${this.stderr.trim()})` : `: ${this.stderr.trim()}`;',
  ].join(' '))
}

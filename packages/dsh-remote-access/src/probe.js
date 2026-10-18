/**
 * A restart-surviving trace for the wiring questions only a live Host can answer.
 *
 * This exists because the session this work happens in is restarted by the
 * application it is observing. Anything written to a terminal, a log the app owns,
 * or a conversation is lost at exactly the moment the evidence appears. A file
 * outlives every one of those, so one restart can be read afterwards instead of
 * having to be repeated.
 *
 * It is a separate module rather than `console.log` calls scattered through the
 * plugin because the trace is temporary by nature and has to be removable in one
 * action, and a reader of `index.js` should not have to work out which lines are the
 * product and which are the scaffolding.
 *
 * ## Why the destination is tried in several places
 *
 * An earlier version wrote only under `DSH_HOME` and required `DSH_PROFILE_DIR`, on
 * the reasoning that a unit test sets neither. That reasoning was sound and the
 * conclusion was wrong: when a boot produced no trace at all, the trace could not say
 * whether the plugin had not loaded, or had loaded and been unable to write. A
 * diagnostic that cannot tell "nothing happened" apart from "I could not record what
 * happened" is worse than none, because it looks like evidence.
 *
 * So the candidates are tried in order and the first writable one wins, every failure
 * is swallowed, and the last resort is the system temporary directory — except under a
 * test runner, which may not write to any of them. See {@link probePaths} for why that
 * exception exists: a test run that appends its own marker to the live trace is
 * indistinguishable from a boot that reached the same point, and that actually happened
 * once while these notes were being written.
 *
 * Append-only. A trace that silently drops its oldest lines is worse than none when
 * the question is what happened on the previous boot.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Names a directory to redirect the trace to, and the only destination honoured while
 * a test runner is in charge. Set it to see the trace from a test without writing to
 * anything an operator reads.
 */
export const PROBE_DIR_ENV = 'DSH_REMOTE_ACCESS_PROBE_DIR'

/**
 * Every place the trace is willing to live, best first.
 *
 * `DSH_HOME` is preferred because it is the harness's own directory and where an
 * operator would look. The profile directory is next, because the kernel passes it as
 * an argument rather than always exporting it, and the boot that produced no trace is
 * exactly the boot where the environment cannot be assumed. Temporary is last.
 *
 * ## Why a test run may not write anywhere
 *
 * The trace is evidence about a *production boot*, and a boot is read by looking at
 * which markers are present. A test run that imports this plugin — and every unit test
 * of `index.js` does — would append its own `module evaluated` line to the same file,
 * indistinguishable from a real boot that got that far. That is not a hypothetical: it
 * happened while writing this very note, when a test run under a shell that had
 * `DSH_HOME` exported wrote a marker into the live trace and made an empty trace look
 * like a partial boot.
 *
 * `NODE_TEST_CONTEXT` is set by the test runner and by nothing else, so it is the
 * honest discriminator. Under it, the production destinations are withheld and only an
 * explicit {@link PROBE_DIR_ENV} override is honoured, so a test that wants to verify
 * the writing still can, without touching anything an operator reads.
 */
export function probePaths(env = process.env) {
  const override = env[PROBE_DIR_ENV]
  if (typeof override === 'string' && override.trim() !== '') {
    return [join(override, 'wiring-probe.log')]
  }
  // The trace is a debugging aid, not a production default: it records host ids,
  // device ids and settings namespaces, so an operator must opt in explicitly.
  if (env.EDUWORK_REMOTE_PROBE !== '1') return []
  if (typeof env.NODE_TEST_CONTEXT === 'string' && env.NODE_TEST_CONTEXT !== '') {
    return []
  }
  const candidates = []
  if (typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '') {
    candidates.push(join(env.DSH_HOME, 'remote-access', 'wiring-probe.log'))
  }
  if (typeof env.DSH_PROFILE_DIR === 'string' && env.DSH_PROFILE_DIR.trim() !== '') {
    candidates.push(join(env.DSH_PROFILE_DIR, 'wiring-probe.log'))
  }
  candidates.push(join(tmpdir(), 'eduwork-remote-access-wiring-probe.log'))
  return candidates
}

/** Where the trace actually went on this run, once something has been written. */
let resolved

/**
 * The path {@link probe} is using, or the first candidate before anything has been
 * written. `undefined` when the trace is deliberately silent, which is the case under a
 * test runner that has not redirected it.
 */
export function probePath(env = process.env) {
  return resolved ?? probePaths(env)[0]
}

/**
 * Append one line.
 *
 * Never throws, and tries every candidate until one accepts the write. Returns the line
 * whether or not it was written, so a caller never has to handle the failure and a test
 * can assert on the content without reading a file.
 */
export function probe(step, detail) {
  const line = `${new Date().toISOString()}  ${step}${detail === undefined ? '' : `  ${detail}`}\n`
  for (const candidate of probePaths()) {
    try {
      mkdirSync(dirname(candidate), { recursive: true })
      appendFileSync(candidate, line, { mode: 0o600 })
      resolved = candidate
      return line
    } catch {
      // Try the next candidate. A trace that cannot be written anywhere is still not
      // a reason to fail the plugin.
    }
  }
  return line
}

/** The raw text of the trace at the first candidate that has one, for a caller to show. */
export function probeText(env = process.env) {
  for (const candidate of probePaths(env)) {
    try {
      return readFileSync(candidate, 'utf8')
    } catch {
      // Keep looking.
    }
  }
  return ''
}

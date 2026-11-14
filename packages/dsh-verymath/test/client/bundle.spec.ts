import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The browser half is a plain CJS bundle for the DSH module loader, so it can be
// evaluated here with a fake `window.__ModuleLoader__` and a fake `ctx`. That
// pins the two contracts the host actually depends on:
//   * the bundle registers under the package name (a mismatch means the client is
//     never mounted — the host keys everything off `package.json.name`),
//   * the left-sidebar entry and the main panel use the *same* id, and the main
//     panel is registered on the keyed `main` slot with that id as `key`
//     (`dsh-client-ui-layout` declares `main: { kind: 'keyed', scope: 'root' }`;
//     selecting a panellist entry looks the panel up by the key).
// Without the panel entry, clicking the sidebar row throws at render time, which
// is not something the host log records.

const BUNDLE = join(__dirname, '..', '..', 'client', 'verymath.js')
const PKG = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { name: string }

interface Registration {
  readonly slot: string
  readonly options: Record<string, unknown>
  readonly component: unknown
}

function loadBundle(): { id: string, exports: Record<string, unknown> } {
  const code = readFileSync(BUNDLE, 'utf8')
  let loaded: { id: string, factory: (require: (name: string) => unknown) => Record<string, unknown> } | undefined
  const fakeWindow = {
    __ModuleLoader__: {
      load: (entry: { id: string, factory: (require: (name: string) => unknown) => Record<string, unknown> }) => {
        loaded = entry
      },
    },
  }
  // eslint-disable-next-line no-new-func
  const run = new Function('window', code) as (window: unknown) => void
  run(fakeWindow)
  if (loaded === undefined) throw new Error('bundle did not call window.__ModuleLoader__.load')
  const react = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
  }
  const exports = loaded.factory((name: string) => {
    if (name === 'react') return react
    throw new Error(`unexpected require(${name})`)
  })
  return { id: loaded.id, exports }
}

function applyRecorder(exports: Record<string, unknown>): { registrations: Registration[], injects: string[] } {
  const registrations: Registration[] = []
  const injects: string[] = []
  const ctx = {
    slots: {
      inject: (slot: string, callback: () => unknown) => {
        injects.push(slot)
        callback()
        return () => undefined
      },
      register: (options: Record<string, unknown>, component: unknown) => {
        registrations.push({ slot: String(options.name), options, component })
        return () => undefined
      },
    },
    effect: (callback: () => unknown) => {
      callback()
      return () => undefined
    },
  }
  const apply = exports.apply as (ctx: unknown) => void
  apply(ctx)
  return { registrations, injects }
}

describe('browser bundle contract', () => {
  it('loads under the package name', () => {
    const { id } = loadBundle()
    expect(id).toBe(PKG.name)
  })

  it('declares the slots service', () => {
    const { exports } = loadBundle()
    expect(exports.inject).toEqual(['slots'])
  })

  it('registers a left-sidebar entry and a main panel under one id', () => {
    const { exports } = loadBundle()
    const { registrations, injects } = applyRecorder(exports)

    expect(injects).toEqual(['sidebar.panellist', 'main'])

    const entry = registrations.find(item => item.slot === 'sidebar.panellist')
    expect(entry).toBeDefined()
    expect(entry?.options.id).toBe('verymath')
    expect(typeof entry?.options.label).toBe('string')
    expect(typeof entry?.component).toBe('function')

    const panel = registrations.find(item => item.slot === 'main')
    expect(panel).toBeDefined()
    // Keyed slot: the panel is addressed by the sidebar entry's id.
    expect(panel?.options.key).toBe(entry?.options.id)
    expect(typeof panel?.component).toBe('function')
  })

  it('registers nothing outside those two slots', () => {
    const { exports } = loadBundle()
    const { registrations } = applyRecorder(exports)
    expect(registrations).toHaveLength(2)
  })
})

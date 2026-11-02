import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)
const bundle = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const source = readFileSync(bundle, 'utf8')

/** Run the built bundle exactly the way the shell does and collect the plugin. */
function loadPlugin() {
  let plugin
  const previous = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        assert.equal(id, '@eduwork/dsh-mail-pet')
        plugin = factory(specifier => {
          assert.equal(specifier, 'react', `client must not require ${specifier}`)
          return nodeRequire('react')
        })
      },
    },
  }
  try {
    new Function(source)()
  }
  finally {
    globalThis.window = previous
  }
  return plugin
}

/** The smallest client context that satisfies what the plugin injects. */
function createContext() {
  const handlers = new Map()
  const mounted = []
  const disposers = []
  const ctx = {
    slots: {
      inject(name, callback) { assert.equal(name, 'shell.overlay'); callback() },
      register(options, component) { mounted.push({ options, component }); return () => {} },
    },
    notificationActions: {
      register(source, handler) {
        assert.equal(handlers.has(source), false, `duplicate handler for ${source}`)
        handlers.set(source, handler)
        return () => handlers.delete(source)
      },
    },
    effect(callback) { disposers.push(callback()) },
  }
  return { ctx, handlers, mounted, disposers }
}

test('the bundle loads through the shell loader and exports a client plugin', () => {
  const plugin = loadPlugin()
  assert.deepEqual(plugin.inject, ['slots', 'notificationActions'])
  assert.equal(typeof plugin.apply, 'function')
})

test('applying registers the mail source and mounts the reader overlay', () => {
  const plugin = loadPlugin()
  const { ctx, handlers, mounted } = createContext()
  plugin.apply(ctx)
  assert.equal(handlers.has('mail'), true)
  assert.equal(mounted.length, 1)
  assert.equal(mounted[0].options.name, 'shell.overlay')
  assert.equal(mounted[0].options.id, 'mail-pet.reader')
  assert.equal(typeof mounted[0].component, 'function')
})

test('a click payload is accepted and an empty one is ignored', () => {
  const plugin = loadPlugin()
  const { ctx, handlers } = createContext()
  plugin.apply(ctx)
  const handler = handlers.get('mail')
  assert.equal(handler({ source: 'mail', action: 'open', target: { folder: 'INBOX', uid: 7, subject: '主题', text: '正文' } }), true)
  assert.equal(handler({ source: 'mail', action: 'open', target: null }), true)
})

test('the plugin releases its handler and overlay on dispose', () => {
  const plugin = loadPlugin()
  const { ctx, handlers, disposers } = createContext()
  plugin.apply(ctx)
  assert.equal(disposers.length, 1)
  disposers[0]()
  assert.equal(handlers.size, 0)
})

test('the bundle never imports at runtime and stays inside a CommonJS factory', () => {
  assert.ok(source.startsWith('window.__ModuleLoader__.load({ id: "@eduwork/dsh-mail-pet", factory: (require) => {'))
  assert.ok(source.trimEnd().endsWith('} });'))
  assert.equal(/\bimport\s*\(/.test(source), false)
})

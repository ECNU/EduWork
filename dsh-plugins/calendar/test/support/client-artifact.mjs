// Load a built client artifact the way the page's module loader does.
//
// The client bundle is not a module import: it calls
// `window.__ModuleLoader__.load({ id, factory })`, and the loader hands the
// factory a `require` for the packages the plugin does not bundle. Reading the
// file without running that handshake proves nothing about whether the panel can
// start, so this runs it against a loader stand-in and reports what was declared.
import { readFileSync } from 'node:fs'

/**
 * @param path - the built `lib/client.js` to load.
 * @param require - resolves the externals the factory asks for.
 * @returns what the artifact declared to the loader.
 */
export function loadClientArtifact(path, require) {
  const declared = []
  const globalNames = ['console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Promise', 'URL', 'URLSearchParams', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Object', 'Array',
    'JSON', 'Math', 'Date', 'String', 'Number', 'Boolean', 'Error', 'TypeError', 'Symbol', 'RegExp',
    'Intl', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'document', 'navigator']

  const sandbox = { __declared: declared }
  for (const name of globalNames) sandbox[name] = globalThis[name]
  sandbox.window = sandbox
  sandbox.globalThis = sandbox

  // `document` and `navigator` are only touched from inside components, so a
  // placeholder keeps the top level runnable while still letting a factory that
  // reaches for them at load time fail loudly.
  if (!sandbox.document) sandbox.document = { createElement: () => ({ style: {}, dataset: {}, appendChild() {} }) }
  if (!sandbox.navigator) sandbox.navigator = { userAgent: 'node' }

  sandbox.__ModuleLoader__ = {
    load({ id, factory }) {
      declared.push({ id, exports: factory((specifier) => require(specifier)) })
    },
  }

  const code = readFileSync(path, 'utf8')
  // The artifact is written for the page, so it is evaluated with `window` in
  // scope rather than imported as a module.
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'navigator', code)(sandbox, sandbox.document, sandbox.navigator)
  return declared
}

import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
if (!process.env.EDUWORK_AUTO_APPROVAL_RUNTIME) throw Error('Set EDUWORK_AUTO_APPROVAL_RUNTIME to the locked DSH Runtime directory')
const runtime = pathToFileURL(resolve(process.env.EDUWORK_AUTO_APPROVAL_RUNTIME, 'package.json')).href
// Host packages come from the locked Runtime; the decision client is this package's own npm dependency.
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@deepseek-ai/')) return next(specifier, { ...context, parentURL: runtime })
  return next(specifier, context)
} })

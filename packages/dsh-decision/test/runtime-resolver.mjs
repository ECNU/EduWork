import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
if (!process.env.EDUWORK_DECISION_RUNTIME) throw Error('Set EDUWORK_DECISION_RUNTIME to the locked DSH Runtime directory')
const runtime = pathToFileURL(resolve(process.env.EDUWORK_DECISION_RUNTIME, 'package.json')).href
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@deepseek-ai/') || specifier.startsWith('@eduwork/')) return next(specifier, { ...context, parentURL: runtime })
  return next(specifier, context)
} })

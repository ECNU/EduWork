import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
if (!process.env.EDUWORK_MESSAGE_EDIT_RUNTIME) throw Error('Set EDUWORK_MESSAGE_EDIT_RUNTIME to the locked DSH Runtime directory')
const runtime = pathToFileURL(resolve(process.env.EDUWORK_MESSAGE_EDIT_RUNTIME, 'package.json')).href
// The Host provides DSH packages and zod; resolve them from the locked Runtime.
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@deepseek-ai/') || specifier === 'zod') return next(specifier, { ...context, parentURL: runtime })
  return next(specifier, context)
} })

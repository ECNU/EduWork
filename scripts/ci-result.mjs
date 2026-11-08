import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function verifyCiResult(selectionResult, required, results) {
  if (selectionResult !== 'success' || !['true', 'false'].includes(required)
    || !Array.isArray(results) || !results.length) throw new Error('CI selection did not complete successfully')
  const expected = required === 'true' ? 'success' : 'skipped'
  if (results.some(result => result !== expected)) throw new Error(`Expected ${expected} checks; got ${results.join(', ')}`)
  return required === 'true' ? 'All selected checks passed' : 'No affected inputs; checks skipped'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(verifyCiResult(process.env.SELECTION_RESULT, process.env.REQUIRED, JSON.parse(process.env.RESULTS)))
}

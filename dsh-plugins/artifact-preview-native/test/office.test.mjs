import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertOfficeSourceSize, renderOfficePreview } from '../lib/office.js'

test('Office preview invokes only the managed private renderer without a shell', async () => {
  let call
  const directory = await mkdtemp(join(tmpdir(), 'office-preview-contract-'))
  const file = join(directory, 'report.docx')
  await writeFile(file, 'synthetic Office bytes for an isolated executor contract')
  try {
  const preview = await renderOfficePreview(file, undefined, {
    environment: { CHATECNU_WORK_OFFICE_PYTHON: 'C:\\private\\python.exe' },
    execFile(command, args, options, callback) {
      call = { command, args, options }
      callback(null, '<!doctype html><html><body>ok</body></html>', '')
    },
  })
  assert.equal(call.command, 'C:\\private\\python.exe')
  assert.deepEqual(call.args.slice(0,3),['-I','-X','utf8'])
  assert.match(call.args[3],/[\\/]python[\\/]runner\.py$/)
  assert.equal(call.args[4],'documents.render_preview')
  assert.equal(call.options.windowsHide, true)
  assert.equal('shell' in call.options, false)
  assert.match(preview.html, /<body>ok/)
  } finally { await rm(file); await rmdir(directory) }
})

test('Office preview refuses missing runtime and oversized input', async () => {
  await assert.rejects(async () => renderOfficePreview('report.docx', undefined, { environment: {}, execFile() {} }), /尚未就绪/)
  assert.throws(() => assertOfficeSourceSize(65 * 1024 * 1024), /超过 64 MB/)
})

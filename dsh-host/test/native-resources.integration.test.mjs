import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { join, relative, isAbsolute, resolve, toNamespacedPath } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { prepareNativeResources } from '../native-resources.mjs'

const product = process.env.EDUWORK_NATIVE_RESOURCE_PRODUCT ? resolve(process.env.EDUWORK_NATIVE_RESOURCE_PRODUCT) : null
const run = promisify(execFile)
test('relocatable native closure runs real Office creation/preview and system TTS without current', { skip: !product }, async () => {
  const { environment, pluginConfig } = await prepareNativeResources({ product })
  const shared = join(product, 'd/node_modules/@eduwork/dsh-artifact-services')
  const evidenceRoot = resolve(process.env.EDUWORK_NATIVE_RESOURCE_EVIDENCE_ROOT || product)
  await mkdir(evidenceRoot, { recursive: true })
  const evidence = await mkdtemp(join(evidenceRoot, 'native-smoke-'))
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PYTHON|PIP_|VIRTUAL_ENV|ECNU_AGENT_)/i.test(key)))
  Object.assign(childEnv, environment)
  const pythonCode = 'import sys,json,docx,openpyxl,pptx,pypdf,reportlab,lxml.etree; print(json.dumps({"prefix":sys.prefix,"base":sys.base_prefix,"paths":sys.path,"modules":[m.__file__ for m in [docx,openpyxl,pptx,pypdf,reportlab,lxml.etree]]}))'
  const probe = JSON.parse((await run(environment.DSH_OFFICE_PYTHON, ['-I', '-X', 'utf8', '-c', pythonCode], { env: childEnv, windowsHide: true, encoding: 'utf8' })).stdout)
  // python-docx lazily loads these templates using __file__/../templates.
  // The private long-path importer must retain ordinary file-open semantics.
  const footerCode = 'from docx import Document; from pathlib import Path; import io,os; d=Document(); s=d.sections[0]; s.header.paragraphs[0].text="Header"; s.footer.paragraphs[0].text="Footer"; p=Path("template-test.docx"); d.save(p); assert Document(p).sections[0].footer.paragraphs[0].text=="Footer"; fd=os.open(p,os.O_RDONLY); assert open(fd,"rb").read(2)==b"PK"; assert io.open(p,"rb").read(2)==b"PK"; print("header-footer-open-ok")'
  assert.match((await run(environment.DSH_OFFICE_PYTHON, ['-I', '-X', 'utf8', '-c', footerCode], { env: childEnv, cwd: evidence, windowsHide: true, encoding: 'utf8' })).stdout, /header-footer-open-ok/)
  const canonical = await realpath(product)
  for (const path of [probe.prefix, probe.base, ...probe.paths, ...probe.modules]) {
    const rel = relative(toNamespacedPath(canonical), toNamespacedPath(path))
    assert.ok(!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'), `Python path escaped the copied resource closure: ${path}`)
  }
  const runner = join(shared, 'python/runner.py')
  const create = async (module, output, spec) => {
    const response = await run(environment.DSH_OFFICE_PYTHON, ['-I', '-X', 'utf8', runner, module, '--project-root', evidence, '--output', output, '--spec-json', JSON.stringify(spec)], { env: childEnv, windowsHide: true, encoding: 'utf8' })
    const payload = JSON.parse(response.stdout); assert.equal(payload.ok, true, response.stdout)
    return payload
  }
  const document = join(evidence, '报告.docx'), slides = join(evidence, '演示.pptx'), table = join(evidence, '数据.xlsx')
  await create('documents.create_document', document, { blocks: [{ type: 'title', text: 'EduWork' }, { type: 'paragraph', text: '移动目录后仍可生成。' }] })
  await create('presentations.create_presentation', slides, { slides: [{ layout: 'cover', title: 'EduWork', subtitle: 'Portable preview' }] })
  await create('spreadsheets.create_workbook', table, { sheets: [{ name: 'Sheet1', rows: [['Item', 'Value'], ['Ready', 1]] }] })
  const { renderOfficePreview } = await import(pathToFileURL(join(shared, 'lib/office-preview.js')))
  for (const file of [document, slides, table]) {
    const result = await renderOfficePreview(file, undefined, { environment: childEnv, execFile })
    assert.ok(result.html.length > 100)
    await writeFile(`${file}.html`, result.html)
  }
  const { createSystemSpeechProvider, SpeechService } = await import(pathToFileURL(join(shared, 'lib/speech.js')))
  const speech = new SpeechService(); speech.register(createSystemSpeechProvider())
  const spoken = await speech.synthesize({ provider: 'system', text: 'EduWork ready.', directory: evidence, name: 'system-tts' })
  assert.ok(spoken.duration > 0)
  const wave = await readFile(spoken.path); assert.equal(wave.toString('ascii', 0, 4), 'RIFF')
  assert.ok(pluginConfig['eduwork-artifact-services'].transcription.local.executablePath.startsWith(canonical))
  let transcription
  if (process.env.EDUWORK_NATIVE_MEDIA_TEST === '1') {
    const { createMediaRuntime, getMediaFFmpegPath } = await import(pathToFileURL(join(shared, 'lib/runtime.js')))
    const runtime = await createMediaRuntime({ environment: childEnv })
    const ffmpegPath = await getMediaFFmpegPath({ runtime })
    for (const path of [runtime.browserExecutable, ffmpegPath]) {
      const rel = relative(canonical, await realpath(path))
      assert.ok(!isAbsolute(rel) && !rel.startsWith('..'), 'media executable must belong to this product')
    }
    const { createWhisperCppTranscriptionProvider } = await import(pathToFileURL(join(shared, 'lib/transcription-whisper.js')))
    const provider = createWhisperCppTranscriptionProvider({ ...pluginConfig['eduwork-artifact-services'].transcription.local, ffmpegPath })
    assert.equal(await provider.available(), true)
    transcription = await provider.transcribe({ inputPath: spoken.path, language: 'en', directory: evidence, signal: AbortSignal.timeout(60_000) })
    assert.ok(transcription.text.trim().length > 0)
  }
  const result = { schemaVersion: 1, python: probe, environment, office: [document, slides, table], speech: { path: spoken.path, duration: spoken.duration }, transcription, liveServices: false }
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2))
  console.log(`Native resource evidence: ${evidence}`)
})

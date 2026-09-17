import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareNativeResources } from '../dsh-host/native-resources.mjs'

// Run against an extracted release, without downloads, model calls or user data.
const desktop = resolve(process.argv[2])
const mac = process.platform === 'darwin'
const resources = join(desktop, mac ? 'Contents/Resources' : 'resources')
const product = join(resources, 'product')
const { environment, pluginConfig } = await prepareNativeResources({ product })
assert.ok(environment.DSH_MEDIA_BROWSER && environment.DSH_OFFICE_PYTHON, 'Offline native resources are required')
const run = async (executable, args) => promisify(execFile)(executable, args, { windowsHide: true, timeout: 30_000, encoding: 'utf8' })
const node = join(resources, mac ? 'runtime/node' : 'runtime/node.exe')
const nodeVersion = (await run(node, ['--version'])).stdout.trim()
assert.match(nodeVersion, /^v24\./)

// Do not let the CI machine's installed browser or a maintainer override mask
// a missing connection between the product resource manifest and its tools.
for (const key of Object.keys(process.env)) {
  if (/^(EDUWORK_BROWSER_EXECUTABLE|CHATECNU_WORK_BROWSER_EXECUTABLE|ECNU_AGENT_REMOTION_BROWSER|DSH_MEDIA_BROWSER|ProgramFiles|ProgramFiles\(x86\)|LOCALAPPDATA)$/i.test(key)) delete process.env[key]
}
Object.assign(process.env, environment)
const modules = join(product, 'd/node_modules')
const load = path => import(pathToFileURL(join(modules, path)))
const { browserExecutable } = await load('@chatecnu-work/dsh-tool-browser/lib/core.js')
assert.equal(await realpath(browserExecutable()), await realpath(environment.DSH_MEDIA_BROWSER), 'Search must select the bundled browser without system browsers')
const { chromium } = await load('playwright-core/index.mjs')
const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true })
let browserVersion
try {
  browserVersion = browser.version()
  const page = await browser.newPage()
  await page.setContent('<title>EduWork runtime</title><main>Bundled Chromium ready</main>')
  assert.equal(await page.title(), 'EduWork runtime')
  assert.equal(await page.locator('main').innerText(), 'Bundled Chromium ready')
} finally { await browser.close() }

const python = JSON.parse((await run(environment.DSH_OFFICE_PYTHON, ['-I', '-X', 'utf8', '-c', 'import json,sys,docx,pptx,openpyxl,xlsxwriter,pypdf,reportlab,PIL,lxml.etree; print(json.dumps({"version":sys.version.split()[0],"imports":["docx","pptx","openpyxl","xlsxwriter","pypdf","reportlab","PIL","lxml.etree"]}))'])).stdout)
const { createMediaRuntime, getMediaFFmpegPath } = await load('@eduwork/dsh-artifact-services/lib/runtime.js')
const runtime = await createMediaRuntime({ environment })
assert.equal(await realpath(runtime.browserExecutable), await realpath(browserExecutable()))
const ffmpeg = await getMediaFFmpegPath({ runtime })
const ffmpegVersion = (await run(ffmpeg, ['-version'])).stdout.split(/\r?\n/)[0]
assert.match(ffmpegVersion, /^ffmpeg version /)
const asr = pluginConfig['eduwork-artifact-services']?.transcription?.local
assert.ok(asr, 'Offline transcription configuration is required')
assert.ok((await stat(asr.modelPath)).size > 1_000_000, 'Offline transcription model is missing or truncated')
const help = await run(asr.executablePath, ['--help'])
assert.match(help.stdout + help.stderr, /usage:/i)
const result = { passed: true, node: nodeVersion, browser: browserVersion, browserWithoutSystemInstallation: true, python, ffmpeg: ffmpegVersion, transcription: 'engine starts; bundled model present' }
if (process.argv[3]) await writeFile(resolve(process.argv[3]), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))

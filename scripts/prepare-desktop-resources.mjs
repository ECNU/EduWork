// Prepares the locked native desktop resources (private Python + Office wheels,
// offline browser, CPU transcription engine) for a new Windows x64 product
// candidate. Node.js port of prepare-desktop-resources.ps1. The recipe itself
// remains Windows x64 only; other platforms get their own recipes later.
import { readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  copyFileTo, copyTree, ensureDir, fullPath, isDirectory, isFile, isMainModule,
  pathExists, readJSON, run, sha256File, writeJSON,
} from './lib/build-util.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

async function findFiles(root, name) {
  const wanted = name.toLowerCase()
  const found = []
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.toLowerCase() === wanted) found.push(path)
    }
  }
  await walk(root)
  return found
}

export async function prepareDesktopResources({
  outputRoot,
  pythonArchive,
  pythonWheelRoot,
  browserSource,
  asrSource,
  asrModel,
  vcRedistSource,
  mediaEnvironmentRelativePath = 'd',
  pythonManifest = join(scriptRoot, '../dsh-desktop/internal/productruntime/builtin/python-runtime-manifest.json'),
  nodeManifest = join(scriptRoot, '../dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json'),
} = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This resource recipe requires Windows x64')
  outputRoot = fullPath(outputRoot)
  const resourceRoot = join(outputRoot, 'r')
  if (await pathExists(resourceRoot)) throw new Error('Refusing to overwrite an existing native resource directory')
  if (await pathExists(join(outputRoot, 'desktop-resources.json'))) throw new Error('This product already owns native resources')
  if (/(^|[\\/])current([\\/]|$)/i.test(outputRoot)) throw new Error('Prepare resources in a new candidate, never current')
  if (isAbsolute(mediaEnvironmentRelativePath) || /(^|[\\/])\.\.([\\/]|$)/.test(mediaEnvironmentRelativePath)) {
    throw new Error('Media environment must be inside the new product')
  }
  for (const path of [pythonArchive, asrModel, pythonManifest, nodeManifest]) {
    if (!await isFile(path)) throw new Error(`Required resource file is missing: ${path}`)
  }
  for (const path of [pythonWheelRoot, browserSource, asrSource, vcRedistSource]) {
    if (!await isDirectory(path)) throw new Error(`Required resource directory is missing: ${path}`)
  }
  const vcLibraries = []
  for (const name of ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll']) {
    const matches = await findFiles(vcRedistSource, name)
    if (matches.length !== 1) throw new Error(`Expected exactly one x64 redistributable ${name} in VCRedistSource`)
    vcLibraries.push(matches[0])
  }
  const manifest = await readJSON(pythonManifest)
  const nodeLock = await readJSON(nodeManifest)
  const asset = manifest.assets['windows-amd64']
  if (manifest.schemaVersion !== 2 || asset.archiveRoot !== 'python') throw new Error('Unsupported private Python manifest')
  const assertHash = async (path, expected) => {
    if (await sha256File(path) !== String(expected).toLowerCase()) throw new Error(`Locked resource checksum mismatch: ${path}`)
  }
  await assertHash(pythonArchive, asset.sha256)
  await assertHash(join(browserSource, 'chrome.exe'), nodeLock.environment.browserAutomation.executables['windows-amd64'].sha256)
  const wheels = []
  for (const packageEntry of manifest.environment.packages) {
    const wheel = packageEntry.assets['windows-amd64'] ?? packageEntry.assets.any
    const filename = decodeURIComponent(new URL(wheel.url).pathname.split('/').at(-1))
    const candidates = await findFiles(pythonWheelRoot, filename)
    if (candidates.length !== 1) throw new Error(`Expected one cached wheel: ${filename}`)
    await assertHash(candidates[0], wheel.sha256)
    wheels.push({
      name: packageEntry.name,
      version: packageEntry.version,
      importName: packageEntry.importName,
      directory: dirname(candidates[0]),
      sha256: wheel.sha256,
    })
  }
  // Same filtered environment as the PowerShell recipe: no ambient Python/pip
  // configuration reaches the private runtime, and pip stays fully offline.
  const privateEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(?:python|pip_)/i.test(key) || ['VIRTUAL_ENV', 'VIRTUAL_ENV_PROMPT'].includes(key.toUpperCase())) continue
    privateEnv[key] = value
  }
  Object.assign(privateEnv, { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PIP_CONFIG_FILE: 'NUL', PIP_NO_INDEX: '1' })
  const invokePrivate = (file, args) =>
    run(file, args, { cwd: resourceRoot, env: privateEnv, replaceEnv: true, capture: true })
      .catch(error => { throw new Error(`Native resource command failed: ${error.message}`) })

  await ensureDir(join(resourceRoot, 'p'))
  console.log('Extracting the locked private Python archive...')
  await invokePrivate('tar.exe', ['-xf', fullPath(pythonArchive), '-C', join(resourceRoot, 'p'), '--strip-components', '1'])
  const basePython = join(resourceRoot, 'p/python.exe')
  const venv = join(resourceRoot, 'v')
  // Same private-runtime + fresh-venv + verified offline wheels recipe as
  // dsh-desktop/internal/productruntime/pythonruntime/venv.go. No copied venv.
  await invokePrivate(basePython, ['-I', '-B', '-X', 'utf8', '-m', 'venv', '--without-pip', venv])
  const python = join(venv, 'Scripts/python.exe')
  await invokePrivate(python, ['-I', '-B', '-X', 'utf8', '-m', 'ensurepip', '--upgrade', '--default-pip'])
  const installArguments = ['-I', '-B', '-X', 'utf8', '-m', 'pip', 'install', '--no-index', '--no-deps', '--no-compile', '--no-cache-dir', '--disable-pip-version-check', '--no-warn-script-location']
  // Named locked requirements avoid direct_url.json records retaining source paths.
  for (const directory of [...new Set(wheels.map(wheel => wheel.directory))]) installArguments.push('--find-links', directory)
  for (const wheel of wheels) installArguments.push(`${wheel.name}==${wheel.version}`)
  console.log('Installing verified Office wheels without network access...')
  await invokePrivate(python, installArguments)
  const requirements = JSON.stringify(wheels.map(({ name, version, importName }) => ({ name, version, importName })))
  const probe = 'import importlib,importlib.metadata,json,sys; rows=json.loads(sys.argv[1]); [(importlib.import_module(r["importName"]), None if importlib.metadata.version(r["name"])==r["version"] else sys.exit(2)) for r in rows]; print(json.dumps({"prefix":sys.prefix,"basePrefix":sys.base_prefix,"version":sys.version.split()[0]}))'
  const checked = JSON.parse(await invokePrivate(python, ['-I', '-B', '-X', 'utf8', '-c', probe, requirements]))
  if (checked.prefix.toLowerCase() !== venv.toLowerCase() ||
    checked.basePrefix.toLowerCase() !== join(resourceRoot, 'p').toLowerCase() ||
    checked.version !== manifest.pythonVersion) {
    throw new Error('Private Python resolved outside the new product')
  }

  const environmentLock = await sha256File(pythonManifest)
  await writeJSON(join(venv, '.eduwork-venv.json'), { schemaVersion: 1, environmentLockSHA256: environmentLock })
  // The application never invokes activation scripts or pip console shims. Remove
  // their build-directory references; Python is always invoked explicitly with -I.
  for (const entry of await readdir(join(venv, 'Scripts'), { withFileTypes: true })) {
    if (entry.isFile() && !['python.exe', 'pythonw.exe'].includes(entry.name.toLowerCase())) {
      await unlink(join(venv, 'Scripts', entry.name))
    }
  }
  // Leave a neutral shipped template. prepareNativeResources repairs this owned
  // file before the first invocation and after each directory move.
  await writeFile(join(venv, 'pyvenv.cfg'), `home = ../p\ninclude-system-site-packages = false\nversion = ${manifest.pythonVersion}\nexecutable = ../p/python.exe\n`)
  // Bytecode created by ensurepip can retain the build machine's absolute path.
  // All entries below belong to this newly-created venv, never a user's Python.
  for (const cache of await findCaches(venv)) {
    if (!cache.toLowerCase().startsWith(venv.toLowerCase() + sep)) throw new Error('Python cache escaped the new environment')
    await rm(cache, { recursive: true, force: true })
  }

  console.log('Copying the offline browser and CPU transcription engine...')
  await copyTree(browserSource, join(resourceRoot, 'b'))
  await ensureDir(join(resourceRoot, 'a'))
  for (const name of ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll']) {
    await copyFileTo(join(asrSource, name), join(resourceRoot, `a/${name}`))
  }
  await copyFileTo(asrModel, join(resourceRoot, 'a/model.bin'))
  for (const library of vcLibraries) {
    await copyFileTo(library, join(resourceRoot, `a/${basename(library)}`))
  }
  const asrHashes = {}
  for (const entry of (await readdir(join(resourceRoot, 'a'), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile()) asrHashes[entry.name] = await sha256File(join(resourceRoot, 'a', entry.name))
  }
  const receipt = {
    schemaVersion: 1,
    platform: 'win32-x64',
    environment: {
      DSH_OFFICE_PYTHON: 'r/v/Scripts/python.exe',
      DSH_MEDIA_BROWSER: 'r/b/chrome.exe',
      DSH_MEDIA_NODE_ENV: mediaEnvironmentRelativePath.replaceAll('\\', '/'),
    },
    python: {
      baseRoot: 'r/p',
      venvRoot: 'r/v',
      version: manifest.pythonVersion,
      runtimeId: manifest.runtimeId,
      archiveSHA256: asset.sha256,
      environmentLockSHA256: environmentLock,
    },
    browser: {
      executableSHA256: nodeLock.environment.browserAutomation.executables['windows-amd64'].sha256,
      version: nodeLock.environment.browserAutomation.browserVersion,
    },
    asr: { model: 'whisper-tiny-q5_1', filesSHA256: asrHashes },
    pluginConfig: {
      'eduwork-artifact-services': {
        transcription: { local: { executablePath: 'r/a/whisper-cli.exe', modelPath: 'r/a/model.bin' } },
      },
    },
  }
  await writeJSON(join(outputRoot, 'desktop-resources.json'), receipt)
  console.log(`Native resources prepared: ${join(outputRoot, 'desktop-resources.json')}`)
}

async function findCaches(root) {
  const caches = []
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(directory, entry.name)
      if (entry.name === '__pycache__') caches.push(path)
      else await walk(path)
    }
  }
  await walk(root)
  return caches
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'output-root': { type: 'string' },
      'python-archive': { type: 'string' },
      'python-wheel-root': { type: 'string' },
      'browser-source': { type: 'string' },
      'asr-source': { type: 'string' },
      'asr-model': { type: 'string' },
      'vcredist-source': { type: 'string' },
      'media-environment-relative-path': { type: 'string' },
      'python-manifest': { type: 'string' },
      'node-manifest': { type: 'string' },
    },
  })
  const required = ['output-root', 'python-archive', 'python-wheel-root', 'browser-source', 'asr-source', 'asr-model', 'vcredist-source']
  if (required.some(name => !values[name])) {
    throw new Error('Use --output-root --python-archive --python-wheel-root --browser-source --asr-source --asr-model --vcredist-source [--media-environment-relative-path d] [--python-manifest <json>] [--node-manifest <json>]')
  }
  await prepareDesktopResources({
    outputRoot: values['output-root'],
    pythonArchive: values['python-archive'],
    pythonWheelRoot: values['python-wheel-root'],
    browserSource: values['browser-source'],
    asrSource: values['asr-source'],
    asrModel: values['asr-model'],
    vcRedistSource: values['vcredist-source'],
    mediaEnvironmentRelativePath: values['media-environment-relative-path'] ?? 'd',
    ...(values['python-manifest'] ? { pythonManifest: values['python-manifest'] } : {}),
    ...(values['node-manifest'] ? { nodeManifest: values['node-manifest'] } : {}),
  })
}

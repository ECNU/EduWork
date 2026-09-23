import { readFile, writeFile, realpath, stat, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

// Some redistributable CPython builds still use MAX_PATH in FileFinder. This
// hook belongs only to the product venv; it neither changes global Python nor
// adds any external import directory. ZIP import hooks keep their usual fallback.
const PRIVATE_WINDOWS_PATHS = String.raw`# EduWork managed private-runtime Windows import paths.
import os
import sys
if os.name == "nt":
    import builtins
    import io
    import functools
    # Import loaders use extended paths for long portable installations. Office
    # libraries then join __file__ with ../templates; Win32 extended paths do
    # not resolve those dot segments. Normalize only that path form at open,
    # preserving normal paths, file descriptors and caller options unchanged.
    def _eduwork_open(original):
        @functools.wraps(original)
        def normalized(file, *args, **kwargs):
            if isinstance(file, (str, bytes, os.PathLike)):
                path = os.fspath(file)
                prefix = b"\\\\?\\" if isinstance(path, bytes) else "\\\\?\\"
                if path.startswith(prefix):
                    file = os.path.normpath(path)
            return original(file, *args, **kwargs)
        return normalized
    builtins.open = _eduwork_open(builtins.open)
    io.open = _eduwork_open(io.open)
    from importlib.machinery import FileFinder, ExtensionFileLoader, EXTENSION_SUFFIXES, SourceFileLoader, SOURCE_SUFFIXES, SourcelessFileLoader, BYTECODE_SUFFIXES
    _finder = FileFinder.path_hook((ExtensionFileLoader, EXTENSION_SUFFIXES), (SourceFileLoader, SOURCE_SUFFIXES), (SourcelessFileLoader, BYTECODE_SUFFIXES))
    def _eduwork_path_hook(path):
        if not isinstance(path, str):
            raise ImportError
        path = os.path.abspath(path)
        if not path.startswith("\\\\?\\"):
            path = "\\\\?\\UNC\\" + path[2:] if path.startswith("\\\\") else "\\\\?\\" + path
        return _finder(path)
    sys.path_hooks.insert(0, _eduwork_path_hook)
    sys.path_importer_cache.clear()
`

function inside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
}
async function resourcePath(product, path, type = 'file') {
  if (typeof path !== 'string' || !path || /[\r\n\0]/u.test(path) || isAbsolute(path) || /^[A-Za-z]:/u.test(path)) throw new Error('Invalid relative desktop resource path')
  const absolute = resolve(product, path)
  if (!inside(product, absolute)) throw new Error('Desktop resource path escapes the product')
  const canonical = await realpath(absolute)
  if (!inside(product, canonical)) throw new Error('Desktop resource link escapes the product')
  const info = await stat(canonical)
  if (type === 'file' ? !info.isFile() : !info.isDirectory()) throw new Error('Desktop resource has the wrong type')
  return canonical
}

/** Resolve the frozen native closure and repair only its managed venv location. */
export async function prepareNativeResources({ product }) {
  product = await realpath(resolve(product))
  let manifest
  try { manifest = JSON.parse(await readFile(join(product, 'desktop-resources.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return { environment: {}, pluginConfig: {} }; throw error }
  if (manifest.schemaVersion !== 1 || manifest.platform !== `${process.platform}-${process.arch}`) throw new Error('Desktop resource platform or schema mismatch')
  const environment = {}
  const types = { DSH_OFFICE_PYTHON: 'file', DSH_MEDIA_BROWSER: 'file', DSH_MEDIA_NODE_ENV: 'directory' }
  for (const [name, path] of Object.entries(manifest.environment ?? {})) {
    if (!Object.hasOwn(types, name)) throw new Error('Unsupported desktop resource environment key')
    environment[name] = await resourcePath(product, path, types[name])
  }
  if (manifest.python) {
    const base = await resourcePath(product, manifest.python.baseRoot, 'directory')
    const venv = await resourcePath(product, manifest.python.venvRoot, 'directory')
    const python = await resourcePath(product, `${manifest.python.baseRoot}/python.exe`)
    const venvPython = await resourcePath(product, `${manifest.python.venvRoot}/Scripts/python.exe`)
    const cfg = await resourcePath(product, `${manifest.python.venvRoot}/pyvenv.cfg`)
    if (environment.DSH_OFFICE_PYTHON !== venvPython || !/^3\.\d+\.\d+$/u.test(manifest.python.version)) throw new Error('Desktop Python identity mismatch')
    const markerPath = await resourcePath(product, `${manifest.python.venvRoot}/.eduwork-venv.json`)
    const marker = JSON.parse(await readFile(markerPath, 'utf8'))
    if (marker.schemaVersion !== 1 || marker.environmentLockSHA256 !== manifest.python.environmentLockSHA256) throw new Error('Desktop Python environment is not managed by this product')
    // CPython's Windows venv launcher reads absolute home/executable from this
    // file. Rewriting these two owned values makes a copied product relocatable.
    const expected = `home = ${base}\ninclude-system-site-packages = false\nversion = ${manifest.python.version}\nexecutable = ${python}\n`
    if (await readFile(cfg, 'utf8') !== expected) {
      const temporary = join(venv, `.pyvenv-${randomUUID()}.cfg`)
      await writeFile(temporary, expected, 'utf8')
      await rename(temporary, cfg)
    }
    const packages = await resourcePath(product, `${manifest.python.venvRoot}/Lib/site-packages`, 'directory')
    const custom = join(packages, 'sitecustomize.py')
    const existingPath = await resourcePath(product, `${manifest.python.venvRoot}/Lib/site-packages/sitecustomize.py`).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    const existing = existingPath === null ? null : await readFile(existingPath, 'utf8')
    if (existing !== null && !existing.startsWith('# EduWork managed private-runtime Windows import paths.')) throw new Error('Private Python contains an unmanaged site customization')
    if (existing !== PRIVATE_WINDOWS_PATHS) {
      const temporary = join(packages, `.sitecustomize-${randomUUID()}.py`)
      await writeFile(temporary, PRIVATE_WINDOWS_PATHS, 'utf8')
      await rename(temporary, custom)
    }
  }
  const pluginConfig = structuredClone(manifest.pluginConfig ?? {})
  for (const id of Object.keys(pluginConfig)) if (id !== 'eduwork-artifact-services') throw new Error('Unsupported native resource plugin')
  const transcription = pluginConfig['eduwork-artifact-services']?.transcription
  if (transcription) {
    if (Object.keys(transcription).some(key => key !== 'local')) throw new Error('Native resources cannot configure remote transcription')
    const local = transcription.local
    if (!local || typeof local !== 'object') throw new Error('Invalid local transcription resources')
    local.executablePath = await resourcePath(product, local.executablePath)
    local.modelPath = await resourcePath(product, local.modelPath)
  }
  return { environment, pluginConfig }
}

// Embed and verify the product icon using the locked JavaScript PE editor.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { fullPath, isFile, isMainModule, isWindows } from './lib/build-util.mjs'
import { readPEResources, writePEResources } from './lib/windows-pe.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))
const sourceIcon = join(scriptRoot, '../assets/eduwork/icon.ico')

export async function verifyDesktopIcon(executable, groupId, productName) {
  const source = await readFile(sourceIcon)
  const { library, resources } = await readPEResources(executable)
  const expected = library.Data.IconFile.from(source).icons.map(icon => icon.data)
  const groups = library.Resource.IconGroupEntry.fromEntries(resources.entries)
    .filter(group => group.id === groupId && group.lang === 1033)
  if (groups.length !== 1) throw new Error(`Expected one EduWork icon group ${groupId}`)
  const actual = groups[0].getIconItemsFromEntries(resources.entries)
  if (actual.length !== expected.length || actual.some((icon, index) =>
    !Buffer.from(icon.bin).equals(Buffer.from(expected[index].bin)))) {
    throw new Error('Embedded executable icon differs from EduWork source')
  }
  if (productName) {
    const names = library.Resource.VersionInfo.fromEntries(resources.entries).flatMap(version =>
      version.getAllLanguagesForStringValues().map(language => version.getStringValues(language).ProductName))
    if (!names.length || names.some(name => name !== productName)) throw new Error('Executable ProductName differs from the installed shortcut')
  }
}

export async function setDesktopIcon({ executable, shell = '', productName } = {}) {
  if (!isWindows) throw new Error('Executable icon resources exist on Windows only')
  if (shell && !['wails', 'electron'].includes(shell)) throw new Error('Shell must be wails or electron')
  executable = fullPath(executable)
  if (/(^|[\\/])current([\\/]|$)/i.test(executable) ||
      !/[\\/](?:wails(?:-candidate)?|electron-candidate|electron-ready)[\\/](?:EduWork(?:-Electron)?|ChatECNU-Work)\.exe$/i.test(executable)) {
    throw new Error('Icon replacement is limited to isolated EduWork candidate executables')
  }
  if (!await isFile(executable)) throw new Error(`Candidate executable is missing: ${executable}`)
  const groupId = shell === 'wails' || (!shell && /[\\/]wails(?:-candidate)?[\\/]/i.test(executable)) ? 32512 : 1
  const { library, executable: pe, resources } = await readPEResources(executable)
  const icons = library.Data.IconFile.from(await readFile(sourceIcon)).icons.map(icon => icon.data)
  // Drop every old icon group and image so Windows cannot select an Electron
  // default icon in another language before the product group.
  resources.entries.splice(0, resources.entries.length,
    ...resources.entries.filter(entry => entry.type !== 3 && entry.type !== 14))
  library.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, groupId, 1033, icons)
  // Electron finds the installed Start menu shortcut by the PE ProductName.
  if (productName) for (const version of library.Resource.VersionInfo.fromEntries(resources.entries)) {
    for (const language of version.getAllLanguagesForStringValues()) version.setStringValue(language, 'ProductName', productName)
    version.outputToResourceEntries(resources.entries)
  }
  await writePEResources(executable, pe, resources)
  await verifyDesktopIcon(executable, groupId, productName)
  console.log(`Verified EduWork executable icon: ${executable}`)
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: { executable: { type: 'string' }, shell: { type: 'string' } } })
  if (!values.executable) throw new Error('Use --executable <exe> [--shell wails|electron]')
  await setDesktopIcon({ executable: values.executable, shell: values.shell ?? '' })
}

// Embed and verify the product icon using the locked JavaScript PE editor.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { fullPath, isFile, isMainModule, isWindows } from './lib/build-util.mjs'
import { readPEResources, writePEResources } from './lib/windows-pe.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))
const sourceIcon = join(scriptRoot, '../assets/eduwork/icon.ico')

export function windowsFileVersion(version) {
  const match = typeof version === 'string' && version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:alpha|beta|rc)\.([1-9]\d*)|dev\.\d{8}\.([1-9]\d*)))?$/)
  if (!match) throw new Error('Unsupported Windows product version')
  const parts = [match[1], match[2], match[3], match[4] ?? match[5] ?? '0'].map(Number)
  if (parts.some(part => part > 65535)) throw new Error('Windows file version components must fit in 16 bits')
  return parts.join('.')
}

export function verifyDesktopVersionInfoResources(library, resources, { productName, companyName, version }) {
  const fileVersion = windowsFileVersion(version)
  const parts = fileVersion.split('.').map(Number)
  const expectedMS = ((parts[0] << 16) | parts[1]) >>> 0
  const expectedLS = ((parts[2] << 16) | parts[3]) >>> 0
  const versions = library.Resource.VersionInfo.fromEntries(resources.entries)
  if (!versions.length) throw new Error('Executable has no PE VersionInfo resource')
  for (const info of versions) {
    const strings = info.getAllLanguagesForStringValues()
    if (!strings.length) throw new Error('PE VersionInfo has no string table')
    if (info.fixedInfo.fileVersionMS !== expectedMS || info.fixedInfo.fileVersionLS !== expectedLS ||
        info.fixedInfo.productVersionMS !== expectedMS || info.fixedInfo.productVersionLS !== expectedLS) {
      throw new Error('PE fixed file and product versions do not match the desktop version')
    }
    for (const language of strings) {
      const values = info.getStringValues(language)
      if (values.ProductName !== productName || values.FileDescription !== productName ||
          values.CompanyName !== companyName || values.ProductVersion !== version || values.FileVersion !== fileVersion) {
        throw new Error('PE VersionInfo strings do not match the desktop product identity')
      }
    }
  }
  return fileVersion
}

export function setDesktopVersionInfoResources(library, resources, { productName, companyName, version }) {
  if (!productName || !companyName) throw new Error('Product and company names are required for PE VersionInfo')
  const fileVersion = windowsFileVersion(version)
  const parts = fileVersion.split('.').map(Number)
  const versions = library.Resource.VersionInfo.fromEntries(resources.entries)
  if (!versions.length) throw new Error('Executable has no PE VersionInfo resource')
  for (const info of versions) {
    info.setFileVersion(...parts)
    info.setProductVersion(...parts)
    let strings = info.getAllLanguagesForStringValues()
    if (!strings.length) strings = [{ lang: 1033, codepage: 1200 }]
    for (const language of strings) {
      info.setStringValues(language, {
        CompanyName: companyName,
        FileDescription: productName,
        FileVersion: fileVersion,
        ProductName: productName,
        ProductVersion: version,
      })
    }
    info.outputToResourceEntries(resources.entries)
  }
  verifyDesktopVersionInfoResources(library, resources, { productName, companyName, version })
  return fileVersion
}

export async function setDesktopVersionInfo({ executable, productName, companyName = 'EduWork', version } = {}) {
  if (!isWindows) throw new Error('Executable version resources exist on Windows only')
  executable = fullPath(executable)
  if (/(^|[\\/])current([\\/]|$)/i.test(executable) ||
      !/[\\/](?:electron-candidate|electron-ready)[\\/](?:EduWork(?:-Electron)?|ChatECNU-Work)\.exe$/i.test(executable)) {
    throw new Error('Version replacement is limited to isolated EduWork candidate executables')
  }
  if (!await isFile(executable)) throw new Error(`Candidate executable is missing: ${executable}`)
  const values = { productName, companyName, version }
  const { library, executable: pe, resources } = await readPEResources(executable)
  setDesktopVersionInfoResources(library, resources, values)
  await writePEResources(executable, pe, resources)
  const verified = await readPEResources(executable)
  verifyDesktopVersionInfoResources(verified.library, verified.resources, values)
  console.log(`Verified EduWork executable VersionInfo: ${executable}`)
}

export async function verifyDesktopIcon(executable, groupId) {
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
}

export async function setDesktopIcon({ executable, shell = '' } = {}) {
  if (!isWindows) throw new Error('Executable icon resources exist on Windows only')
  if (shell && shell !== 'electron') throw new Error('Shell must be electron')
  executable = fullPath(executable)
  if (/(^|[\\/])current([\\/]|$)/i.test(executable) ||
      !/[\\/](?:electron-candidate|electron-ready)[\\/](?:EduWork(?:-Electron)?|ChatECNU-Work)\.exe$/i.test(executable)) {
    throw new Error('Icon replacement is limited to isolated EduWork candidate executables')
  }
  if (!await isFile(executable)) throw new Error(`Candidate executable is missing: ${executable}`)
  const groupId = 1
  const { library, executable: pe, resources } = await readPEResources(executable)
  const icons = library.Data.IconFile.from(await readFile(sourceIcon)).icons.map(icon => icon.data)
  // Drop every old icon group and image so Windows cannot select an Electron
  // default icon in another language before the product group.
  resources.entries.splice(0, resources.entries.length,
    ...resources.entries.filter(entry => entry.type !== 3 && entry.type !== 14))
  library.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, groupId, 1033, icons)
  await writePEResources(executable, pe, resources)
  await verifyDesktopIcon(executable, groupId)
  console.log(`Verified EduWork executable icon: ${executable}`)
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: { executable: { type: 'string' }, shell: { type: 'string' } } })
  if (!values.executable) throw new Error('Use --executable <exe> [--shell electron]')
  await setDesktopIcon({ executable: values.executable, shell: values.shell ?? '' })
}

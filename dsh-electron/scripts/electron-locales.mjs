import { lstat, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

// EduWork's interface is Chinese or English, and Chromium shows its own menus
// and dialogs in English for any other system language. Other Electron
// translations are therefore not shipped.
const locales = {
  darwin: {
    suffix: '.lproj',
    kept: /^(?:en|en_GB|zh_CN|zh_TW)(?:_(?:FEMININE|MASCULINE|NEUTER))?\.lproj$/,
    required: ['en.lproj', 'zh_CN.lproj'],
    folders: app => [join(app, 'Contents/Resources'), join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources')],
  },
  win32: {
    suffix: '.pak',
    kept: /^(?:en-US|en-GB|zh-CN|zh-TW)\.pak$/,
    required: ['en-US.pak', 'zh-CN.pak'],
    folders: app => [join(app, 'locales')],
  },
}

async function size(path) {
  const info = await lstat(path)
  if (!info.isDirectory()) return info.size
  let bytes = 0
  for (const name of await readdir(path)) bytes += await size(join(path, name))
  return bytes
}

/** Remove Electron translations other than Chinese and English from an assembled app. */
export async function pruneElectronLocales(app, platform) {
  const { suffix, kept, required, folders } = locales[platform]
  const result = { kept: [], removed: 0, bytes: 0 }
  for (const folder of folders(app)) {
    const names = await readdir(folder)
    for (const name of required) if (!names.includes(name)) throw new Error(`Electron locale resource is missing: ${join(folder, name)}`)
    for (const name of names) {
      if (!name.endsWith(suffix)) continue
      if (kept.test(name)) { if (!result.kept.includes(name)) result.kept.push(name); continue }
      result.bytes += await size(join(folder, name))
      result.removed++
      await rm(join(folder, name), { recursive: true })
    }
  }
  result.kept.sort()
  return result
}

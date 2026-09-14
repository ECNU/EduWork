import { readFile, readdir, lstat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join, relative, isAbsolute } from 'node:path'
const root = resolve(process.argv[2])
const manifest = JSON.parse(await readFile(join(root, 'RELEASE-MANIFEST.json'), 'utf8'))
if (manifest.schemaVersion !== 1 || manifest.kind !== 'eduwork-portable-release' || manifest.shell !== 'electron') throw Error('Unexpected package manifest')
const seen = new Set(['RELEASE-MANIFEST.json'])
for (const file of manifest.files) {
  const path = resolve(root, file.path), rel = relative(root, path)
  if (isAbsolute(rel) || rel.startsWith('..') || seen.has(file.path) || file.path.includes('\\')) throw Error('Invalid manifest path')
  seen.add(file.path)
  const stat = await lstat(path)
  if (!stat.isFile() || stat.size !== file.bytes) throw Error('Package file size/type differs: '+file.path)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  if (hash.digest('hex') !== file.sha256) throw Error('Package file hash differs: '+file.path)
}
async function inventory(directory) {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const path=join(directory,entry.name)
    if (entry.isSymbolicLink()) throw Error('Unexpected extracted symlink')
    if (entry.isDirectory()) await inventory(path)
    else if (!seen.has(relative(root,path).replaceAll('\\','/'))) throw Error('Unlisted package file')
  }
}
await inventory(root)
const identity = JSON.parse(await readFile(join(root,'resources/app/eduwork.desktop.json'),'utf8'))
if (identity.productVersion !== manifest.version || identity.distribution !== manifest.distribution) throw Error('Release identity differs')
if (process.argv.includes('--for-update')) {
  if (manifest.launcherVersion !== manifest.version || manifest.flavor !== 'offline' || manifest.launch?.protocol !== 'eduwork-desktop/v1' || manifest.launch?.shell !== 'electron' || manifest.launch?.executable !== 'EduWork-Electron.exe' || manifest.launch?.migration !== 'wails-host-v1' || manifest.launch?.distribution !== identity.distribution) throw Error('Release update contract differs')
  for (const name of ['ChatECNU-Work.exe','EduWork.exe','resources/update/EduWork-Updater.exe']) if (!seen.has(name)) throw Error('Release update launcher missing: '+name)
}
console.log('Extracted ZIP verified: '+manifest.files.length+' files')

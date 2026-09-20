import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Sparkle ignores hyphenated suffixes. Encode the supported prerelease grammar
// without a hyphen so every development build sorts before its stable release.
export function bundleVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-dev\.\d{8}\.[1-9]\d*)?$/.test(version)) throw Error('Unsupported desktop version')
  return version.replace('-dev.', 'dev')
}
export function validateMacUpdateConfig(raw) {
  if (raw.schemaVersion !== 1 || !raw.feeds?.stable || !raw.feeds?.development) throw Error('Both macOS update channels are required')
  for (const [channel, value] of Object.entries(raw.feeds)) {
    const url = new URL(value)
    if (!['stable','development'].includes(channel) || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Invalid macOS update feed')
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw.publicEDKey) || Buffer.from(raw.publicEDKey, 'base64').length !== 32) throw Error('Invalid Sparkle Ed25519 public key')
  return raw
}
const xml = value => String(value).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]))
export function appcast({version,url,bytes,signature}) {
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.username || target.password || target.hash || target.search) throw Error('Archive URL must be fixed HTTPS')
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || Buffer.from(signature,'base64').length !== 64) throw Error('Invalid signed archive')
  return `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>EduWork updates</title><item><title>${xml(version)}</title><sparkle:version>${xml(bundleVersion(version))}</sparkle:version><sparkle:shortVersionString>${xml(version)}</sparkle:shortVersionString><sparkle:minimumSystemVersion>15.0</sparkle:minimumSystemVersion><enclosure url="${xml(url)}" length="${bytes}" type="application/octet-stream" sparkle:edSignature="${xml(signature)}"/></item></channel></rss>\n`
}
async function main() {
  const [mode,...args] = process.argv.slice(2)
  if (mode === 'version') { console.log(bundleVersion(args[0])); return }
  if (mode === 'prepare') {
    const [configFile,output] = args
    const config = validateMacUpdateConfig(JSON.parse(await readFile(configFile,'utf8')))
    const lock = JSON.parse(await readFile(new URL('../dsh-electron/sparkle.lock.json',import.meta.url),'utf8'))
    const response = await fetch(lock.url)
    if (!response.ok) throw Error(`Sparkle download: ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex') !== lock.sha256) throw Error('Sparkle checksum mismatch')
    await mkdir(output,{recursive:true})
    const archive = join(output,'sparkle.tar.xz')
    await writeFile(archive,bytes);execFileSync('tar',['-xf',archive,'-C',output])
    await writeFile(join(output,'inputs.json'),JSON.stringify({...config,framework:resolve(output,'Sparkle.framework'),version:lock.version,sha256:lock.sha256},null,2)+'\n')
    return
  }
  if (mode === 'sign') {
    const [archive,receiptFile,configFile,keyFile,url,output] = args
    const config = validateMacUpdateConfig(JSON.parse(await readFile(configFile,'utf8')))
    const receipt = JSON.parse(await readFile(receiptFile,'utf8')), bytes = await readFile(archive)
    if (!(receipt.sparkleEnabled ?? receipt.softwareAutoUpdate) || receipt.bundleVersion !== bundleVersion(receipt.version) || receipt.asset.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw Error('Archive does not match the verified Sparkle receipt')
    const key = createPrivateKey(await readFile(keyFile))
    if (key.asymmetricKeyType !== 'ed25519' || createPublicKey(key).export({format:'der',type:'spki'}).subarray(-32).toString('base64') !== config.publicEDKey) throw Error('Signing key differs from the bundled trust anchor')
    await writeFile(output,appcast({version:receipt.version,url,bytes:bytes.length,signature:sign(null,bytes,key).toString('base64')}),{flag:'wx'})
    return
  }
  throw Error('Expected prepare, version or sign')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const root = fileURLToPath(new URL('../', import.meta.url))
const hash = data => createHash('sha256').update(data).digest('hex')
const put = (path, value) => writeFile(path, JSON.stringify(value))
async function fixture(t) {
  await mkdir(join(root, 'dist'), { recursive: true })
  const directory = await mkdtemp(join(root, 'dist/assembly-policy-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const lock = JSON.parse(await readFile(join(root, 'third_party/dsh/release-v0.1.5-rc.2/LOCK.json')))
  const proof = await readFile(join(root, 'third_party/dsh/release-v0.1.5-rc.2/npm-runtime/package-lock.json'))
  const runtime = join(directory, 'runtime'); await mkdir(runtime)
  const identity = { source: 'npm-lock', platform: process.platform, arch: process.arch, dshVersion: lock.packageVersion, dshCommit: lock.commit, packageLockSHA256: hash(proof) }
  const projectionProof = Buffer.from('{"packages":{}}')
  const projection = { ...identity, policySHA256: hash(await readFile(join(root, 'scripts/project-eduwork-runtime.mjs'))), distributionLockSHA256: hash(projectionProof) }
  await put(join(runtime, '.chatecnu-dsh-runtime.json'), identity)
  await writeFile(join(runtime, '.chatecnu-dsh-npm-install-lock.json'), proof)
  await put(join(runtime, '.eduwork-distribution-runtime.json'), projection)
  await writeFile(join(runtime, '.eduwork-distribution-lock.json'), projectionProof)
  const run = () => spawnSync('pwsh', ['-NoProfile', '-File', join(root, 'scripts/assemble-eduwork-web.ps1'), '-CoreRoot', root, '-RuntimeSource', runtime, '-Upstream', join(directory, 'unused-source'), '-Output', join(directory, 'output'), '-Version', '0.3.0-dev.test'], { encoding: 'utf8', windowsHide: true })
  return { runtime, identity, projection, run }
}
test('npm assembly rejects a source-runtime cache instead of silently changing mode', async t => {
  const f = await fixture(t)
  await put(join(f.runtime, '.chatecnu-dsh-runtime.json'), { ...f.identity, source: 'source-release-pack' })
  const result = f.run(); assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /npm mode requires the selected registry package lock/)
})
for (const field of ['arch', 'policySHA256']) test(`npm assembly rejects an existing projection with a different ${field}`, async t => {
  const f = await fixture(t)
  await put(join(f.runtime, '.eduwork-distribution-runtime.json'), { ...f.projection, [field]: 'other' })
  const result = f.run(); assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /another projection policy,[\s\S]*platform or[\s\S]*architecture/)
})
test('npm assembly checks the actual distribution lock, not only its receipt', async t => {
  const f = await fixture(t)
  await writeFile(join(f.runtime, '.eduwork-distribution-lock.json'), 'changed')
  const result = f.run(); assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /Distribution Runtime lock proof differs/)
})

test('web package and skill staging use portable paths and commands', async () => {
  for (const name of ['install-locked-dsh-package.ps1', 'copy-dsh-package-payload.ps1', 'install-bundled-dsh-skills.ps1']) {
    const script = await readFile(join(root, 'scripts', name), 'utf8')
    assert.match(script, /\[IO\.Path\]::DirectorySeparatorChar/, name)
    assert.doesNotMatch(script, /TrimEnd\('\\\\'\)/, name)
    assert.doesNotMatch(script, /\+ '\\\\'/, name)
    assert.doesNotMatch(script, /npm\.cmd|tar\.exe/, name)
  }
  for (const name of ['client-ui-branding', 'client-ui-conversation-brand', 'client-ui-skill-live', 'client-ui-component-inventory', 'client-ui-agent-preset-product', 'client-ui-media-artifacts']) {
    const script = await readFile(join(root, 'dsh-plugins', name, 'build-client.ps1'), 'utf8')
    assert.match(script, /\[IO\.Path\]::DirectorySeparatorChar/, name)
    assert.doesNotMatch(script, /\+ '\\\\'/, name)
  }
  for (const name of ['client-ui-branding', 'client-ui-component-inventory', 'client-ui-media-artifacts', 'workbench-native', 'activity-insights-native']) {
    const script = await readFile(join(root, 'dsh-plugins', name, 'build-client.ps1'), 'utf8')
    assert.match(script, /\$IsWindows[\s\S]*tsdown\.cmd[\s\S]*tsdown/, name)
  }
  for (const name of ['workbench-native', 'activity-insights-native']) {
    const script = await readFile(join(root, 'dsh-plugins', name, 'build-client.ps1'), 'utf8')
    assert.match(script, /\$IsWindows[\s\S]*Junction[\s\S]*SymbolicLink/, name)
    assert.doesNotMatch(script, /-ItemType Junction/, name)
  }
  const assembly = await readFile(join(root, 'scripts/assemble-eduwork-web.ps1'), 'utf8')
  assert.match(assembly, /foreach \(\$packageName in \$local\.Keys\).*\$bundleDependencies\[\$packageName\]/s)
  assert.match(assembly, /dependencies=\$bundleDependencies/)
  const product = await readFile(join(root, 'scripts/prepare-desktop-product.ps1'), 'utf8')
  assert.match(product, /if \(-not \$IsWindows\)[\s\S]*Copy-Item -LiteralPath \$Source -Destination \$Destination -Recurse/)
  const electron = await readFile(join(root, 'dsh-electron/scripts/prepare-electron.ps1'), 'utf8')
  assert.match(electron, /\$IsMacOS[\s\S]*'darwin'/)
  assert.doesNotMatch(electron, /tar\.exe/)
  const mac = await readFile(join(root, 'dsh-electron/scripts/assemble-macos.ps1'), 'utf8')
  assert.match(mac, /Electron\.app/)
  assert.match(mac, /ditto -c -k --sequesterRsrc --keepParent/)
  assert.match(mac, /codesign --force --deep --sign - --timestamp=none/)
  assert.match(mac, /xattr -cr \$app/)
  assert.match(mac, /xattr -cr \$signingApp/)
  assert.match(mac, /developerIDSigned=\$false; adHocSigned=\$true; notarized=\$false/)
  assert.match(mac, /\[Parameter\(Mandatory\)\]\[string\]\$OpenSSL/)
  assert.match(mac, /vtool -set-build-version macos 15\.0 15\.5 -replace/)
  assert.match(mac, /@loader_path\/libssl\.3\.dylib/)
  assert.match(mac, /@loader_path\/libcrypto\.3\.dylib/)
  assert.match(mac, /LADYBUG_QUERY_OK/)
  assert.match(mac, /@\('LSMinimumSystemVersion','15\.0'\)/)
  assert.match(mac, /\[string\]\$ExternalPublisherConfig/)
  assert.match(mac, /\[IO\.Path\]::IsPathRooted\(\$ExternalPublisherConfig\)/)
  assert.match(mac, /External publisher configuration requires publisher ownership/)
  assert.match(mac, /Remove-Item -LiteralPath \$bundledPublisherConfig -Force/)
  assert.match(mac, /\$desktop\.publisherConfig=\$ExternalPublisherConfig/)
  assert.match(mac, /macos-arm64-electron\$archiveQualifier\.zip/)

  const configPackage = await readFile(join(root, 'scripts/package-macos-external-config.ps1'), 'utf8')
  assert.match(configPackage, /\[Parameter\(Mandatory\)\]\[string\]\$Config/)
  assert.match(configPackage, /validate-distribution-config\.mjs/)
  assert.match(configPackage, /Library\/Application Support\/EduWork-ECNU\/config/)
  assert.match(configPackage, /xattr -cr \$payload/)
  assert.match(configPackage, /pkgbuild/)
  assert.match(configPackage, /Get-FileHash[\s\S]*SHA256/)
  assert.match(configPackage, /receipt\.json/)
})

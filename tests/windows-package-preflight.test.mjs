import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Exercise the actual packaging scripts up to the next required artifact check.
// Full signed updater/ZIP/extractor acceptance remains in native desktop CI.
test('Windows packers admit Alpha, dev and stable identities without weakening artifact checks', {skip: process.platform !== 'win32'}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-pack-preflight-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const run = args => spawnSync('pwsh', ['-NoProfile', ...args], {encoding:'utf8', windowsHide:true})
  const zipScript = join(root, 'zip.ps1')
  await writeFile(zipScript, `param($Source,$Destination,$Output,$Packer)
Compress-Archive -LiteralPath $Source -DestinationPath $Destination
$hash=(Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
& $Packer -Archive $Destination -ExpectedSHA256 $hash -OutputDirectory $Output
`)
  for (const version of ['0.4.0-alpha.1','0.3.6-dev.20260928.2','0.4.0']) {
    const candidate=join(root,version,'EduWork'), identity=join(candidate,'resources/app')
    await mkdir(identity,{recursive:true})
    await writeFile(join(identity,'eduwork.desktop.json'), JSON.stringify({productName:'EduWork',productVersion:version,distribution:'eduwork',shell:'electron'}))
    const args=['-File',resolve('scripts/pack-windows-release.ps1'),'-Candidate',candidate,'-Output',join(root,`EduWork-${version}-windows-x64-electron.zip`),'-ForUpdate']
    if (version.includes('-')) args.push('-Development')
    const pack=run(args)
    assert.notEqual(pack.status,0)
    assert.match(pack.stderr,/Migration launcher is missing/,pack.stderr)
    if (version.includes('-')) {
      const wrongChannel=run(args.filter(value=>value!=='-Development'))
      assert.match(wrongChannel.stderr,/does not match its selected channel/,wrongChannel.stderr)
    }
    const extractor=run(['-File',zipScript,'-Source',candidate,'-Destination',join(root,`${version}.zip`),'-Output',join(root,`extractor-${version}`),'-Packer',resolve('scripts/pack-portable-extractor.ps1')])
    assert.notEqual(extractor.status,0)
    assert.match(extractor.stderr,/Missing or oversized product icon/,extractor.stderr)
  }
})

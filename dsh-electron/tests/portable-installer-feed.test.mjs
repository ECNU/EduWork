import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { createRequire, registerHooks } from 'node:module'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const resolveLocked = createRequire(new URL('../../third_party/dsh/candidate-v0.2.2-rc.3/desktop-probe/package.json', import.meta.url)).resolve
const dependencies = new Map(['builder-util-runtime', 'js-yaml', 'semver'].map(name => [name, pathToFileURL(resolveLocked(name)).href]))
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/portable-installer-feed.mjs') && dependencies.has(specifier)) return next(dependencies.get(specifier), context)
  return next(specifier, context)
} })
const { portableInstallerSource, discoverPortableInstaller, downloadPortableInstaller } = await import('../src/portable-installer-feed.mjs')
hook.deregister()

const github = { provider: 'github', repository: 'ECNU/EduWork' }
const staticFeed = { provider: 'static', manifestURL: 'https://updates.example.test/win/stable/latest-windows-amd64.json' }
const options = { platform: 'win32', settings: { portableMigration: true, distribution: 'eduwork' }, effective: github, bundled: github }
const githubSource = portableInstallerSource(options)
const stableURL = new URL(staticFeed.manifestURL)
const staticSource = portableInstallerSource({ ...options, effective: staticFeed, bundled: staticFeed })
const release = 'https://github.com/ECNU/EduWork/releases/download/'
const bytes = Buffer.from('synthetic installer')
const sha512 = createHash('sha512').update(bytes).digest('base64')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const name = version => `EduWork-Setup-${version}-x64.exe`
const yaml = version => `version: ${version}\nfiles:\n  - url: ${name(version)}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name(version)}\nsha512: ${sha512}\n`
const atom = (...versions) => `<feed>${versions.map(version => `<entry><link href="https://github.com/ECNU/EduWork/releases/tag/v${version}"/></entry>`).join('')}</feed>`
const fixtureFetch = (routes, seen = []) => async (url, options) => {
  assert.equal(options.redirect, 'manual')
  assert.equal(options.credentials, 'omit')
  seen.push(url.href)
  const body = routes[url.href]
  return body instanceof Response ? body : body === undefined ? new Response(null, { status: 404 }) : new Response(body)
}

test('the opt-in admits only matching trusted Windows portable feeds', () => {
  assert.deepEqual(githubSource, github)
  for (const override of [
    { settings: { distribution: 'eduwork' } }, { settings: { ...options.settings, portableMigration: 'true' } },
    { platform: 'darwin' }, { settings: { ...options.settings, dataLayout: 'installed' } },
    { settings: { ...options.settings, sourceAlpha: true } }, { effective: { provider: 'disabled' } },
    { effective: { ...github, repository: 'other/EduWork' } }, { bundled: undefined },
    { effective: staticFeed }, { bundled: staticFeed },
  ]) assert.equal(portableInstallerSource({ ...options, ...override }), null)
  assert.deepEqual(portableInstallerSource({ ...options, effective: staticFeed, bundled: undefined, publisher: staticFeed }), staticSource)
})

test('GitHub binds stable metadata and compares only the first valid development tag', async () => {
  const seen = []
  const request = fixtureFetch({
    'https://api.github.com/repos/ECNU/EduWork/releases/latest': JSON.stringify({ tag_name: 'v0.4.15', draft: false, prerelease: false }),
    [`${release}v0.4.15/latest.yml`]: yaml('0.4.15'),
    'https://github.com/ECNU/EduWork/releases.atom': atom('0.4.15', '0.4.16-dev.20261125.1', '0.4.17-dev.20261125.1'),
    [`${release}v0.4.16-dev.20261125.1/dev.yml`]: yaml('0.4.16-dev.20261125.1'),
  }, seen)
  const find = (policy, version) => discoverPortableInstaller({ source: githubSource, policy, version, fetch: request })
  assert.equal((await find('stable', '0.4.15')).version, '0.4.15')
  assert.equal(await find('stable', '0.4.16'), null)
  assert.equal((await find('development', '0.4.15')).version, '0.4.16-dev.20261125.1')
  assert.equal(seen.some(url => url.includes('0.4.17')), false)
})

test('GitHub rejects incorrect metadata and untrusted redirects', async () => {
  const latest = 'https://api.github.com/repos/ECNU/EduWork/releases/latest'
  const metadata = `${release}v0.4.15/latest.yml`
  for (const body of [yaml('0.4.16'), yaml('0.4.15').replace(`size: ${bytes.length}`, 'size: -1'), yaml('0.4.15').replace('sha512:', 'sha256:'),
    yaml('0.4.15').replace('x64.exe', 'ia32.exe'), 'files: [', Response.redirect('https://release-assets.githubusercontent.com.evil.test/metadata')]) {
    await assert.rejects(discoverPortableInstaller({ source: githubSource, policy: 'stable', version: '0.4.14', fetch: fixtureFetch({
      [latest]: JSON.stringify({ tag_name: 'v0.4.15' }), [metadata]: body,
    }) }))
  }
  assert.equal(await discoverPortableInstaller({ source: githubSource, policy: 'stable', version: '0.4.14', fetch: fixtureFetch({
    [latest]: JSON.stringify({ tag_name: 'v0.4.15' }),
  }) }), null)
})

function staticManifest() {
  return { schemaVersion: 1, distribution: 'eduwork', channel: 'stable', target: 'windows-amd64', version: '0.4.15',
    artifacts: [{ shell: 'electron', flavor: 'offline' }], installer: { fileName: name('0.4.15'), bytes: bytes.length,
      sha256, url: new URL(name('0.4.15'), stableURL).href } }
}

test('static installers are optional and bound to the Electron edition and channel directory', async () => {
  const manifest = staticManifest()
  const find = data => discoverPortableInstaller({ source: staticSource, version: '0.4.15', policy: 'stable', fetch: fixtureFetch({ [stableURL.href]: JSON.stringify(data) }) })
  assert.equal((await find(manifest)).digest, sha256)
  assert.equal(await find({ ...manifest, installer: undefined }), null)
  for (const mutation of [{ distribution: 'elsewhere' }, { target: 'windows-arm64' }, { channel: 'development' }, { artifacts: [{ shell: 'wails' }] },
    { installer: { ...manifest.installer, fileName: 'anything-x64.exe' } }, { installer: { ...manifest.installer, sha256: 'invalid' } },
    { installer: { ...manifest.installer, url: `https://updates.example.test/win/development/${name('0.4.15')}` } }]) {
    await assert.rejects(find({ ...manifest, ...mutation }))
  }
})

test('download verifies byte count and digest before renaming, and cleans its own failures', async t => {
  const cache = await mkdtemp(join(tmpdir(), 'eduwork-installer-download-'))
  t.after(() => rm(cache, { recursive: true, force: true }))
  const installer = await discoverPortableInstaller({ source: staticSource, version: '0.4.14', policy: 'stable',
    fetch: fixtureFetch({ [stableURL.href]: JSON.stringify(staticManifest()) }) })
  for (const body of [bytes.subarray(0, 3), Buffer.alloc(bytes.length), Buffer.alloc(bytes.length + 1), Response.redirect('https://other.example.test/download')]) {
    await assert.rejects(downloadPortableInstaller({ installer, cache, fetch: fixtureFetch({ [installer.url]: body }) }))
    assert.deepEqual(await readdir(cache), [])
  }
  await assert.rejects(downloadPortableInstaller({ installer, cache, signal: AbortSignal.abort(), fetch: fixtureFetch({ [installer.url]: bytes }) }))
  assert.deepEqual(await readdir(cache), [])
  const path = await downloadPortableInstaller({ installer, cache, fetch: fixtureFetch({ [installer.url]: bytes }) })
  assert.deepEqual(await readFile(path), bytes)
})

// Prepare a mirror of the Host's rendered web shell for the relay.
//
// The plugin's `POST /remote-access-admin/<token>/export-web` writes a snapshot:
//
//   index.html                      the rendered Host page (injections + boot graph)
//   manifest.json                   what was fetched
//   assets/<url-path>               the files the page named, e.g. assets/index-*.js,
//                                   plugins/combo/<sha256>.js
//
// This script turns that into the relay's frontend root:
//
//   <output>/index.html             served at /eduwork/ and injected with the bootstrap
//   <output>/assets/...             shell assets
//   <output>/plugins/...            client bundles and combo files
//
// The index's own asset URLs are relative (`./assets/...`) and work at /eduwork/ because
// of its `<base href="./">`. Only root-relative `/plugins/...` URLs (if the Host ever
// emits them) need the public prefix, because they would otherwise resolve to the relay
// origin's root, which Caddy does not route to the relay.
//
//   node deploy/mirror-web-snapshot.mjs <snapshot-dir> <output-dir> [public-prefix]
//
// public-prefix defaults to /eduwork/ and must match the Caddy handle_path prefix and
// EDUWORK_RELAY_BOOTSTRAP_SCRIPT.

import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [snapshot, output, prefix = '/eduwork/'] = process.argv.slice(2)
if (snapshot === undefined || output === undefined) {
  console.error('usage: node deploy/mirror-web-snapshot.mjs <snapshot-dir> <output-dir> [public-prefix]')
  process.exit(2)
}

const page = await readFile(join(snapshot, 'index.html'), 'utf8')
const rewritten = page.replaceAll('/plugins/', `${prefix}plugins/`)
await mkdir(output, { recursive: true })
await writeFile(join(output, 'index.html'), rewritten)

async function copyIfPresent(source, target) {
  try {
    await stat(source)
  } catch {
    return 0
  }
  await cp(source, target, { recursive: true })
  return 1
}

await mkdir(join(output, 'assets'), { recursive: true })
await mkdir(join(output, 'plugins'), { recursive: true })
await copyIfPresent(join(snapshot, 'assets', 'assets'), join(output, 'assets'))
await copyIfPresent(join(snapshot, 'assets', 'plugins'), join(output, 'plugins'))
for (const name of ['manifest.webmanifest', 'favicon.svg', 'favicon-dark.svg']) {
  await copyIfPresent(join(snapshot, 'assets', name), join(output, name))
}

const rootUrls = [...rewritten.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map(match => match[1])
const unresolved = rootUrls.filter(url => !url.startsWith(prefix))
console.log(`mirror written to ${output}`)
if (unresolved.length > 0) {
  console.warn('root-relative URLs outside the public prefix:')
  for (const url of unresolved.slice(0, 12)) console.warn(`  ${url}`)
  console.warn('serve those paths under the same prefix or the page will 404.')
}

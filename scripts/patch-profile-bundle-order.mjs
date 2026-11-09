import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const metadata = {
  id: 'eduwork-profile-bundle-order-v1', package: '@deepseek-ai/dsh-app-boot',
  version: '0.2.2-rc.1', file: 'lib/index.js',
  beforeSHA256: '346f832224737cd9ab1b5e37d111ae232fdd78b5ab892fa3179c112baf6f0a22',
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

// The plugin manager appends newly enabled bundles. Keep our deployment layer
// last among bundles on every load (including HMR); native user patches still
// follow it. Remove once the Runtime supports a separate deployment layer.
export async function patchProfileBundleOrder(modules) {
  const root = join(modules, metadata.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== metadata.package || manifest.version !== metadata.version) throw new Error('Profile bundle ordering requires a newly qualified Runtime')
  const file = join(root, metadata.file), input = await readFile(file)
  if (sha256(input) !== metadata.beforeSHA256) throw new Error('Profile bundle loader input changed; review the deployment layer order')
  const anchor = 'const bundles = dropRetiredBundles(dir, readProfileManifest(binName, dir)).dsh?.profile?.bundles ?? [];'
  const source = input.toString('utf8')
  if (source.split(anchor).length !== 2) throw new Error('Profile bundle loader anchor changed')
  const output = source.replace(anchor, `const selected = dropRetiredBundles(dir, readProfileManifest(binName, dir)).dsh?.profile?.bundles ?? [];
	const deployment = "@eduwork/generated-profile";
	const bundles = selected.includes(deployment) ? [...selected.filter(name => name !== deployment), deployment] : selected;`)
  await writeFile(file, output)
  return { ...metadata, afterSHA256: sha256(output) }
}

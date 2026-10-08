import { cp, readdir, readlink, realpath } from 'node:fs/promises'
import { resolve, relative, join, isAbsolute, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// Node's default cp rewrites relative links to the source's absolute location.
// Preserve npm's internal relative links so the product can move independently.
export const copyProductTree = (source, destination) => cp(source, destination, { recursive: true, verbatimSymlinks: true })

export async function assertContainedProductLinks(directory) {
  const root = await realpath(directory)
  let links = 0
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isSymbolicLink()) {
        const label = relative(root, path), target = await readlink(path)
        if (isAbsolute(target)) throw Error('Nonportable absolute product link: ' + label)
        const resolved = relative(root, await realpath(path))
        if (isAbsolute(resolved) || resolved === '..' || resolved.startsWith('..' + sep)) throw Error('Product link escapes its payload: ' + label)
        links++
      } else if (entry.isDirectory()) await walk(path)
    }
  }
  await walk(root)
  return { containedLinks: links }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await assertContainedProductLinks(resolve(process.argv[2]))))
}

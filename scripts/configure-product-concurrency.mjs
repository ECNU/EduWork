import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Only mutate the assembled product library, never user presets or upstream source.
export async function configureProductConcurrency(runtime) {
  const { parseDocument, visit: walk } = createRequire(join(resolve(runtime), 'package.json'))('yaml')
  let changed = 0
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile() && entry.name === 'agent.cordis.yml') {
        const source = await readFile(file, 'utf8')
        const document = parseDocument(source, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })
        if (document.errors.length) throw document.errors[0]
        let dirty = false
        walk(document, { Map(_key, value) {
          if (value.get('name') !== '@deepseek-ai/dsh-workflow-worker-thread') return
          if (!value.has('config')) value.set('config', document.createNode({}))
          value.get('config').set('maxConcurrentAgents', 2); dirty = true; changed++
        } })
        if (dirty) await writeFile(file, document.toString())
      }
    }
  }
  await visit(join(runtime, 'presets'))
  return { workflowProviders: changed, maxConcurrentAgents: 2 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await configureProductConcurrency(process.argv[2])))
}

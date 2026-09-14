import { readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

function serializableTask(task) {
  const { controller: _controller, promise: _promise, persistTimer: _persistTimer, ...snapshot } = task
  return snapshot
}

export class TaskJournal {
  #pathFor
  #tails = new Map()

  constructor(pathFor) {
    this.#pathFor = pathFor
  }

  async read(workspaceId) {
    const path = this.#pathFor(workspaceId)
    try {
      const value = JSON.parse(await readFile(path, 'utf8'))
      return value && typeof value === 'object' ? value : null
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      return null
    }
  }

  write(workspaceId, task) {
    const key = String(workspaceId)
    const previous = this.#tails.get(key) ?? Promise.resolve()
    const current = previous.then(async () => {
      const path = this.#pathFor(key)
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(serializableTask(task), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, path)
    })
    this.#tails.set(key, current.catch(() => {}))
    return current
  }

  async flush() {
    await Promise.allSettled(this.#tails.values())
  }
}

export { serializableTask }

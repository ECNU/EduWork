import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {dshHomePath} from '@deepseek-ai/dsh-home-paths'

// Profile-owned, rather than browser-origin-owned: development ports and host
// restarts must not reset a user's explicit Studio choice.
export class StudioUIPreferences {
  #path
  #tail = Promise.resolve()
  constructor(path = dshHomePath('plugins', 'dsh-knowledge-studio', 'ui-preferences.json')) { this.#path = path }
  async read() {
    await this.#tail
    try {
      const value = JSON.parse(await readFile(this.#path, 'utf8'))
      return {open: value.open === true}
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return {open: false}
    }
  }
  set(open) {
    if (typeof open !== 'boolean') throw new Error('Studio open preference must be boolean')
    const task = this.#tail.then(async () => {
      await mkdir(dirname(this.#path), {recursive: true})
      const temporary = this.#path + '.' + process.pid + '.tmp'
      await writeFile(temporary, JSON.stringify({version: 1, open}) + '\n', {mode: 0o600})
      await rename(temporary, this.#path)
      return {open}
    })
    this.#tail = task.catch(() => {})
    return task
  }
}

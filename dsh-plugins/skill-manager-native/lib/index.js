import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { PersonalSkillStore } from './core.js'

export const name = 'skill-manager-native'
const remoteInitializers = []

export class SkillManagerService extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'skillManager')
    for (const initialize of remoteInitializers) initialize.call(this)
    this.store = new PersonalSkillStore()
  }

  list() {
    return this.store.list()
  }

  create(input) {
    return this.store.create(input)
  }

  importDirectory(sourcePath) {
    return this.store.importDirectory(sourcePath)
  }

  trashPersonalSkill(name) {
    return this.store.remove(name)
  }
}

for (const method of ['list', 'create', 'importDirectory', 'trashPersonalSkill']) {
  Remote(method)(SkillManagerService.prototype[method], {
    kind: 'method', name: method, static: false, private: false,
    addInitializer(initializer) { remoteInitializers.push(initializer) },
  })
}

export default SkillManagerService

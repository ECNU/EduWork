import { REMOTE } from './remote.js'

export const TYPERT = {
  package: '@eduwork/dsh-message-edit',
  face: 'host',
  schemas: [],
  get invocations() { return REMOTE.descriptors },
  model: { services: [], events: [], objects: [] },
}

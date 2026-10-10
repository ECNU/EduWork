// Client face of the calendar remote surface.
//
// The client half mounts this with `ctx.remote.$mount(...)` before it may call
// `remote.calendar`. The descriptor list is the same object the host manifest
// publishes, so a method the host does not declare cannot be mounted here.
import { descriptors } from './typert-descriptors.js'

export default {
  package: '@eduwork/dsh-calendar',
  descriptors,
}

// Host face of the calendar remote surface.
//
// typert-loader imports this module through the package's "./typert" export and
// registers the manifest, which is what makes `remote.calendar` callable from
// the client half. `package` must equal the installed package name, or the
// loader rejects the manifest and names the mismatch. The descriptor list is
// shared with the client face, so the two cannot drift apart.
import { descriptors } from './typert-descriptors.js'

const pkg = '@eduwork/dsh-calendar'

export const TYPERT = {
  package: pkg,
  face: 'host',
  schemas: [],
  invocations: descriptors,
  model: { services: [], events: [], objects: [] },
}

export default TYPERT

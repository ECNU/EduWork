// The one descriptor list both faces of the calendar remote surface publish.
//
// The host manifest (`lib/typert.host.js`) and the client mount
// (`lib/typert.remote-client.js`) have to declare the same methods, the same
// argument names and the same schemas; building both from this list is what makes
// that true by construction instead of by review. `sourceLocation` points at the
// method that implements the descriptor in `lib/index.js`.
import {
  cancelParameter,
  deleteEventParameter,
  eventParameter,
  eventResult,
  exportParameter,
  exportResult,
  importParameter,
  importResult,
  occurrencesResult,
  overrideParameter,
  rangeParameter,
  removalResult,
  removeOverrideParameter,
  restoreParameter,
  snapshotResult,
} from './typert-schemas.js'

const pkg = '@eduwork/dsh-calendar'

/**
 * @param method - Method name, which is also the service's own method name.
 * @param line - Line of the method in `lib/index.js`.
 * @param parameters - One entry per argument, in call order.
 * @param result - Result type of the method.
 * @returns a frozen descriptor.
 */
const descriptor = (method, line, parameters, result) => Object.freeze({
  id: `${pkg}#calendar/${method}`,
  service: 'calendar',
  namespace: 'calendar',
  method,
  invocation: { kind: 'direct' },
  parameters: Object.freeze(parameters),
  result,
  sourceLocation: { file: 'dsh-plugins/calendar/lib/index.js', line, column: 3 },
})

export const descriptors = Object.freeze([
  descriptor('snapshot', 47, [], snapshotResult),
  descriptor('occurrences', 66, [rangeParameter], occurrencesResult),
  descriptor('importIcs', 82, [importParameter], importResult),
  descriptor('exportIcs', 94, [exportParameter], exportResult),
  descriptor('deleteEvent', 123, [deleteEventParameter], removalResult),
  descriptor('applyOverride', 133, [overrideParameter], eventResult),
  descriptor('removeOverride', 142, [removeOverrideParameter], eventResult),
  descriptor('cancelOccurrence', 151, [cancelParameter], eventResult),
  descriptor('restoreOccurrence', 160, [restoreParameter], eventResult),
  descriptor('putEvent', 114, [eventParameter], eventResult),
])

// The one descriptor list both faces of the calendar remote surface publish.
//
// The host manifest (`lib/typert.host.js`) and the client mount
// (`lib/typert.remote-client.js`) have to declare the same methods, the same
// argument names and the same schemas; building both from this list is what makes
// that true by construction instead of by review. `sourceLocation` points at the
// method that implements the descriptor in `lib/index.js`.
import {
  applySourceParameter,
  applySourceResult,
  cancelParameter,
  deleteEventParameter,
  eventParameter,
  eventResult,
  exportParameter,
  exportResult,
  importParameter,
  importResult,
  noteResult,
  notesParameter,
  notesResult,
  occurrencesResult,
  overrideParameter,
  putNoteParameter,
  rangeParameter,
  removalResult,
  removeNoteParameter,
  removeOverrideParameter,
  restoreParameter,
  snapshotResult,
  unlinkedNotesParameter,
  unlinkedNotesResult,
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
  descriptor('snapshot', 53, [], snapshotResult),
  descriptor('occurrences', 72, [rangeParameter], occurrencesResult),
  descriptor('importIcs', 94, [importParameter], importResult),
  descriptor('exportIcs', 110, [exportParameter], exportResult),
  descriptor('putEvent', 133, [eventParameter], eventResult),
  descriptor('deleteEvent', 142, [deleteEventParameter], removalResult),
  descriptor('applyOverride', 152, [overrideParameter], eventResult),
  descriptor('removeOverride', 161, [removeOverrideParameter], eventResult),
  descriptor('cancelOccurrence', 170, [cancelParameter], eventResult),
  descriptor('restoreOccurrence', 179, [restoreParameter], eventResult),
  descriptor('applySource', 214, [applySourceParameter], applySourceResult),
  descriptor('putNote', 227, [putNoteParameter], noteResult),
  descriptor('removeNote', 241, [removeNoteParameter], removalResult),
  descriptor('notes', 250, [notesParameter], notesResult),
  descriptor('unlinkedNotes', 270, [unlinkedNotesParameter], unlinkedNotesResult),
])

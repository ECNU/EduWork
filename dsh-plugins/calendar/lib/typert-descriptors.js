// The one descriptor list both faces of the calendar remote surface publish.
//
// The host manifest (`lib/typert.host.js`) and the client mount
// (`lib/typert.remote-client.js`) have to declare the same methods, the same
// argument names and the same schemas; building both from this list is what makes
// that true by construction instead of by review. `sourceLocation` points at the
// method that implements the descriptor in `lib/index.js`.
import {
  changeResult,
  sourceStatusesResult,
  personalParameter,
  personalReadParameter,
  personalReadResult,
  personalResult,
  applySourceParameter,
  applySourceResult,
  cancelParameter,
  deleteEventParameter,
  deleteCalendarParameter,
  deleteCalendarResult,
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
  descriptor('snapshot', 104, [], snapshotResult),
  descriptor('occurrences', 126, [rangeParameter], occurrencesResult),
  descriptor('importIcs', 151, [importParameter], importResult),
  descriptor('exportIcs', 170, [exportParameter], exportResult),
  descriptor('putEvent', 193, [eventParameter], eventResult),
  descriptor('deleteEvent', 214, [deleteEventParameter], removalResult),
  descriptor('deleteCalendar', 219, [deleteCalendarParameter], deleteCalendarResult),
  descriptor('applyOverride', 232, [overrideParameter], eventResult),
  descriptor('removeOverride', 241, [removeOverrideParameter], eventResult),
  descriptor('cancelOccurrence', 250, [cancelParameter], eventResult),
  descriptor('restoreOccurrence', 259, [restoreParameter], eventResult),
  descriptor('applySource', 321, [applySourceParameter], applySourceResult),
  descriptor('putNote', 364, [putNoteParameter], noteResult),
  descriptor('removeNote', 378, [removeNoteParameter], removalResult),
  descriptor('notes', 387, [notesParameter], notesResult),
  Object.freeze({ ...descriptor('changes', 287, [], changeResult), mode: 'stream', cancellation: { parameter: 'signal' } }),
  descriptor('personalFor', 340, [personalReadParameter], personalReadResult),
  descriptor('sourceStatuses', 81, [], sourceStatusesResult),
  descriptor('setPersonal', 334, [personalParameter], personalResult),
  descriptor('unlinkedNotes', 407, [unlinkedNotesParameter], unlinkedNotesResult),
])

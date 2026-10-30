// The one descriptor list both faces of the calendar remote surface publish.
//
// The host manifest (`lib/typert.host.js`) and the client mount
// (`lib/typert.remote-client.js`) have to declare the same methods, the same
// argument names and the same schemas; building both from this list is what makes
// that true by construction instead of by review. `sourceLocation` points at the
// method that implements the descriptor in `lib/index.js`.
import {
  changeResult,
  remindersResult,
  ackReminderParameter,
  ackReminderResult,
  sourceStatusesResult,
  annotationsRangeParameter,
  annotationsResult,
  annotationSelectionParameter,
  annotationChoicesResult,
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
  updateEventParameter,
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
  descriptor('snapshot', 136, [], snapshotResult),
  descriptor('occurrences', 158, [rangeParameter], occurrencesResult),
  descriptor('importIcs', 183, [importParameter], importResult),
  descriptor('exportIcs', 202, [exportParameter], exportResult),
  descriptor('putEvent', 225, [eventParameter], eventResult),
  descriptor('updateEvent', 242, [updateEventParameter], eventResult),
  descriptor('deleteEvent', 262, [deleteEventParameter], removalResult),
  descriptor('deleteCalendar', 267, [deleteCalendarParameter], deleteCalendarResult),
  descriptor('applyOverride', 280, [overrideParameter], eventResult),
  descriptor('removeOverride', 289, [removeOverrideParameter], eventResult),
  descriptor('cancelOccurrence', 298, [cancelParameter], eventResult),
  descriptor('restoreOccurrence', 307, [restoreParameter], eventResult),
  descriptor('applySource', 369, [applySourceParameter], applySourceResult),
  descriptor('putNote', 425, [putNoteParameter], noteResult),
  descriptor('removeNote', 439, [removeNoteParameter], removalResult),
  descriptor('notes', 448, [notesParameter], notesResult),
  Object.freeze({ ...descriptor('changes', 335, [], changeResult), mode: 'stream', cancellation: { parameter: 'signal' } }),
  descriptor('personalFor', 401, [personalReadParameter], personalReadResult),
  descriptor('sourceStatuses', 85, [], sourceStatusesResult),
  descriptor('annotationsFor', 91, [annotationsRangeParameter], annotationsResult),
  descriptor('annotationChoices', 93, [], annotationChoicesResult),
  descriptor('selectAnnotations', 95, [annotationSelectionParameter], annotationChoicesResult),
  descriptor('setPersonal', 395, [personalParameter], personalResult),
  descriptor('unlinkedNotes', 468, [unlinkedNotesParameter], unlinkedNotesResult),
  descriptor('reminders', 131, [], remindersResult),
  descriptor('ackReminder', 133, [ackReminderParameter], ackReminderResult),
])

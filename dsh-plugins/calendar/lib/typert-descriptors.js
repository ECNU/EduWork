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
  descriptor('snapshot', 137, [], snapshotResult),
  descriptor('occurrences', 159, [rangeParameter], occurrencesResult),
  descriptor('importIcs', 184, [importParameter], importResult),
  descriptor('exportIcs', 203, [exportParameter], exportResult),
  descriptor('putEvent', 235, [eventParameter], eventResult),
  descriptor('updateEvent', 252, [updateEventParameter], eventResult),
  descriptor('deleteEvent', 279, [deleteEventParameter], removalResult),
  descriptor('deleteCalendar', 284, [deleteCalendarParameter], deleteCalendarResult),
  descriptor('applyOverride', 297, [overrideParameter], eventResult),
  descriptor('removeOverride', 306, [removeOverrideParameter], eventResult),
  descriptor('cancelOccurrence', 315, [cancelParameter], eventResult),
  descriptor('restoreOccurrence', 324, [restoreParameter], eventResult),
  descriptor('applySource', 386, [applySourceParameter], applySourceResult),
  descriptor('putNote', 442, [putNoteParameter], noteResult),
  descriptor('removeNote', 456, [removeNoteParameter], removalResult),
  descriptor('notes', 465, [notesParameter], notesResult),
  Object.freeze({ ...descriptor('changes', 352, [], changeResult), mode: 'stream', cancellation: { parameter: 'signal' } }),
  descriptor('personalFor', 418, [personalReadParameter], personalReadResult),
  descriptor('sourceStatuses', 86, [], sourceStatusesResult),
  descriptor('annotationsFor', 92, [annotationsRangeParameter], annotationsResult),
  descriptor('annotationChoices', 94, [], annotationChoicesResult),
  descriptor('selectAnnotations', 96, [annotationSelectionParameter], annotationChoicesResult),
  descriptor('setPersonal', 412, [personalParameter], personalResult),
  descriptor('unlinkedNotes', 485, [unlinkedNotesParameter], unlinkedNotesResult),
  descriptor('reminders', 132, [], remindersResult),
  descriptor('ackReminder', 134, [ackReminderParameter], ackReminderResult),
])

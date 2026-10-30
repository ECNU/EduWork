// The ICS adapter: the first format behind the subscription plugin's adapter
// seam. It borrows the calendar package's reader so subscriptions and manual
// imports parse exactly the same text, then projects what was read onto the
// source-event contract the registered-source seam accepts.
//
// Anything the contract cannot carry is reported, never dropped silently: a
// feed that could only partly be read is applied as a partial snapshot (no
// removals), and structures without a source-event equivalent are listed in
// `degraded` so a person can see what the calendar is not showing. One-off
// moves (`RECURRENCE-ID`) are carried these days, so a reschedule is no longer
// degradation — the list stays for whatever a future format cannot express.
import { parseIcs } from '@eduwork/dsh-calendar/ics'

const CARRIED_FIELDS = ['end', 'location', 'description', 'recurrence']

export const icsAdapter = {
  /** @param response - A fetched feed response; its body is the ICS text. */
  async read(response) {
    return this.parse(await response.text())
  },

  /**
   * @param text - ICS text as a feed serves it.
   * @returns `{ events, skipped, degraded }` in the registered-source shape.
   */
  parse(text) {
    const parsed = parseIcs(text, { source: 'subscription' })
    const events = []
    const skipped = [...parsed.skipped]
    const degraded = [...parsed.degraded]
    for (const record of parsed.events) {
      const event = { uid: record.uid, title: record.title, start: record.start }
      for (const field of CARRIED_FIELDS) if (record[field] !== undefined) event[field] = record[field]
      if (record.exceptions?.length) event.cancelledDates = [...record.exceptions]
      // A moved occurrence travels with its series as an override, the same
      // statement the stored record keeps — so a rescheduled class shows at its
      // new time instead of the series' regular one. An override that changed
      // nothing (the reader kept only the date) says nothing and is left out.
      const overrides = (record.overrides ?? []).filter(entry => Object.keys(entry).length > 1)
      if (overrides.length) event.overrides = overrides
      events.push(event)
    }
    return { events, skipped, degraded }
  },
}

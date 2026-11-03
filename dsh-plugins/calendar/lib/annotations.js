// Calendar annotations: the week labels and range bands a data plugin supplies
// for the panel to draw around the events. Teaching weeks, examination phases
// and school breaks are the first users, but nothing here knows them: a
// provider speaks in local dates and short texts, and the calendar stays a
// generic calendar.
//
// The registry is deliberately forgiving. Annotations are decoration, never
// data: a provider whose answer throws, or whose entries do not match the
// contract, is dropped for that read while the others still show, and the panel
// renders nothing rather than something broken. A provider that wants its
// content gone disposes its handle, like a data source does.
import { z } from 'zod'

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

const tone = z.enum(['neutral', 'highlight', 'quiet'])

export const weekAnnotationSchema = z.object({
  /** First day (a Monday for a Monday-first grid) of the week the text names. */
  firstDay: localDate,
  text: z.string().min(1).max(32),
  tone: tone.optional(),
}).strict()

export const spanDecorationSchema = z.object({
  firstDay: localDate,
  lastDay: localDate,
  text: z.string().min(1).max(32),
  tone: tone.optional(),
}).strict()

const annotationSet = z.object({
  weeks: z.array(weekAnnotationSchema).max(64),
  spans: z.array(spanDecorationSchema).max(64),
}).strict()

export class AnnotationRegistry {
  /** @param changed - Called when the visible set changes, so views re-read. */
  constructor(changed = () => {}) {
    this.providers = new Map()
    this.selections = new Map()
    this.changed = changed
  }

  choices() {
    return [...this.providers.values()].filter(provider => provider.selectionGroup).map(provider => ({
      id: provider.id, label: provider.label ?? provider.id, group: provider.selectionGroup,
      selected: this.selected(provider.selectionGroup) === provider.id,
    }))
  }

  selected(group) {
    if (this.selections.has(group)) return this.selections.get(group)
    return [...this.providers.values()].find(provider => provider.selectionGroup === group)?.id ?? null
  }

  select(group, id) {
    if (id !== null && this.providers.get(id)?.selectionGroup !== group) throw new Error('unknown annotation provider')
    this.selections.set(group, id)
    this.changed()
  }

  /** Register one provider: `{ id, annotationsFor(range) }`. Returns its handle. */
  register(provider) {
    if (!provider || typeof provider !== 'object') throw new Error('an annotation provider must be an object')
    if (typeof provider.id !== 'string' || !provider.id) throw new Error('an annotation provider needs a stable id')
    if (typeof provider.annotationsFor !== 'function') throw new Error(`annotation provider ${provider.id} needs annotationsFor(range)`)
    if (this.providers.has(provider.id)) throw new Error(`annotation provider is already registered: ${provider.id}`)
    this.providers.set(provider.id, provider)
    this.changed()
    return Object.freeze({ invalidate: () => {
      if (this.providers.get(provider.id) === provider) this.changed()
    }, dispose: () => {
      if (this.providers.get(provider.id) !== provider) return
      this.providers.delete(provider.id)
      this.changed()
    } })
  }

  /**
   * Merge every provider's answer for one range; invalid answers are dropped.
   *
   * Answers are collected per provider and merged in registration order, and
   * the sort is stable — so two providers naming the same week keep their
   * registration order and views take the first, the documented priority when
   * answers overlap, however long each answer took to arrive. A provider that
   * never answers does not hang the read: the annotation contract is
   * decoration, so a slow answer is worth nothing.
   */
  async annotationsFor(range = {}) {
    const visible = [...this.providers.values()].filter(provider => !provider.selectionGroup || this.selected(provider.selectionGroup) === provider.id)
    const answers = await Promise.all(visible.map(async provider => {
      let answer
      try {
        answer = await withDeadline(provider.annotationsFor(range))
      } catch {
        return null
      }
      const parsed = annotationSet.safeParse(answer)
      return parsed.success ? parsed.data : null
    }))
    const weeks = []
    const spans = []
    for (const data of answers) {
      if (!data) continue
      weeks.push(...data.weeks)
      spans.push(...data.spans)
    }
    weeks.sort((left, right) => left.firstDay < right.firstDay ? -1 : left.firstDay > right.firstDay ? 1 : 0)
    spans.sort((left, right) => left.firstDay < right.firstDay ? -1 : left.firstDay > right.firstDay ? 1 : 0)
    return { weeks, spans }
  }
}

/** How long one provider may take before its answer is worth nothing. */
const PROVIDER_DEADLINE_MS = 3_000

function withDeadline(answer) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('annotation provider timed out')), PROVIDER_DEADLINE_MS)
    Promise.resolve(answer).then(value => {
      clearTimeout(timer)
      resolve(value)
    }, error => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

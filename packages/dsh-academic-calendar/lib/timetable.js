import { createHash } from 'node:crypto'
import { z } from 'zod'

const text = z.string().trim().min(1)
const time = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).refine(value => {
  const parsed = new Date(value + ':00Z')
  return !Number.isNaN(+parsed) && parsed.toISOString().slice(0, 16) === value
}, 'invalid local date/time')
const meeting = z.object({ id: text.optional(), start: time, end: time, teacher: z.string().optional(), campus: z.string().optional(), room: z.string().optional() }).strict()
  .refine(value => value.end > value.start, 'meeting end must follow start')
export const timetableSchema = z.object({
  schemaVersion: z.literal(1).default(1), term: text, timeZone: text,
  courses: z.array(z.object({ teachingClassCode: text, title: text, meetings: z.array(meeting).max(2000) }).strict()).max(200),
}).strict().superRefine((value, ctx) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }) } catch { ctx.addIssue({ code: 'custom', message: 'invalid time zone' }) }
  const codes = new Set()
  for (const course of value.courses) {
    if (codes.has(course.teachingClassCode)) ctx.addIssue({ code: 'custom', message: 'duplicate teachingClassCode' })
    codes.add(course.teachingClassCode)
    const ids = new Set()
    for (const item of course.meetings) {
      const id = item.id ?? `${item.start}/${item.end}`
      if (ids.has(id)) ctx.addIssue({ code: 'custom', message: 'duplicate meeting identity' })
      ids.add(id)
    }
  }
})

export function timetableEvents(input, institution) {
  const dataset = timetableSchema.parse(input)
  return dataset.courses.flatMap(course => course.meetings.map(item => {
    const identity = [institution, dataset.term, course.teachingClassCode, item.id ?? [item.start, item.end]]
    return {
      uid: `class:${createHash('sha256').update(JSON.stringify(identity)).digest('base64url')}`,
      title: course.title, start: item.start, end: item.end,
      location: [item.campus, item.room].filter(Boolean).join(' '),
      description: [`教学班：${course.teachingClassCode}`, item.teacher ? `教师：${item.teacher}` : '', `时区：${dataset.timeZone}`].filter(Boolean).join('\n'),
      extensions: { 'eduwork.academic': { institution, term: dataset.term, teachingClassCode: course.teachingClassCode, timeZone: dataset.timeZone, ...(item.id ? { meetingId: item.id } : {}) } },
    }
  }))
}

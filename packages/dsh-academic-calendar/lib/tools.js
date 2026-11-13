import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-academic-calendar-tools'
export const inject = ['tools', 'academicCalendar', 'permissionPresets']
const output = { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.result }] }
const reply = value => ({ result: JSON.stringify(value) })

export function apply(ctx) {
  ctx.on('tools/pre-execute', (exec, next) => {
    if (exec.name !== 'academic_import_timetable') return next()
    if (!exec.agent) return { kind: 'deny', reason: '课表导入需要关联会话' }
    if (ctx.permissionPresets.current(exec.agent.session) === 'danger-full-access') return next()
    return { kind: 'ask', reason: '导入完整课表快照，替换该学校、账号和学期的课程安排；个人内容保留' }
  })
  ctx.tools.register(defineTool({ name: 'academic_calendar_query',
    description: 'Query a selected or specified academic calendar for dates, terms, teaching week numbers, odd/even weeks, examinations and breaks. Holidays do not rewrite courses. Maximum 366 days.',
    parameters: { id: { type: 'string', description: 'Calendar ID; omit to use the manually selected calendar.' }, from: { type: 'string', required: true, description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'Inclusive end; defaults to from.' } },
    output, execute: args => reply(ctx.academicCalendar.query(args)),
    presentCall: () => ({ card: 'generic', title: '校历查询', kind: 'read' }),
  }))
  ctx.tools.register(defineTool({ name: 'academic_courses', description: 'Read teaching classes and complete concrete meeting lists retained by the education plugin. Use calendar occurrence tools for personal notes and reminders.',
    parameters: { institution: { type: 'string' }, account: { type: 'string' }, term: { type: 'string' } },
    output, execute: args => reply(ctx.academicCalendar.courses(args)),
    presentCall: () => ({ card: 'generic', title: '课程查询', kind: 'read' }),
  }))
  ctx.tools.register(defineTool({ name: 'academic_import_timetable', description: 'Import a complete structured timetable. Parse the user-provided document into teaching classes with all concrete meetings, show it for confirmation, then import. Do not infer class reschedules from legal holidays or invent meeting IDs. An empty courses list explicitly clears this timetable.',
    parameters: { institution: { type: 'string', required: true }, account: { type: 'string', required: true }, data: { type: 'string', required: true, description: 'JSON: {schemaVersion:1,term,timeZone,courses:[{teachingClassCode,title,meetings:[{id?,start,end,teacher?,campus?,room?}]}]}; local start/end YYYY-MM-DDTHH:mm.' } },
    output, execute: async args => reply(await ctx.academicCalendar.importTimetable({ institution: args.institution, account: args.account, dataset: JSON.parse(args.data) })),
    presentCall: () => ({ card: 'generic', title: '导入课表', kind: 'write' }),
  }))
}

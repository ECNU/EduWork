import { z } from 'zod'

const skillSummarySchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  source: z.literal('personal'),
}).strict()

export const skillSummaryResult = Object.freeze({
  mode: 'strict',
  typeSymbol: '@chatecnu-work/dsh-skill-manager-native#SkillSummary',
  schema: skillSummarySchema,
})

export const skillListResult = Object.freeze({
  mode: 'strict',
  typeSymbol: '@chatecnu-work/dsh-skill-manager-native#SkillList',
  schema: z.object({ skills: z.array(skillSummarySchema) }).strict(),
})

export function jsonParameter(name, schema, typeSymbol) {
  return Object.freeze({
    name, wire: name, source: 'json',
    codec: Object.freeze({ mode: 'strict', typeSymbol, schema }),
  })
}

export const createInputSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  instructions: z.string().min(1).max(262144),
}).strict()

export const sourcePathSchema = z.string().min(1).max(4096)
export const skillNameSchema = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)

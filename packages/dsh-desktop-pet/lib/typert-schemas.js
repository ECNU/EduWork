import { z } from 'zod'

const pkg = '@eduwork/dsh-desktop-pet'
const codec = (name, schema) => ({ mode: 'strict', create() { return this.schema }, typeSymbol: `${pkg}#${name}`, schema })
const localized = z.object({ 'zh-CN': z.string().max(200).optional(), en: z.string().max(200).optional() }).strict()
const crop = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict()
const skin = z.object({
  id: z.string().max(64), name: localized, author: z.string().max(80).optional(),
  preview: z.object({ src: z.string().max(8 * 1024 * 1024), crop: crop.nullable() }).strict(),
}).strict()
export const descriptors = [
  ['status', [], codec('PetStatus', z.object({ supported: z.boolean(), skins: z.array(skin).max(64) }).strict())],
  ['resetPosition', [], codec('PetReset', z.object({ supported: z.boolean() }).strict())],
].map(([method, parameters, result]) => ({ id: `${pkg}#desktopPet/${method}`, service: 'desktopPet', namespace: 'desktopPet', method,
  invocation: { kind: 'direct' }, parameters, result, sourceLocation: { file: 'lib/index.js', line: 1, column: 1 } }))

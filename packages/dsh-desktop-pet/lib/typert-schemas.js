import { z } from 'zod'
import { LIMITS, MOTIONS, SKIN_ID } from './skin.js'

const pkg = '@eduwork/dsh-desktop-pet'
const codec = (name, schema) => ({ mode: 'strict', create() { return this.schema }, typeSymbol: `${pkg}#${name}`, schema })
const localized = z.object({ 'zh-CN': z.string().max(200).optional(), en: z.string().max(200).optional() }).strict()
const crop = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict()
const actionName = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u)
const skinId = z.string().regex(SKIN_ID)
const parameter = (name, schema) => ({ name, wire: name, source: 'json', codec: codec(name, schema) })
const skin = z.object({
  id: skinId, name: localized, author: z.string().max(80).optional(),
  preview: z.object({ src: z.string().max(8 * 1024 * 1024), crop: crop.nullable() }).strict(),
}).strict()
const catalogSkin = skin.extend({
  license: z.string().max(64).optional(),
  states: z.object({ idle: z.array(actionName).max(8), working: z.array(actionName).max(8) }).strict(),
  actions: z.array(actionName).max(LIMITS.animations),
})
const file = z.string().max(69)
const actionPreview = z.object({
  frame: z.object({ width: z.number(), height: z.number() }).strict(),
  badge: z.tuple([z.number(), z.number()]),
  pixelated: z.boolean(),
  animation: z.object({
    frames: z.array(z.object({ file, crop: crop.optional(), ms: z.number() }).strict()).min(1).max(LIMITS.frames),
    playback: z.enum(['loop', 'once', 'pingpong', 'blink']),
    repeat: z.number().optional(), motion: z.enum(MOTIONS).optional(), facing: z.enum(['left', 'right']).optional(),
  }).strict(),
  images: z.array(z.object({ file, src: z.string().max(32 + Math.ceil(LIMITS.packageBytes / 3) * 4) }).strict()).max(LIMITS.frames),
}).strict()
export const descriptors = [
  ['status', [], codec('PetStatus', z.object({ supported: z.boolean(), skins: z.array(skin).max(64) }).strict())],
  ['catalog', [], codec('PetCatalog', z.object({ supported: z.boolean(), skins: z.array(catalogSkin).max(64) }).strict())],
  ['previewAction', [parameter('skinId', skinId), parameter('action', actionName)], codec('PetActionPreview', actionPreview)],
  ['resetPosition', [], codec('PetReset', z.object({ supported: z.boolean() }).strict())],
].map(([method, parameters, result]) => ({ id: `${pkg}#desktopPet/${method}`, service: 'desktopPet', namespace: 'desktopPet', method,
  invocation: { kind: 'direct' }, parameters, result, sourceLocation: { file: 'lib/index.js', line: 1, column: 1 } }))

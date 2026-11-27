// Remote definition shared by the Host service and the browser client.
import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'

const pkg = '@eduwork/dsh-message-edit'
const strict = (typeSymbol, schema) => ({ mode: 'strict', typeSymbol, create: () => schema })
const parameter = (name, typeSymbol, schema) => ({
  name, wire: name, source: 'json', codec: strict(typeSymbol, schema), strictCodec: strict(typeSymbol, schema),
})

// A stored reference belongs to DSH: check the fields this method reads and
// pass the rest through to the attachment store as they are.
const file = z.looseObject({ attachmentId: z.string(), name: z.string() })
const image = z.looseObject({ attachmentId: z.string(), mediaType: z.string(), name: z.string().optional() })
const attachment = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file'), attachment: file }),
  z.object({ type: z.literal('image'), attachment: image }),
])

export const REMOTE = createTypertRemoteInfo({
  package: pkg,
  methods: {
    'eduworkMessageEdit/stageAttachments': {
      service: 'eduworkMessageEdit',
      description: 'Stage attachments of a Session as upload receipts of a branch forked from it.',
      invocation: { kind: 'direct' },
      parameters: [
        parameter('sourceSessionId', `${pkg}#SessionId`, z.string().min(1)),
        parameter('sessionId', `${pkg}#SessionId`, z.string().min(1)),
        parameter('attachments', `${pkg}#MessageAttachments`, z.array(attachment)),
      ],
      result: strict(`${pkg}#ReceiptIds`, z.array(z.string())),
      sourceLocation: { file: 'src/index.js', line: 1, column: 1 },
    },
  },
}, z)

export default REMOTE

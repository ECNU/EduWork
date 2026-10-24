import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Generic decoration seam only: the optional plugin owns protocol and UI.
// Apply to copied, pinned Runtime bytes; retire when upstream offers this seat.
export const chatUserContentPatch = Object.freeze({
  id: 'chat-user-content-decoration-v1', package: '@deepseek-ai/dsh-client-ui-chat',
  version: '0.2.1-rc.3', file: 'lib/client.js',
  beforeSHA256: 'a00e5176d1257d51604cefbe9a15d326d4283439df31f76ba20ff690c76e10a1',
})
const sha256 = value => createHash('sha256').update(value).digest('hex')
export function patchChatUserContentSource(input) {
  if (sha256(input) !== chatUserContentPatch.beforeSHA256) throw new Error('Chat user content changed; review or retire the decoration adapter')
  let source = input.toString('utf8')
  const anchor = 'function UserContent({ content, loadImage, facts, interactive = false, ellipsis = false, renderSlot, renderFactorySlot, t }) {'
  const children = 'children: { "conversation.chat.user.images": {'
  if (source.split(anchor).length !== 2 || source.split(children).length !== 2) throw new Error('Chat user content anchors changed')
  source = source.replace(anchor, `function UserContent(props) {
    const renderContent = (content = props.content) => (0, react_jsx_runtime.jsx)(UserContentBody, { ...props, content });
    return props.renderSlot("conversation.chat.user.decorate", { content: props.content, renderContent }, { fallback: renderContent() });
  }
  ${anchor.replace('UserContent(', 'UserContentBody(')}`)
  return source.replace(children, 'children: { "conversation.chat.user.decorate": { kind: "single", scope: "session" }, "conversation.chat.user.images": {')
}
export async function patchChatUserContentRuntime(modules, { version = chatUserContentPatch.version } = {}) {
  // rc.2 and rc.3 ship identical reviewed client bytes. The private side-chat
  // experiment selects rc.2 explicitly; ordinary product assembly uses rc.3.
  if (!['0.2.1-rc.2', '0.2.1-rc.3'].includes(version)) throw new Error('Chat decoration requires a newly qualified Runtime')
  const root = join(modules, chatUserContentPatch.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== chatUserContentPatch.package || manifest.version !== version) throw new Error('Chat decoration requires a newly qualified Runtime')
  const path = join(root, chatUserContentPatch.file)
  const output = patchChatUserContentSource(await readFile(path))
  await writeFile(path, output)
  return { ...chatUserContentPatch, version, afterSHA256: sha256(output) }
}

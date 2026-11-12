import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Generic decoration seam only: the optional plugin owns protocol and UI.
// Apply to copied, pinned Runtime bytes; retire when upstream offers this seat.
export const chatUserContentPatch = Object.freeze({
  id: 'chat-user-content-decoration-v1', package: '@deepseek-ai/dsh-client-ui-chat',
  version: '0.2.2-rc.2', file: 'lib/client.js',
  beforeSHA256: 'eef53e82b8cd584d2f0e543a4a93395f9d90df3bba1218891bd99d07d788de5c',
})
const sha256 = value => createHash('sha256').update(value).digest('hex')
const reviewedHashes = new Map([
  ['0.2.1-rc.2', 'a00e5176d1257d51604cefbe9a15d326d4283439df31f76ba20ff690c76e10a1'],
  ['0.2.1-rc.3', 'a00e5176d1257d51604cefbe9a15d326d4283439df31f76ba20ff690c76e10a1'],
  ['0.2.1-rc.5', '181f766f2fe12ad27eed4f1c0cd4609e8d2211d397890355eb476b6a9ee311c2'],
  ['0.2.2-rc.1', 'b7e645f2461231e8ece31381f026db2df72d058e425eaef19265f215c823d84e'],
  [chatUserContentPatch.version, chatUserContentPatch.beforeSHA256],
])
export function patchChatUserContentSource(input, { version = chatUserContentPatch.version } = {}) {
  if (sha256(input) !== reviewedHashes.get(version)) throw new Error('Chat user content changed; review or retire the decoration adapter')
  let source = input.toString('utf8')
  const compact = version === '0.2.2-rc.2'
  const anchor = compact
    ? 'function UserContent({content,loadImage,facts,interactive=false,ellipsis=false,renderSlot,renderFactorySlot,t}){'
    : 'function UserContent({ content, loadImage, facts, interactive = false, ellipsis = false, renderSlot, renderFactorySlot, t }) {'
  const children = compact ? 'children:{"conversation.chat.user.images":{' : 'children: { "conversation.chat.user.images": {'
  if (source.split(anchor).length !== 2 || source.split(children).length !== 2) throw new Error('Chat user content anchors changed')
  source = source.replace(anchor, `function UserContent(props) {
    const renderContent = (content = props.content) => (0, react_jsx_runtime.jsx)(UserContentBody, { ...props, content });
    return props.renderSlot("conversation.chat.user.decorate", { content: props.content, renderContent }, { fallback: renderContent() });
  }
  ${anchor.replace('UserContent(', 'UserContentBody(')}`)
  return source.replace(children, 'children: { "conversation.chat.user.decorate": { kind: "single", scope: "session" }, "conversation.chat.user.images": {')
}
export async function patchChatUserContentRuntime(modules, { version = chatUserContentPatch.version } = {}) {
  // Earlier reviewed builds remain explicit opt-ins; each keeps its own full hash.
  // rc.1 adds text gestures inside UserContent; the wrapper preserves those and
  // the official text/attachment renderers while the plugin owns its projection.
  if (!reviewedHashes.has(version)) throw new Error('Chat decoration requires a newly qualified Runtime')
  const root = join(modules, chatUserContentPatch.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== chatUserContentPatch.package || manifest.version !== version) throw new Error('Chat decoration requires a newly qualified Runtime')
  const path = join(root, chatUserContentPatch.file)
  const output = patchChatUserContentSource(await readFile(path), { version })
  await writeFile(path, output)
  return { ...chatUserContentPatch, version, beforeSHA256: reviewedHashes.get(version), afterSHA256: sha256(output) }
}

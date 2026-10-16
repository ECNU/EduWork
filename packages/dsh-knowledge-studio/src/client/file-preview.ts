import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

// Use the owning Studio tab's Session, never the globally selected Session.
// The official reader resolves and authorizes the original file on the Host.
export function openStudioFilePreview(sidebar: { openResource(address: string): unknown }, sessionId: string, path: string) {
  if (!sessionId || !path) throw new Error('A Session and a saved file are required for preview')
  return sidebar.openResource(sessionFileAddress(sessionId, path))
}

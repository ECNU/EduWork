import { revealNativePath } from '@deepseek-ai/dsh-native-command'

// Path authority is checked by the caller's Fs/session service. The official
// opener owns quoting, Explorer handoff, platform selection and cancellation.
export function revealInFileManager(target, signal, internals) {
  return revealNativePath(target, signal ?? new AbortController().signal, internals)
}

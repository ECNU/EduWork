import { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { revealInFileManager } from './reveal.js'

// Keep the official session RPCs, authorization, previews and default-app
// opener. Its documented native-opener constructor hook replaces only the
// Windows Explorer handoff, shared with the extended Office/media previews.
export default class DesktopSessionController extends SessionController {
  constructor(ctx, config) {
    super(ctx, config, process.platform === 'win32' ? { revealPath: revealInFileManager } : {})
  }
}

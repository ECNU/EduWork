import { Service } from '@deepseek-ai/cordis'
import { readBootstrap } from './bootstrap.js'

export const name = 'desktop-boundary'

export class DesktopBoundary extends Service {
  constructor(ctx) {
    super(ctx, 'desktopBoundary')
    this.ready = readBootstrap()
  }
}

export default DesktopBoundary

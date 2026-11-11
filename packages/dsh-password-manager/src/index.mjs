import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerPasswordTools } from './tools.mjs'

export const name = 'eduwork-password-manager'
export const inject = ['tools', 'desktopServices']
export function apply(ctx) { registerPasswordTools(ctx, defineTool) }

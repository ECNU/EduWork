import { createContext, useContext } from 'react'

export const NS = 'eduwork.studio'
export const dictionaries = {
  "zh": {
    "loading": "正在读取…",
    "noWorkspace": "当前会话不属于任何工作区。",
    "failed": "生成失败",
    "cancel": "取消任务",
    "openSource": "打开原文",
    "back": "返回",
    "close": "关闭 Studio",
    "working": "处理中",
    "error": "操作失败",
    "generate": "开始生成",
    "generating": "正在生成",
    "interruptedArtifact": "生成被中断",
    "askAI": "问问 AI",
    "evidence": "查看依据",
    "submitAnswer": "提交答案",
    "next": "下一个",
    "previous": "上一个",
    "correct": "回答正确",
    "incorrect": "回答错误",
    "flip": "翻到背面",
    "known": "已掌握",
    "review": "再复习",
    "reset": "重新开始",
    "workspaceSlow": "工作区服务响应较慢，基础创作仍可使用。",
    "workspaceUnavailable": "无法连接工作区服务，请重试。",
    "sidebarDescription": "从工作区资料创建成果"
  },
  "en": {
    "loading": "Loading…",
    "noWorkspace": "This session is not attached to a workspace.",
    "failed": "Generation failed",
    "cancel": "Cancel task",
    "openSource": "Open source",
    "back": "Back",
    "close": "Close Studio",
    "working": "Working",
    "error": "Operation failed",
    "generate": "Generate",
    "generating": "Generating",
    "interruptedArtifact": "Generation interrupted",
    "askAI": "Ask AI",
    "evidence": "View evidence",
    "submitAnswer": "Submit answer",
    "next": "Next",
    "previous": "Previous",
    "correct": "Correct",
    "incorrect": "Incorrect",
    "flip": "Show answer",
    "known": "Got it",
    "review": "Review again",
    "reset": "Start over",
    "workspaceSlow": "Workspace service is slow. Basic creation remains available.",
    "workspaceUnavailable": "Cannot connect to workspace service. Retry.",
    "sidebarDescription": "Create artifacts from workspace sources"
  }
}
type Translate = (key: string, values?: Record<string, unknown>) => string
export const StudioLocale = createContext<Translate | null>(null)
export function useStudioLocale(): Translate {
  const t = useContext(StudioLocale)
  if (!t) throw new Error('Studio locale is unavailable outside its registered surface')
  return t
}

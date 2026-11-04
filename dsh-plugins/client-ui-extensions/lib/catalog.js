// Product metadata only: no activation state, executable paths or credentials.
// Assembly admits an entry only after its published npm lock is available.
export const extensions = Object.freeze([
  { name: '@eduwork/dsh-external-agents', defaultEnabled: false,
    title: { zh: '外部智能体', en: 'External agents' },
    description: { zh: '连接本机 Codex、Cursor 或其他 ACP 智能体，在当前对话中委派任务。', en: 'Connect local Codex, Cursor or other ACP agents and delegate tasks from the current conversation.' },
    documentation: 'https://github.com/ECNU/EduWork/tree/main/packages/dsh-external-agents',
  },
])

/** 日程详情与整条日程编辑的界面外壳，保存和读取由日历面板负责。 */
import React, { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'

const h = React.createElement

interface OccurrenceSurfaceProps {
  title: string
  description?: string
  context?: string
  onClose: () => void
  tools?: React.ReactNode
  footer?: React.ReactNode
  children?: React.ReactNode
}

/** 复用宿主的遮罩与焦点管理，在同一弹窗内呈现查看和编辑。 */
export function OccurrenceSurface({ title, description, context, onClose, tools, footer, children }: OccurrenceSurfaceProps) {
  return h(Modal, { open: true, headless: true, onClose, title, className: 'cal-occurrence-window' },
    h('div', { className: 'cal-occurrence-toolbar' },
      h('span', null, context),
      h('div', null, tools,
        h(Button, { type: 'button', size: 'sm', variant: 'ghost', 'aria-label': '关闭', onClick: onClose }, '×'))),
    h('div', { className: 'cal-occurrence-content' },
      h('h2', null, title),
      description && h('p', { className: 'cal-occurrence-subtitle' }, description),
      children),
    footer && h('footer', { className: 'cal-occurrence-footer' }, footer))
}

interface EventEditorSurfaceProps {
  fields: React.ReactNode
  settings: React.ReactNode
  occurrences: React.ReactNode
  onBack: () => void
  title: string
  source: string
  backIcon?: React.ReactNode
  tools: React.ReactNode
  actions: React.ReactNode
  deletion: React.ReactNode
}

const sections = [
  { id: 'fields', label: '编辑' },
  { id: 'occurrences', label: '出现时间' },
  { id: 'settings', label: '个人设置' },
] as const

/** 分区切换保持表单挂载，返回后可继续当前草稿。 */
export function EventEditorSurface({ fields, settings, occurrences, onBack, title, source, backIcon, tools, actions, deletion }: EventEditorSurfaceProps) {
  const [section, setSection] = useState<typeof sections[number]['id']>('fields')
  return h('div', { className: 'cal-event-workspace' },
    h('header', { className: 'cal-workspace-toolbar' },
      h(Button, { size: 'sm', variant: 'ghost', icon: backIcon, onClick: onBack }, '返回'),
      h('span', { className: 'cal-workspace-source' }, source),
      h('div', { className: 'cal-workspace-tools' }, tools)),
    h('nav', { className: 'cal-workspace-nav', 'aria-label': '编辑日程分区' },
      ...sections.map(({ id, label }) => h('button', {
        key: id, type: 'button', 'aria-pressed': id === section, onClick: () => setSection(id),
      }, label))),
    h('div', { className: 'cal-workspace-scroll' },
      section !== 'fields' && h('h2', { className: 'cal-workspace-context' }, title),
      h('section', { 'aria-label': '日程信息', hidden: section !== 'fields' }, fields,
        h('div', { className: 'cal-workspace-actions' }, deletion, actions)),
      h('section', { 'aria-label': '出现的时间', hidden: section !== 'occurrences' }, occurrences),
      h('section', { 'aria-label': '个人设置', hidden: section !== 'settings' }, settings)))
}

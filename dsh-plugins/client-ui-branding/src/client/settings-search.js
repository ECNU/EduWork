import React, { useEffect, useRef, useState } from 'react'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { Input, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { searchSettings } from './settings-search-index.js'
const h = React.createElement

export function SettingsSearch({ ctx }) {
  const [query, setQuery] = useState(''), [active, setActive] = useState(0), [open, setOpen] = useState(false)
  const [, update] = useState(0), root = useRef(null)
  useEffect(() => {
    const changed = () => update(value => value + 1)
    const off = ctx.slots.subscribe('settings.section', changed), localeOff = ctx.locale.subscribe(changed)
    return () => { off(); localeOff() }
  }, [ctx])
  const zh = /^zh/i.test(document.documentElement.lang || navigator.language)
  const label = zh ? '搜索设置' : 'Search settings'
  const rows = ctx.slots.entries('settings.section').map(({ options }) => ({ id: options.id, label: resolveSlotLabel(options.label) || options.id, order: options.order }))
  const results = searchSettings(rows, query), selected = Math.max(0, Math.min(active, results.length - 1))
  const choose = row => {
    const owner = ctx.slots.entries('sidebar.settings').find(entry => entry.store)?.store.create()
    owner?.actions.select(row.id)
    setOpen(false)
  }
  return h('div', { ref: root, className: 'eduwork-settings-search', style: { position: 'relative', width: 'min(260px, 38vw)', minWidth: 100 },
    onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) } },
    h('style',null,'.eduwork-settings-search>span{display:flex;width:100%;box-sizing:border-box;height:28px;border-radius:8px;font-size:12px;line-height:18px}.eduwork-settings-search input{font-size:12px;line-height:18px}.eduwork-settings-search [role=option]:hover{background:var(--dsw-alias-interactive-bg-hover)!important}.eduwork-settings-search [role=option]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}'),
    h(Input, { type: 'search', icon: h(IconSearchOutlineRegular,{size:16}), role: 'combobox', 'aria-label': label, placeholder: label,
      'aria-expanded': open && !!query.trim(), 'aria-controls': 'eduwork-settings-results',
      'aria-activedescendant': open && results.length ? `eduwork-setting-${results[selected].id}` : undefined,
      value: query, onFocus: () => setOpen(true), onChange: event => { setQuery(event.target.value); setActive(0); setOpen(true) },
      onKeyDown: event => {
        if (event.key === 'Escape' && (open || query)) { event.preventDefault(); event.stopPropagation(); setQuery(''); setOpen(false) }
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(Math.min(selected + 1, results.length - 1)) }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(0, selected - 1)) }
        if (event.key === 'Enter' && open && results[selected]) { event.preventDefault(); choose(results[selected]) }
      } }),
    open && query.trim() && h('div', { id: 'eduwork-settings-results', role: 'listbox', 'aria-label': label,
      style: { position: 'absolute', zIndex: 20, right: 0, top: '100%', marginTop: 6, width: '100%', maxHeight: 300, overflowY: 'auto',
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: 6, boxSizing: 'border-box',
        background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', boxShadow: 'var(--dsw-elevation-prominent)', fontSize: 13, lineHeight:'20px' } },
      results.length ? results.map((row,index) => h('button', { key: row.id, id: `eduwork-setting-${row.id}`, role: 'option',
        'aria-selected': index === selected, type: 'button', onClick: () => choose(row),
        style: { display: 'block', width: '100%', padding: '9px 10px', border: 0, borderRadius: 6, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer',
          background: index === selected ? 'var(--dsw-alias-bg-module-platform, #eee)' : 'transparent' } }, row.label))
      : h('div', { role: 'status', style: { padding: 10 } }, zh ? '未找到设置，请尝试其他关键词' : 'No settings found. Try another keyword.')))
}

export function registerSettingsSearch(ctx) {
  return ctx.slots.inject('settings.action', () => ctx.slots.register({ name: 'settings.action', id: 'eduwork-settings-search', order: -100,
    inject: () => ({ ctx }) }, SettingsSearch))
}

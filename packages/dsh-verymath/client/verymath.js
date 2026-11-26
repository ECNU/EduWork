/**
 * VeryMath 的浏览器面板（左侧栏独立入口）。
 *
 * 为什么手写 CJS 而不接打包链：DSH 的客户端插件产物就是
 * `window.__ModuleLoader__.load({ id, factory })` 包一层 CJS 工厂，平台表已提供
 * react / react-dom / ui-primitives。本包没有 tsdown/vite，为一个面板引入构建链
 * 只会让"能不能跑"取决于构建环境。这里用 `React.createElement`，产物即源码。
 *
 * 入口机制（读宿主包源码确认，不是猜）：
 *   - `@deepseek-ai/dsh-client-ui-sidebar` 在 root 作用域声明 `sidebar.panellist`
 *     （kind: list）：注册 `{ id, order, label }` + 图标组件，左栏就多一行；
 *   - 点开时按**同一 id** 去 `@deepseek-ai/dsh-client-ui-layout` 的 `main`
 *     （kind: keyed，root 作用域）取组件，所以主面板注册必须带 `key: <同一 id>`。
 *
 * 面板只做「对话里做起来烦」的事，不做对话能一步完成的事：
 *   环境   —— 本机工具链就绪度 + 可复制的修复命令 + 可导出报告
 *   术语库 —— 可选可查可改可删（手改 JSON 的痛苦正是它存在的理由）
 *   论文图 —— 依赖图可点节点看陈述/度数/依赖关系
 *   技能   —— 随包 16 个技能与其说明
 *
 * 数据全部走宿主侧 `/api/verymath/*` 精确路由（`src/http.ts`），与工具共用同一份
 * 核心实现：面板改了术语库，对话里的 `verymath_glossary_query` 立刻看到。
 */
window.__ModuleLoader__.load({
  id: '@eduwork/dsh-verymath',
  factory: (platformRequire) => {
    const module = { exports: {} }
    const exports = module.exports
    const react = platformRequire('react')
    const h = react.createElement
    const useState = react.useState
    const useEffect = react.useEffect
    const useMemo = react.useMemo
    const useCallback = react.useCallback

    const PANEL_ID = 'verymath'

    // ------------------------------------------------------------ 取数

    async function request(path, init) {
      const response = await fetch(path, init)
      const text = await response.text()
      let body
      try {
        body = text.length > 0 ? JSON.parse(text) : {}
      } catch {
        throw new Error(`接口返回的不是 JSON（HTTP ${response.status}）：${text.slice(0, 120)}`)
      }
      if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    const api = (path) => request(path)
    const postJson = (path, payload) => request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        return false
      }
    }

    // ------------------------------------------------------------ 样式

    const S = {
      wrap: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: 13, color: 'var(--dsh-text-primary, #111)' },
      head: {
        display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
        borderBottom: '1px solid var(--dsh-border, rgba(120,120,120,.22))', flexShrink: 0,
      },
      title: { fontSize: 14, fontWeight: 600, letterSpacing: '.01em' },
      tabs: { display: 'flex', gap: 2, marginLeft: 'auto', background: 'var(--dsh-fill-secondary, rgba(120,120,120,.1))', padding: 3, borderRadius: 9 },
      tab: {
        border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12.5,
        padding: '5px 12px', borderRadius: 7, color: 'var(--dsh-text-secondary, #666)', transition: 'background .12s',
      },
      tabOn: { background: 'var(--dsh-surface, #fff)', color: 'var(--dsh-text-primary, #111)', fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,.12)' },
      body: { overflow: 'auto', padding: '16px 18px 28px', minHeight: 0, flex: 1 },
      toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
      btn: {
        border: '1px solid var(--dsh-border, rgba(120,120,120,.3))', background: 'transparent', cursor: 'pointer',
        fontSize: 12, padding: '4px 10px', borderRadius: 7, color: 'inherit',
      },
      btnPrimary: { border: '1px solid transparent', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12, padding: '5px 12px', borderRadius: 7 },
      btnDanger: { border: '1px solid rgba(220,38,38,.45)', background: 'transparent', color: '#dc2626', cursor: 'pointer', fontSize: 12, padding: '4px 9px', borderRadius: 7 },
      hint: { color: 'var(--dsh-text-tertiary, #888)', fontSize: 12, lineHeight: 1.7 },
      card: { border: '1px solid var(--dsh-border, rgba(120,120,120,.22))', borderRadius: 10, padding: '11px 13px', marginBottom: 9 },
      code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, color: 'var(--dsh-text-secondary, #666)' },
      select: { fontSize: 12, padding: '5px 8px', borderRadius: 7, maxWidth: 460, border: '1px solid var(--dsh-border, rgba(120,120,120,.3))', background: 'transparent', color: 'inherit' },
      input: { fontSize: 12.5, padding: '6px 9px', borderRadius: 7, boxSizing: 'border-box', border: '1px solid var(--dsh-border, rgba(120,120,120,.3))', background: 'transparent', color: 'inherit', outline: 'none' },
      stat: { display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 },
      statNum: { fontSize: 17, fontWeight: 650, lineHeight: 1.1 },
      statLabel: { ...{ color: 'var(--dsh-text-tertiary, #888)' }, fontSize: 11.5 },
      dot: (state) => ({ width: 8, height: 8, borderRadius: 4, flexShrink: 0, marginTop: 5, background: state === 'ready' ? '#16a34a' : state === 'partial' ? '#d97706' : '#dc2626' }),
    }

    function Loading(props) {
      return h('div', { style: { ...S.hint, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' } },
        h('span', {
          style: {
            width: 12, height: 12, borderRadius: 6, border: '1.5px solid rgba(120,120,120,.35)',
            borderTopColor: '#2563eb', animation: 'verymath-spin .7s linear infinite', display: 'inline-block',
          },
        }),
        props.label || '读取中…')
    }

    function Failure(props) {
      return h('div', { style: { ...S.card, borderColor: 'rgba(220,38,38,.45)', background: 'rgba(220,38,38,.06)' } },
        h('div', { style: { fontWeight: 600, marginBottom: 3 } }, '读不到数据'),
        h('div', { style: { ...S.hint, color: 'inherit' } }, props.message),
        props.onRetry ? h('button', { onClick: props.onRetry, style: { ...S.btn, marginTop: 8 } }, '重试') : null)
    }

    function Empty(props) {
      return h('div', { style: { padding: '22px 0', ...S.hint } }, props.children)
    }

    function useEndpoint(path) {
      const [state, setState] = useState({ status: 'loading', data: undefined, error: '', tick: 0 })
      const reload = useCallback(() => setState((prev) => ({ ...prev, tick: prev.tick + 1 })), [])
      useEffect(() => {
        if (path === undefined || path === null) return undefined
        let alive = true
        setState((prev) => ({ ...prev, status: 'loading' }))
        api(path)
          .then((data) => { if (alive) setState((prev) => ({ ...prev, status: 'ready', data, error: '' })) })
          .catch((error) => { if (alive) setState((prev) => ({ ...prev, status: 'failed', error: String(error && error.message ? error.message : error) })) })
        return () => { alive = false }
      }, [path, state.tick])
      return { ...state, reload }
    }

    // ---------------------------------------------------------- 环境页签

    const ENV_ORDER = ['python', 'pyyaml', 'latexmk', 'xelatex', 'osqp', 'sage', 'lean']

    function envReport(data) {
      const lines = [`# VeryMath 环境报告`, ``, `工作区：${data.workspace || '(未知)'}`, `就绪：${data.ready}/${data.total}`, ``]
      for (const row of data.rows || []) {
        lines.push(`- ${row.state === 'ready' ? '✅' : '❌'} ${row.label}${row.detail ? ` — ${row.detail}` : ''}`)
        if (row.state !== 'ready' && row.hint) lines.push(`  - 安装：${row.hint}`)
      }
      return lines.join('\n')
    }

    function EnvTab() {
      const { status, data, error, reload } = useEndpoint('/api/verymath/env')
      const [copied, setCopied] = useState('')
      const flash = useCallback((id) => { setCopied(id); setTimeout(() => setCopied(''), 1400) }, [])

      if (status === 'loading' && data === undefined) return h(Loading, { label: '正在探测本机工具链（实际执行 --version / import）…' })
      if (status === 'failed') return h(Failure, { message: error, onRetry: reload })

      const rows = (data.rows || []).slice().sort((left, right) => {
        const leftIndex = ENV_ORDER.indexOf(left.id)
        const rightIndex = ENV_ORDER.indexOf(right.id)
        return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex)
      })
      const ready = data.ready ?? 0
      const total = data.total ?? rows.length

      return h('div', null,
        h('div', { style: S.stat },
          h('div', null, h('div', { style: S.statNum }, `${ready}/${total}`), h('div', { style: S.statLabel }, '就绪')),
          h('div', null, h('div', { style: S.statNum }, String(total - ready)), h('div', { style: S.statLabel }, '缺失')),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'flex-start' } },
            h('button', { onClick: reload, style: S.btn }, '重新探测'),
            h('button', {
              onClick: async () => {
                const ok = await copyText(envReport(data))
                flash(ok ? 'report' : 'fail')
              },
              style: S.btn,
            }, copied === 'report' ? '已复制' : copied === 'fail' ? '复制失败' : '复制报告'),
          ),
        ),
        h('div', { style: { ...S.hint, marginBottom: 12 } }, `工作区：${data.workspace || '(未知)'}`),
        ...rows.map((row) => h('div', { key: row.id, style: { ...S.card, display: 'flex', gap: 10 } },
          h('div', { style: S.dot(row.state) }),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
              h('span', { style: { fontWeight: 600 } }, row.label),
              row.detail ? h('span', { style: S.code }, row.detail) : null,
              h('span', { style: { ...S.hint, marginLeft: 'auto' } }, row.state === 'ready' ? '可用' : '缺失'),
            ),
            h('div', { style: S.hint }, row.enables),
            row.hint
              ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 4 } },
                  h('code', { style: { ...S.code, color: '#b45309', flex: 1 } }, row.hint),
                  h('button', {
                    onClick: async () => { await copyText(row.hint); flash(row.id) },
                    style: { ...S.btn, padding: '2px 8px' },
                  }, copied === row.id ? '已复制' : '复制'),
                )
              : null,
          ),
        )),
      )
    }

    // -------------------------------------------------------- 术语库页签

    function Stat(props) {
      return h('div', null,
        h('div', { style: S.statNum }, String(props.value)),
        h('div', { style: S.statLabel }, props.label))
    }

    function TermEditor(props) {
      const draftFor = (term) => ({
        term_id: term ? term.term_id : undefined,
        en: term ? term.en : '',
        cn: term ? term.cn : '',
        pos: term && term.pos ? term.pos : '',
        field: term && term.field ? term.field.join(', ') : '',
        source: term && term.source ? term.source : '',
        exampleEn: term && term.examples && term.examples[0] ? term.examples[0].en : '',
        exampleCn: term && term.examples && term.examples[0] ? term.examples[0].cn : '',
      })
      const [draft, setDraft] = useState(() => draftFor(props.term))
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      // Reset the draft only when a *different* row is edited. Depending on the whole
      // `props.term` object reset the draft whenever a background refresh produced a
      // new object for the same term, silently discarding what the user had typed
      // (the list reloads after every save).
      const termId = props.term === undefined ? '' : props.term.term_id

      useEffect(() => { setDraft(draftFor(props.term)) }, [termId])

      const field = (key) => (event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))
      const input = (key, placeholder, extra) => h('input', {
        value: draft[key], onChange: field(key), placeholder, style: { ...S.input, ...(extra || {}) },
      })

      const save = async () => {
        setBusy(true); setError('')
        try {
          const payload = { en: draft.en.trim(), cn: draft.cn.trim() }
          if (draft.term_id) payload.term_id = draft.term_id
          if (draft.pos.trim()) payload.pos = draft.pos.trim()
          if (draft.field.trim()) payload.field = draft.field.split(',').map((part) => part.trim()).filter(Boolean)
          if (draft.source.trim()) payload.source = draft.source.trim()
          if (draft.exampleEn.trim() && draft.exampleCn.trim()) payload.example = { en: draft.exampleEn.trim(), cn: draft.exampleCn.trim() }
          await props.onSave(payload)
          props.onDone()
        } catch (cause) {
          setError(String(cause && cause.message ? cause.message : cause))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: { ...S.card, background: 'var(--dsh-fill-secondary, rgba(120,120,120,.06))' } },
        h('div', { style: { fontWeight: 600, marginBottom: 8 } },
          draft.term_id ? `编辑 ${draft.term_id}` : '新增术语'),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
          h('label', { style: S.hint }, '英文（en）', h('div', { style: { marginTop: 2 } }, input('en', 'manifold'))),
          h('label', { style: S.hint }, '中文（cn）', h('div', { style: { marginTop: 2 } }, input('cn', '流形'))),
          h('label', { style: S.hint }, '词性（可选）', h('div', { style: { marginTop: 2 } }, input('pos', '名词'))),
          h('label', { style: S.hint }, '子领域（逗号分隔）', h('div', { style: { marginTop: 2 } }, input('field', '代数拓扑, 微分几何'))),
          h('label', { style: S.hint }, '来源（可选）', h('div', { style: { marginTop: 2 } }, input('source', '新英汉数学词汇'))),
          h('label', { style: S.hint }, '例句 英文（可选）', h('div', { style: { marginTop: 2 } }, input('exampleEn', 'a smooth manifold'))),
        ),
        h('div', { style: { marginTop: 8 } },
          h('label', { style: S.hint }, '例句 中文（可选）',
            h('div', { style: { marginTop: 2 } }, input('exampleCn', '一个光滑流形', { width: '100%' })))),
        draft.term_id
          ? h('div', { style: { ...S.hint, marginTop: 6 } },
              '带 term_id 提交 = 纠正这一行的中文与可选字段；英文必须与该行一致（改名不支持）。')
          : h('div', { style: { ...S.hint, marginTop: 6 } },
              '不带 term_id = 新增；同一英文的另一种译法会存成 en__N 别名行，不会覆盖现有译名。'),
        error ? h('div', { style: { ...S.hint, color: '#dc2626', marginTop: 6 } }, error) : null,
        h('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
          h('button', { onClick: save, disabled: busy, style: { ...S.btnPrimary, opacity: busy ? 0.6 : 1 } },
            busy ? '保存中…' : '保存'),
          h('button', { onClick: props.onDone, style: S.btn }, '取消'),
        ),
      )
    }

    function TermRow(props) {
      const term = props.term
      if (props.editing) {
        return h(TermEditor, {
          term,
          onSave: props.onUpsert,
          onDone: props.onDoneEditing,
        })
      }
      return h('div', { style: S.card },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
          h('span', { style: { fontWeight: 600 } }, term.en),
          h('span', { style: { color: 'var(--dsh-text-tertiary, #999)' } }, '→'),
          h('span', null, term.cn),
          h('span', { style: { ...S.code, marginLeft: 'auto' } }, term.term_id),
          h('button', { onClick: () => props.onStartEditing(term.term_id), style: { ...S.btn, padding: '2px 8px' } }, '编辑'),
          h('button', {
            onClick: async () => {
              if (!window.confirm(`删除 ${term.term_id}（${term.en} / ${term.cn}）？此操作直接改 glossary.json。`)) return
              try { await props.onDelete(term.term_id) } catch (cause) { window.alert(String(cause && cause.message ? cause.message : cause)) }
            },
            style: { ...S.btnDanger },
          }, '删除'),
        ),
        h('div', { style: { ...S.hint, display: 'flex', gap: 10, flexWrap: 'wrap' } },
          term.matchedBy ? h('span', null, `命中：${term.matchedBy}`) : null,
          term.pos ? h('span', null, `词性：${term.pos}`) : null,
          term.field && term.field.length > 0 ? h('span', null, `子领域：${term.field.join(' / ')}`) : null,
          term.source ? h('span', null, `来源：${term.source}`) : null,
          term.updatedAt ? h('span', null, `更新：${term.updatedAt}`) : null,
        ),
        ...(term.examples || []).map((example, index) => h('div', {
          key: index,
          style: { ...S.hint, marginTop: 5, paddingLeft: 9, borderLeft: '2px solid rgba(120,120,120,.3)' },
        }, `${example.en} — ${example.cn}`)),
      )
    }

    function GlossaryTab() {
      const list = useEndpoint('/api/verymath/glossaries')
      const [selected, setSelected] = useState('')
      const [query, setQuery] = useState('')
      const [showGaps, setShowGaps] = useState(false)
      // One editor at a time: two open forms on the same document invite saving a
      // stale draft over a fresh edit.
      const [adding, setAdding] = useState(false)
      const [editingId, setEditingId] = useState('')

      const glossaries = (list.data && list.data.glossaries) || []
      useEffect(() => {
        if (selected === '' && glossaries.length > 0) setSelected(glossaries[0].path)
      }, [glossaries.length, selected])

      const endpoint = selected === ''
        ? undefined
        : `/api/verymath/glossary?path=${encodeURIComponent(selected)}&q=${encodeURIComponent(query)}`
      const result = useEndpoint(endpoint)

      const refresh = useCallback(() => { list.reload(); result.reload() }, [list.reload, result.reload])

      const upsert = useCallback(async (payload) => {
        await postJson('/api/verymath/glossary/upsert', { path: selected, terms: [payload] })
        refresh()
      }, [selected, refresh])

      const remove = useCallback(async (termId) => {
        await postJson('/api/verymath/glossary/delete', { path: selected, term_id: termId })
        refresh()
      }, [selected, refresh])

      if (list.status === 'loading' && list.data === undefined) return h(Loading, { label: '正在扫描工作区里的 glossary.json…' })
      if (list.status === 'failed') return h(Failure, { message: list.error, onRetry: list.reload })
      if (glossaries.length === 0) {
        return h(Empty, null,
          '工作区里没有 glossary.json（扫描深度 3 层，文件名含 glossary 或「术语」）。',
          h('div', { style: { marginTop: 8 } },
            '让 Agent 说一句「从 source.csv 构建一份中英数学术语表，输出 glossary/glossary.json」，回来这里就能编辑了。'))
      }

      const stats = (result.data && result.data.stats) || {}
      const terms = (result.data && result.data.terms) || []
      const gaps = showGaps && stats.missingExampleCount + stats.missingFieldCount > 0
        ? { examples: stats.missingExamples || [], fields: stats.missingField || [] }
        : undefined

      return h('div', null,
        h('div', { style: S.toolbar },
          h('select', { value: selected, onChange: (event) => setSelected(event.target.value), style: S.select },
            ...glossaries.map((item) => h('option', { key: item.path, value: item.path }, `${item.path}（${item.terms} 条）`))),
          h('button', { onClick: () => { setEditingId(''); setAdding(true) }, style: S.btnPrimary }, '新增术语'),
          h('button', { onClick: refresh, style: S.btn }, '刷新'),
        ),
        h('div', { style: S.stat },
          h(Stat, { value: stats.total ?? 0, label: '术语' }),
          h(Stat, { value: stats.withExamples ?? 0, label: '带例句' }),
          h(Stat, { value: stats.aliases ?? 0, label: '别名行' }),
          h(Stat, { value: (stats.fields || []).length, label: '子领域' }),
          h(Stat, { value: stats.missingExampleCount ?? 0, label: '缺例句' }),
        ),
        (stats.missingExampleCount > 0 || stats.missingFieldCount > 0)
          ? h('div', { style: { marginBottom: 10 } },
              h('button', { onClick: () => setShowGaps((value) => !value), style: S.btn },
                showGaps ? '收起缺口清单' : `看缺口清单（缺例句 ${stats.missingExampleCount} / 缺子领域 ${stats.missingFieldCount}）`),
              gaps
                ? h('div', { style: { ...S.card, marginTop: 8 } },
                    gaps.examples.length > 0
                      ? h('div', null,
                          h('div', { style: { fontWeight: 600, marginBottom: 3 } }, '缺例句'),
                          h('div', { style: S.code }, gaps.examples.join(', ')),
                          h('div', { style: { ...S.hint, marginTop: 4 } }, '技能脚本可补：glossary_enrich_examples.py（需显式 --model / --api-key）。'))
                      : null,
                    gaps.fields.length > 0
                      ? h('div', { style: { marginTop: 8 } },
                          h('div', { style: { fontWeight: 600, marginBottom: 3 } }, '缺子领域'),
                          h('div', { style: S.code }, gaps.fields.join(', ')))
                      : null,
                  )
                : null,
            )
          : null,
        h('input', {
          value: query, onChange: (event) => setQuery(event.target.value),
          placeholder: '查术语：英文、中文、term_id 或子领域（留空只看统计）', style: { ...S.input, width: '100%' },
        }),
        adding ? h(TermEditor, { term: undefined, onSave: upsert, onDone: () => setAdding(false) }) : null,
        h('div', { style: { marginTop: 12 } },
          // Stale-while-revalidate: a reload must NOT unmount the list. Rendering only
          // on `status === 'ready'` tore down the open editor on every 刷新 (and on the
          // reload that follows a save), which discarded the user's un-saved input.
          result.status === 'loading' && result.data === undefined ? h(Loading, null) : null,
          result.status === 'loading' && result.data !== undefined
            ? h('div', { style: { ...S.hint, marginBottom: 6 } }, '刷新中…')
            : null,
          result.status === 'failed' ? h(Failure, { message: result.error, onRetry: result.reload }) : null,
          result.data !== undefined && query.trim().length > 0 && terms.length === 0
            ? h(Empty, null, `没有匹配「${query}」。试试英文词根，或换个子领域名。`)
            : null,
          result.data !== undefined && terms.length > 0
            ? h('div', null,
                h('div', { style: { ...S.hint, marginBottom: 8 } },
                  `命中 ${result.data.matched} 条${result.data.truncated ? `，只显示前 ${terms.length} 条` : ''}`),
                ...terms.map((term) => h(TermRow, {
                  key: term.term_id,
                  term,
                  editing: editingId === term.term_id,
                  onStartEditing: (id) => { setAdding(false); setEditingId(id) },
                  onDoneEditing: () => setEditingId(''),
                  onUpsert: upsert,
                  onDelete: remove,
                })),
              )
            : null,
          result.data !== undefined && query.trim().length === 0 && terms.length === 0
            ? h('div', { style: { ...S.hint, marginTop: 8 } }, '输入关键词开始查；或点上面的「新增术语」。')
            : null,
        ),
      )
    }

    // -------------------------------------------------------- 论文图页签

    const TYPE_COLOR = {
      THEOREM: '#7c3aed', COROLLARY: '#7c3aed', LEMMA: '#2563eb', PROPOSITION: '#2563eb',
      DEFINITION: '#0f766e', CONSTRUCTION: '#0f766e', CLAIM: '#b45309', OBSERVATION: '#b45309', REMARK: '#6b7280',
    }

    function GraphView(props) {
      const graph = props.graph
      const [picked, setPicked] = useState('')
      const nodes = graph.nodes || []
      const byId = useMemo(() => {
        const map = new Map()
        for (const node of nodes) map.set(node.id, node)
        return map
      }, [nodes])

      const pickedNode = picked === '' ? undefined : byId.get(picked)
      const related = pickedNode === undefined ? [] : (graph.edges || [])
        .filter((edge) => edge.from === picked || edge.to === picked)
        .map((edge) => ({ edge, other: edge.from === picked ? edge.to : edge.from, outward: edge.from === picked }))

      return h('div', null,
        h('div', { style: { ...S.card, padding: 0, overflow: 'auto', maxHeight: 460, background: 'var(--dsh-surface, #fff)' } },
          h('svg', {
            width: graph.width, height: graph.height,
            style: { display: 'block' },
            viewBox: `0 0 ${graph.width} ${graph.height}`,
          },
            // 边先画，节点后画，避免线压在方块上
            ...(graph.edges || []).filter((edge) => byId.has(edge.from) && byId.has(edge.to)).map((edge, index) => {
              const from = byId.get(edge.from)
              const to = byId.get(edge.to)
              const x1 = from.x + from.width / 2
              const y1 = from.y + from.height
              const x2 = to.x + to.width / 2
              const y2 = to.y
              const mid = (y1 + y2) / 2
              const hot = picked !== '' && (edge.from === picked || edge.to === picked)
              return h('path', {
                key: `e${index}`,
                d: `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`,
                fill: 'none',
                stroke: hot ? '#2563eb' : edge.uncertain ? '#d97706' : '#b6c2d1',
                strokeWidth: hot ? 1.8 : 1.2,
                strokeDasharray: edge.uncertain ? '4 3' : undefined,
              })
            }),
            ...nodes.map((node) => {
              const color = TYPE_COLOR[node.type] || '#6b7280'
              const active = picked === node.id
              return h('g', {
                key: node.id,
                onClick: () => setPicked(active ? '' : node.id),
                style: { cursor: 'pointer' },
              },
                h('rect', {
                  x: node.x, y: node.y, width: node.width, height: node.height, rx: 8,
                  fill: active ? 'rgba(37,99,235,.1)' : 'var(--dsh-surface, #fff)',
                  stroke: color, strokeWidth: node.shared || active ? 2 : 1.1,
                }),
                h('text', { x: node.x + 10, y: node.y + 13, fontSize: 8.5, fill: color, fontFamily: 'ui-sans-serif' },
                  `${node.type}${node.shared ? ' · 枢纽' : ''}${node.supportsMainTheorem ? '' : ' · 孤立于主定理'}`),
                h('text', { x: node.x + 10, y: node.y + 26, fontSize: 10.5, fill: 'var(--dsh-text-primary, #111)', fontFamily: 'ui-sans-serif' },
                  node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label),
                h('text', { x: node.x + 10, y: node.y + 35, fontSize: 8.5, fill: 'var(--dsh-text-tertiary, #999)', fontFamily: 'ui-sans-serif' },
                  `in ${node.inDegree} / out ${node.outDegree}`),
              )
            }),
          ),
        ),
        h('div', { style: { ...S.hint, marginTop: 6 } }, '点节点看详情与依赖关系；再点一次取消选中。'),
        pickedNode === undefined
          ? null
          : h('div', { style: { ...S.card, marginTop: 8 } },
              h('div', { style: { fontWeight: 600 } }, `${pickedNode.label}  ·  ${pickedNode.type}`),
              h('div', { style: { ...S.hint, marginTop: 3 } }, pickedNode.statement),
              h('div', { style: { ...S.hint, marginTop: 6 } },
                `被引用 ${pickedNode.inDegree} · 依赖 ${pickedNode.outDegree}` +
                `${pickedNode.shared ? ' · 枢纽节点' : ''}` +
                `${pickedNode.supportsMainTheorem ? ' · 支撑主定理' : ' · 不支撑任何主定理'}`),
              related.length > 0
                ? h('div', { style: { marginTop: 8 } },
                    h('div', { style: { fontWeight: 600, marginBottom: 3 } }, '关系'),
                    ...related.map((item, index) => h('div', { key: index, style: S.hint },
                      `${item.outward ? '依赖' : '被'} ${item.other}${item.edge.uncertain ? '（不确定）' : ''}`)))
                : null,
            ),
      )
    }

    function PaperTab() {
      const list = useEndpoint('/api/verymath/structures')
      const [selected, setSelected] = useState('')
      const [focus, setFocus] = useState('')

      const structures = (list.data && list.data.structures) || []
      useEffect(() => {
        if (selected === '' && structures.length > 0) setSelected(structures[0].path)
      }, [structures.length, selected])

      const endpoint = selected === ''
        ? undefined
        : `/api/verymath/paper?path=${encodeURIComponent(selected)}&focus=${encodeURIComponent(focus)}`
      const result = useEndpoint(endpoint)

      if (list.status === 'loading' && list.data === undefined) return h(Loading, { label: '正在扫描工作区里的 *_structure.json…' })
      if (list.status === 'failed') return h(Failure, { message: list.error, onRetry: list.reload })
      if (structures.length === 0) {
        return h(Empty, null,
          '工作区里没有 *_structure.json（math-paper-reading 的结构产物）。',
          h('div', { style: { marginTop: 8 } },
            '让 Agent 说一句「读 papers/xxx/fulltext.txt 的第 1 节，把定义提取成结构 JSON」，产物出现后这里会列出来。'))
      }

      const data = result.data
      return h('div', null,
        h('div', { style: S.toolbar },
          h('select', { value: selected, onChange: (event) => setSelected(event.target.value), style: S.select },
            ...structures.map((item) => h('option', { key: item.path, value: item.path }, `${item.title}（${item.entities} 实体）`))),
          h('input', {
            value: focus, onChange: (event) => setFocus(event.target.value),
            placeholder: '聚焦某条定理看依赖闭包（可留空）', style: { ...S.input, width: 250 },
          }),
        ),
        result.status === 'loading' ? h(Loading, null) : null,
        result.status === 'failed' ? h(Failure, { message: result.error, onRetry: result.reload }) : null,
        result.status === 'ready' && data
          ? h('div', null,
              h('div', { style: S.stat },
                h(Stat, { value: data.entities ?? 0, label: '实体' }),
                h(Stat, { value: (data.sharedNodes || []).length, label: '枢纽' }),
                h(Stat, { value: (data.cycles || []).length, label: '环' }),
                h(Stat, { value: (data.isolated || []).length, label: '孤立' }),
                h(Stat, { value: (data.longestChain || []).length, label: '最长链' }),
              ),
              (data.cycles || []).length > 0
                ? h('div', { style: { ...S.card, borderColor: 'rgba(217,119,6,.5)', background: 'rgba(217,119,6,.07)' } },
                    h('div', { style: { fontWeight: 600 } }, '⚠ 依赖图里有环（上游要求人工判断）'),
                    ...data.cycles.map((cycle, index) => h('div', { key: index, style: S.hint }, cycle.join(' → '))))
                : null,
              data.focus
                ? h('div', { style: { ...S.card, borderColor: data.focus.found ? undefined : 'rgba(180,83,9,.5)' } },
                    h('div', { style: { fontWeight: 600, marginBottom: 3 } },
                      data.focus.found ? `聚焦 ${data.focus.label}` : `聚焦 ${data.focus.label}（未找到）`),
                    data.focus.found
                      ? h('div', { style: S.hint }, '自底向上阅读层：' + data.focus.levels.map((level) => `[${level.join('、')}]`).join(' → '))
                      : h('div', { style: S.hint }, '这个标签不在合并后的实体里。'))
                : null,
              data.graph && data.graph.nodes
                ? h(GraphView, { graph: data.graph })
                : null,
              h('div', { style: { ...S.card, marginTop: 10 } },
                h('div', { style: { ...S.hint, marginBottom: 4 } }, '复现顺序（自底向上）'),
                h('div', { style: S.code }, (data.bottomUpLevels || []).map((level) => `[${level.join('、')}]`).join(' → ')),
                h('div', { style: { ...S.hint, marginTop: 8, marginBottom: 4 } }, '阅读顺序（自顶向下）'),
                h('div', { style: S.code }, (data.topDownOrder || []).join(' → ')),
              ),
            )
          : null,
      )
    }

    // ------------------------------------------------------------ 技能页签

    function SkillsTab() {
      const { status, data, error, reload } = useEndpoint('/api/verymath/skills')
      if (status === 'loading' && data === undefined) return h(Loading, { label: '读取随包技能…' })
      if (status === 'failed') return h(Failure, { message: error, onRetry: reload })
      const skills = (data && data.skills) || []
      return h('div', null,
        h('div', { style: S.toolbar },
          h('div', { style: { fontSize: 14, fontWeight: 600 } }, `${skills.length} 个随包技能`),
          h('div', { style: S.hint }, '与工具同版本发布'),
          h('button', { onClick: reload, style: { ...S.btn, marginLeft: 'auto' } }, '刷新'),
        ),
        ...skills.map((skill) => h('div', { key: skill.name, style: S.card },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
            h('span', { style: { fontWeight: 600 } }, skill.name),
            h('span', { style: { ...S.code, marginLeft: 'auto' } }, `${skill.files} 个文件`)),
          h('div', { style: { ...S.hint, marginTop: 3 } }, skill.description),
        )),
      )
    }

    // -------------------------------------------------------------- 外壳

    function VeryMathIcon(props) {
      const size = (props && props.size) || 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true',
      }, h('path', { d: 'M12 3H4l4 5-4 5h8' }))
    }

    const TABS = [
      { id: 'env', label: '环境' },
      { id: 'glossary', label: '术语库' },
      { id: 'paper', label: '论文图' },
      { id: 'skills', label: '技能' },
    ]

    function VeryMathPanel() {
      const [tab, setTab] = useState('env')
      return h('div', { style: S.wrap },
        h('style', null, '@keyframes verymath-spin{to{transform:rotate(360deg)}}'),
        h('div', { style: S.head },
          h('div', { style: S.title }, 'VeryMath 数学科研'),
          h('div', { style: S.tabs }, ...TABS.map((item) => h('button', {
            key: item.id, onClick: () => setTab(item.id),
            style: item.id === tab ? { ...S.tab, ...S.tabOn } : S.tab,
          }, item.label))),
        ),
        h('div', { style: S.body },
          tab === 'env' ? h(EnvTab, null) : null,
          tab === 'glossary' ? h(GlossaryTab, null) : null,
          tab === 'paper' ? h(PaperTab, null) : null,
          tab === 'skills' ? h(SkillsTab, null) : null,
        ),
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 40,
        label: 'VeryMath 数学科研',
      }, VeryMathIcon)), 'verymath: sidebar entry')

      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
      }, VeryMathPanel)), 'verymath: main panel')
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})

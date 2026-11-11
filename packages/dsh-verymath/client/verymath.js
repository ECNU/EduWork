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
 *     （kind: list）：插件注册 `{ id, order, label }` + 图标组件，左栏就多一行；
 *   - 点开时按**同一 id** 去 `@deepseek-ai/dsh-client-ui-layout` 的 `main`
 *     （kind: keyed，root 作用域）取组件，所以主面板注册必须带 `key: <同一 id>`；
 *   - 注册 API：`ctx.slots.inject(slot, () => ctx.slots.register(options, Component))`，
 *     `ctx.effect(...)` 保证插件卸载时一并移除。
 */
window.__ModuleLoader__.load({
  id: '@eduwork/dsh-verymath',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const react = require('react')
    const h = react.createElement

    const PANEL_ID = 'verymath'

    /** 左栏图标：一个极简的求和符号，避免额外资源文件。 */
    function VeryMathIcon(props) {
      const size = (props && props.size) || 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M12 3H4l4 5-4 5h8' }),
      )
    }

    /** 一行小标题 */
    function Section(props) {
      return h('div', {
        style: {
          fontSize: 11,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--dsh-text-tertiary, #888)',
          margin: '14px 0 6px',
        },
      }, props.children)
    }

    const TOOLS = [
      ['verymath_glossary_query', '查双语术语库'],
      ['verymath_glossary_upsert', '存词 / 纠正译名'],
      ['verymath_glossary_build', '从 CSV 建库（Python）'],
      ['verymath_python_check', 'Python 可用性'],
      ['verymath_paper_validate', '论文结构 JSON 校验'],
      ['verymath_paper_graph', '定理依赖图'],
      ['verymath_ocr_scan', 'OCR 后错误定位'],
      ['verymath_osqp_check', 'OSQP 求解栈探测'],
      ['verymath_osqp_solve', '凸二次规划求解'],
      ['verymath_lean_detect_sorry', 'Lean 禁用词扫描'],
      ['verymath_sage_check', 'SageMath 探测'],
      ['verymath_sage_search', 'Sage 文档反幻觉查询'],
      ['verymath_research_gate', '研究工作区三道闸门'],
      ['verymath_beamer_check', 'Beamer TeX 工具链'],
    ]

    /** 主面板：能力清单与当前状态。 */
    function VeryMathPanel() {
      return h('div', { style: { padding: '16px 18px', fontSize: 13, lineHeight: 1.6 } },
        h('div', { style: { fontSize: 15, fontWeight: 600 } }, '数学科研'),
        h('div', { style: { color: 'var(--dsh-text-secondary, #666)', marginTop: 2 } },
          'VeryMath 能力接入：14 个工具 · 16 个技能'),
        h(Section, null, '工具'),
        h('div', { style: { display: 'grid', gap: 2 } },
          ...TOOLS.map(([name, desc]) => h('div', {
            key: name,
            style: { display: 'flex', gap: 8, alignItems: 'baseline' },
          },
            h('code', { style: { fontSize: 11.5, color: 'var(--dsh-text-secondary, #666)' } }, name),
            h('span', { style: { fontSize: 12 } }, desc),
          )),
        ),
        h(Section, null, '怎么用'),
        h('div', { style: { color: 'var(--dsh-text-secondary, #666)' } },
          '全部能力都在对话里调用：「帮我查一下 manifold 的中文术语」「读这篇论文的定理依赖」。',
          '这个面板只是入口与状态指示，不做计算——计算都在工具里，结果写进会话工作区。'),
      )
    }

    function apply(ctx) {
      // 左栏入口（list 槽，每个插件一行）
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 40,
        label: '数学科研',
      }, VeryMathIcon)), 'verymath: sidebar entry')

      // 主面板（keyed 槽，键必须与上面 id 一致）
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

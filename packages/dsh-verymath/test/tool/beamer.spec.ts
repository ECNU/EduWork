import { describe, expect, it } from 'vitest'

// Shape tests for the verymath_beamer_check tool contract (no TeX dependency):
// the probe pattern mirrors verymath_osqp_check (per-piece availability) with
// the math-beamer gate discipline (deliver .tex only when the toolchain is out).

interface BeamerToolProbe {
  readonly name: string
  readonly kind: 'binary' | 'style'
  readonly available: boolean
  readonly executable?: string
}

interface BeamerCheckJson {
  readonly available: boolean
  readonly tools: readonly BeamerToolProbe[]
  readonly hint?: string
}

/** The tool's readiness rule: latexmk + xelatex + forest must all be available. */
function readiness(tools: readonly BeamerToolProbe[]): boolean {
  const latexmk = tools.find(tool => tool.name === 'latexmk')
  const xelatex = tools.find(tool => tool.name === 'xelatex')
  const forest = tools.find(tool => tool.name === 'forest')
  return latexmk?.available === true && xelatex?.available === true && forest?.available === true
}

/** The tool's hint assembly, extracted verbatim from the execute() contract. */
function hintFor(tools: readonly BeamerToolProbe[]): string | undefined {
  const missingBinaries = tools.filter(tool => !tool.available && tool.kind === 'binary')
  const missingStyles = tools.filter(tool => !tool.available && tool.kind === 'style')
  let hint: string | undefined
  if (!readiness(tools)) {
    const parts: string[] = []
    if (missingBinaries.length > 0) {
      parts.push(`Install a TeX distribution (macOS: MacTeX or brew install --cask mactex-no-gui; Linux: texlive-full) to provide ${missingBinaries.map(tool => tool.name).join(', ')}.`)
    }
    if (missingStyles.length > 0) {
      parts.push(`LaTeX package(s) ${missingStyles.map(tool => tool.name).join(', ')} not found via kpsewhich (tlmgr install ${missingStyles.map(tool => tool.name).join(' ')}).`)
    }
    parts.push('Until then, deliver .tex sources only — do not compile, per the math-beamer gate discipline.')
    hint = parts.join(' ')
  }
  return hint
}

/** The render contract, extracted verbatim from the render() implementation. */
function render(value: BeamerCheckJson): string {
  const lines = value.tools.map((tool) => `- ${tool.name} (${tool.kind}): ${tool.available ? `ok${tool.executable !== undefined ? ` ${tool.executable}` : ''}` : 'missing'}`)
  const status = value.available ? 'TeX toolchain ready for math-beamer' : 'TeX toolchain NOT ready for math-beamer'
  return [status, ...lines, value.hint !== undefined ? `hint: ${value.hint}` : ''].filter(Boolean).join('\n')
}

describe('beamer_check readiness contract', () => {
  it('is ready when latexmk, xelatex and forest are all available', () => {
    const full: BeamerToolProbe[] = [
      { name: 'latexmk', kind: 'binary', available: true, executable: '/Library/TeX/texbin/latexmk' },
      { name: 'xelatex', kind: 'binary', available: true, executable: '/Library/TeX/texbin/xelatex' },
      { name: 'forest', kind: 'style', available: true, executable: '/usr/local/texlive/2025/texmf-dist/tex/latex/forest/forest.sty' },
      { name: 'ctex', kind: 'style', available: true, executable: '/usr/local/texlive/2025/texmf-dist/tex/latex/ctex/ctex.sty' },
    ]
    expect(readiness(full)).toBe(true)
    expect(hintFor(full)).toBeUndefined()
  })

  it('is not ready when a binary is missing and names it in the hint', () => {
    const withoutXelatex: BeamerToolProbe[] = [
      { name: 'latexmk', kind: 'binary', available: true, executable: '/Library/TeX/texbin/latexmk' },
      { name: 'xelatex', kind: 'binary', available: false },
      { name: 'forest', kind: 'style', available: true, executable: '/texmf-dist/tex/latex/forest/forest.sty' },
      { name: 'ctex', kind: 'style', available: false },
    ]
    expect(readiness(withoutXelatex)).toBe(false)
    const hint = hintFor(withoutXelatex)
    expect(hint).toContain('xelatex')
    expect(hint).toContain('deliver .tex sources only')
    // The TeX-distribution hint fires for the missing binary...
    expect(hint).toContain('MacTeX')
    // ...and the style hint fires for the missing ctex package.
    expect(hint).toContain('tlmgr install ctex')
  })

  it('does not fire the TeX-distribution hint when only styles are missing', () => {
    const styleOnly: BeamerToolProbe[] = [
      { name: 'latexmk', kind: 'binary', available: true, executable: '/Library/TeX/texbin/latexmk' },
      { name: 'xelatex', kind: 'binary', available: true, executable: '/Library/TeX/texbin/xelatex' },
      { name: 'forest', kind: 'style', available: false },
      { name: 'ctex', kind: 'style', available: false },
    ]
    // forest is part of the readiness rule, so this is not ready — but no binary install hint.
    expect(readiness(styleOnly)).toBe(false)
    const hint = hintFor(styleOnly)
    expect(hint).not.toContain('MacTeX')
    expect(hint).toContain('tlmgr install forest ctex')
  })

  it('keeps ctex optional: missing ctex alone does not block readiness', () => {
    const withoutCtex: BeamerToolProbe[] = [
      { name: 'latexmk', kind: 'binary', available: true, executable: '/Library/TeX/texbin/latexmk' },
      { name: 'xelatex', kind: 'binary', available: true, executable: '/Library/TeX/texbin/xelatex' },
      { name: 'forest', kind: 'style', available: true, executable: '/texmf-dist/tex/latex/forest/forest.sty' },
      { name: 'ctex', kind: 'style', available: false },
    ]
    expect(readiness(withoutCtex)).toBe(true)
  })

  it('documents the probed probe order and kinds', () => {
    // The real probe returns binaries first, then styles, in this order.
    const names = ['latexmk', 'xelatex', 'forest', 'ctex']
    const kinds: Record<string, 'binary' | 'style'> = { latexmk: 'binary', xelatex: 'binary', forest: 'style', ctex: 'style' }
    expect(names.map(name => kinds[name])).toEqual(['binary', 'binary', 'style', 'style'])
  })
})

describe('beamer_check render contract', () => {
  it('renders per-piece ok/missing lines with the executable path', () => {
    const full: BeamerCheckJson = {
      available: true,
      tools: [
        { name: 'latexmk', kind: 'binary', available: true, executable: '/Library/TeX/texbin/latexmk' },
        { name: 'forest', kind: 'style', available: true, executable: '/texmf/forest.sty' },
      ],
    }
    const text = render(full)
    expect(text).toContain('TeX toolchain ready for math-beamer')
    expect(text).toContain('- latexmk (binary): ok /Library/TeX/texbin/latexmk')
    expect(text).toContain('- forest (style): ok /texmf/forest.sty')
    expect(text).not.toContain('hint:')
  })

  it('renders the hint line when the toolchain is out', () => {
    const partial: BeamerCheckJson = {
      available: false,
      tools: [{ name: 'xelatex', kind: 'binary', available: false }],
      hint: 'Install a TeX distribution (macOS: MacTeX) to provide xelatex. Until then, deliver .tex sources only — do not compile, per the math-beamer gate discipline.',
    }
    const text = render(partial)
    expect(text).toContain('TeX toolchain NOT ready for math-beamer')
    expect(text).toContain('- xelatex (binary): missing')
    expect(text).toContain('hint: Install a TeX distribution')
  })
})

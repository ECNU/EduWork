# Build And Layout Audit

## Build Commands

- English default:
  `latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex`
- Chinese or mixed CJK default:
  `latexmk -xelatex -interaction=nonstopmode -halt-on-error main.tex`
- Clean generated files when needed:
  `latexmk -C main.tex`

Ask before installing TeX packages, enabling shell escape, using `minted`,
externalizing TikZ, or changing system fonts.

## Hard Failures

- Fatal LaTeX errors.
- Missing figures, `.sty`, `.cls`, `.bib`, or data files.
- Undefined references or citations after rerun.
- Duplicate labels.
- Bibliography backend mismatch.
- Absolute paths or files outside the deck tree.

## Layout Risks

- Overfull boxes, especially formulas and tables.
- Dense frames with too many bullets or proof steps.
- Frame titles that collide with navigation.
- Figures with unreadable labels or legends.
- Tables with more columns than the slide can support.
- Backup slides counted as part of the main talk when they should not be.

## Selected Template Comparison

Use the recorded template source and previews, approved samples, and explicit
style changes as the comparison reference.

- Inspect the rendered cover and representative content pages, including dense
  formula, theorem, and figure/table pages where present. For a single-page
  poster, inspect that poster page. Check pages adjusted during overflow
  repairs as well.
- Compare cover alignment and metadata placement, font hierarchy, colors,
  margins, frame titles, headline/footline, navigation, and block appearance.
  Different wording and page counts are expected; the selected visual
  framework must remain recognizable in each of these elements.
- Inspect source changes for theme or font replacements and added overrides
  such as `\setbeamertemplate`, `\setbeamerfont`, `\setbeamercolor`, custom
  title frames, or local style definitions. Retaining `\usetheme` alone does
  not show that its layout is still in use.
- Restore unrequested changes and recompile before delivery. Do not replace
  the comparison previews with the changed output to make a mismatch disappear.
- Record the pages compared, differences found, and corrections in the
  existing review report. Distinguish source inspection from rendered-PDF
  inspection; if rendering is unavailable, report that the visual comparison
  remains incomplete.

## Mathematical Meaning Risks

- Removed assumptions.
- Hidden domains, dimensions, or boundary conditions.
- Symbols reused for different objects.
- Proof sketch presented as proof.
- Numeric result copied without run, dataset, or metric source.

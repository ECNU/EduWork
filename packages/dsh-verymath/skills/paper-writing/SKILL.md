---
name: paper-writing
description: Use when drafting, revising, or auditing source-grounded mathematical paper text, including abstracts, introductions, related work, theorem exposition, experiment narratives, revision plans, and response letters.
---

# Paper Writing

## DSH Integration Notes

- 本技能由 `@eduwork/dsh-verymath` 插件提供；六个子技能已扁平化为本目录下的
  `skill_*.md` 模块文件（与 math-paper-reading 的模块布局一致），按需读取被触发的模块。
- 资产联动：`verymath_paper_graph` 可为 paper-skeleton 模块计算定理依赖图；
  `verymath_glossary_query` 在双语写作时校对术语；`verymath_paper_validate` 校验
  math-paper-reading 产出的结构 JSON——它是 claim-evidence-ledger 模块的证据来源之一。
- LaTeX 构建审计模块需要 latexmk/pdflatex/xelatex；先探测可用性，缺失时只交付源码。
- 所有模板在 `templates/` 下；产物写入当前会话工作区。

Use this skill to help write mathematical papers from verified sources, notes,
proof artifacts, experiment logs, or reviewer feedback. The workflow is for
paper writing; unsupported-claim control is a required review step, not a
separate public skill.

## Use When

Use this skill when the user wants to:

- draft or revise a mathematical paper section;
- turn proof notes, experiment logs, or reading notes into paper text;
- prepare related work, positioning, abstracts, introductions, or conclusions;
- respond to reviewer comments with evidence-backed changes;
- audit a draft for unsupported claims, missing citations, unclear assumptions,
  or overstated contributions.

Do not use this skill to invent theorems, experiments, citations, author claims,
or results that are not supported by the provided evidence.

## Inputs

- Required: writing goal, target section or deliverable, and source materials.
- Optional: target venue, audience, style constraints, citation policy, reviewer
  comments, theorem/proof files, experiment logs, figures, or bibliography.

If source materials are missing, stop and ask for them or produce only an
explicit outline of needed evidence. For recurring work, start from
`templates/source-packet.md`.

## Outputs

- Draft or revised paper text.
- Claim-evidence notes for substantive mathematical, empirical, or literature
  claims.
- A list of unsupported, uncertain, or citation-needed statements.
- Suggested next edits and required source checks.

## Subskill Routing

Read the `skill_*.md` module files in this directory when the task needs a specialized audit (paper-skeleton / claim-evidence / proof-obligation / notation-consistency / formula-readability / latex-build).

| Need | Subskill |
| --- | --- |
| Build a rapid paper skeleton, section plan, or result dependency map before prose | `paper-skeleton-and-logical-architecture` |
| Map claims to proofs, citations, experiments, or uncertainty | `claim-evidence-ledger` |
| Audit theorem assumptions, proof obligations, edge cases, or external theorem fit | `proof-obligation-and-assumption-audit` |
| Check notation drift, variable reuse, symbol scope, domains, or dimensions | `notation-and-variable-consistency` |
| Improve displayed formulas, derivations, theorem/proof environments, and formula prose | `formula-environment-and-readability` |
| Check LaTeX builds, labels, references, citations, macros, floats, layout warnings, and submission preflight risks | `latex-build-and-layout-audit` |

## Bundled Templates

- `templates/source-packet.md`: collect the evidence packet before writing.
- `templates/rapid-prototype-paper-skeleton.md`: plan the paper structure,
  contribution spine, and result dependency map.
- `templates/claim-evidence-ledger.md`: trace claims to proof, citation,
  experiment, or explicit uncertainty.
- `templates/proof-obligation-ledger.md`: audit assumptions, dependencies,
  external result fit, and uncovered cases.
- `templates/submission-readiness.md`: check build, source package, arXiv, and
  venue readiness.

## Workflow

1. Identify the writing task: paper skeleton, section draft, revision, related
   work, theorem exposition, experiment narrative, or response letter.
2. Inventory the source packet: notes, papers, proofs, code logs, data, figures,
   bibliography, and reviewer comments.
3. For early-stage papers, build a rapid skeleton before drafting: contribution
   spine, section map, result dependency map, and explicit gaps.
4. Extract only supported claims, definitions, assumptions, results, limitations,
   and citation anchors.
5. Load a subskill when the task needs a skeleton, proof-obligation audit,
   focused ledger, notation check, formula rewrite, or LaTeX audit.
6. Draft or revise the target text in the requested style.
7. Run a support audit: mark every important claim as supported, needs citation,
   needs proof, needs experiment, or should be softened/removed.
8. Return the text plus review notes, not just polished prose.

## Review Rules

- Preserve mathematical conditions and quantifiers.
- Distinguish theorem, conjecture, experiment, intuition, and future work.
- Treat "has a citation or proof sketch" as weaker than "all assumptions and
  proof obligations are covered".
- Do not fabricate citations, venues, author positions, numeric results, or
  proof status.
- Mark uncertain statements explicitly instead of filling gaps.
- Keep AI contribution wording factual and modest when writing acknowledgments,
  limitations, or methodology sections.

## Failure Modes

- Missing source packet: produce an evidence request, not a full draft.
- Conflicting sources: show the conflict and ask which source is authoritative.
- Unverified proof or experiment: write provisional language and list the
  verification still needed.
- Citation gap: mark `citation needed` with the claim it supports.

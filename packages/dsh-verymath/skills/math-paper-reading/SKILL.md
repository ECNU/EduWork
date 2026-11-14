---
name: math-paper-reading
description: Route mathematical paper-reading tasks through structured extraction, dependency analysis, deep reading, literature search, and reference management modules. Trigger when the user uploads or pastes a math paper (PDF/Markdown/text/arXiv link) and asks to 梳理章节结构、提取定理/引理/定义、分析证明依赖、深读论文、生成阅读笔记 or manage a local paper reference database. Use the verymath_paper_validate tool to check <slug>_structure.json artifacts after extraction.
---

# Math Paper Reading

Use this skill when a coding agent needs to read, structure, explain, trace, or
manage mathematical papers with a data-driven workflow.

## DSH Integration Notes

- This skill is provided by the `@eduwork/dsh-verymath` plugin; all module
  files live next to this SKILL.md and resolve relative to this directory.
- After generating a `<slug>_structure.json` artifact (skill_base module), call
  the `verymath_paper_validate` tool when available to verify required
  metadata, entity kinds, and dependency-label integrity before handing the
  artifact to downstream modules or the user.
- Validation is advisory: when the tool is unavailable, follow the schema in
  `skill_base.md` and keep the artifact in the session workspace.
- Full-text acquisition can reuse the `literature_fulltext` tool from the
  `@eduwork/dsh-literature` plugin when it is installed; otherwise download
  sources directly to the workspace.
- Write all generated artifacts (Markdown reports, JSON structures) into the
  current session workspace so the user can continue working with them.

## Entry Point

Start with `agent_router.md`. It is the master router and decides which
package-local module to load:

- `skill_base.md`: extract definitions, lemmas, theorems, proofs, and
  dependency structure into JSON.
- `skill_pathway_proof.md`: compute dependency paths and render proof graphs.
- `skill_paper_deep_read.md`: provide layered paper reading and gap filling.
- `skill_reference_manager.md`: maintain the local paper reference database.
- `skill_literature_search.md`: generate targeted literature-search strategies.

## Operating Rules

- Keep fact extraction separate from interpretation.
- Prefer structured JSON evidence before graph, reading, or reference updates.
- Use package-local examples only as examples; do not treat them as user data.
- For complex dependency or merge tasks, write and run scripts instead of
  estimating manually.

Prefer the router and package-local module files over this thin compatibility
entrypoint when executing a concrete workflow.

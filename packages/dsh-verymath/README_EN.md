# Math research

[中文](README.md)

An optional EduWork plugin that brings VeryMath's math research skills and tools into the conversation: structured paper reading with theorem dependency graphs, a bilingual glossary, paper writing and Beamer slides, mixed-integer and quadratic programming, least squares and invariant computation, Lean patch acceptance, research-workflow gates, plus Sage documentation lookup and MATLAB execution. 16 skills and 14 tools. Tested on DSH 0.2.2-rc.1 (the version bundled with EduWork 0.4.13) and 0.2.1-rc.5; the peer range covers both and later 0.2.x releases.

## Try it in two prompts

Once enabled, either block below can be pasted straight into the conversation. Artifacts land in the current session workspace.

**1. Bilingual glossary** (needs local `python3` + `PyYAML`. `verymath_python_check` only confirms that `python3` is available; without `PyYAML` the script fails with `No module named 'yaml'`, which `pip install PyYAML` fixes)

```text
从 source.csv 构建一份中英数学术语表，输出 glossary/glossary.json；
然后查「同调」对应的英文。
```

You get a `glossary/glossary.json` with sorted entries, unique `term_id` and contiguous `idx`, plus the lookup `同调 → homology`. Sample input: `docs/examples/source.csv`.

**2. Theorem dependencies of a paper** (no Python, no network)

```text
帮我读 papers/maynard/fulltext.txt（arXiv 1311.4600）的第 1 节，
把里面的定义提取成结构 JSON 并用工具校验。
```

Then ask "draw the dependency graph of Theorem 1.2 and mark each node's source location" to get the graph. The repo does not redistribute paper full texts; follow the two commands in `docs/examples/README.md` to fetch and convert one.

Prompts, sample inputs and verification notes for the remaining 12 capabilities (OCR post-review, QP, MILP, least squares, Lean, Sage doc lookup, MATLAB, Beamer, ...) are in the [capability examples](docs/capability-examples.md).

## Install and use

1. In a distribution that ships this plugin, open "Plugins → EduWork extensions" on the left and enable "Math research". To try it from source, prepare the plugin following the [build guide](DEVELOPMENT.md) and install it from a local directory in the same page.
2. Describe the task directly (the two prompts above can be used as-is). Artifacts are written to the current session workspace.
3. Glossary files, paper structure JSON and dependency graphs stay in the workspace and can feed follow-up tasks.
4. The mapping between skills and tools is documented in the [capability examples](docs/capability-examples.md), which also gives copy-paste prompts, sample inputs and verification notes for each scenario.

## Capability boundaries

- Python, SageMath, TeX Live, Lean/elan and MATLAB are installed by the user. The plugin only probes for them, returns install hints when something is missing, and is distributed without them. Sage support is documentation lookup only; MATLAB needs the user's own license through the official MathWorks MCP server.
- Paper structure validation checks dependency integrity, cycles and dangling links. It does not judge whether a proof is correct.
- Dependency graphs and glossary writes are computed deterministically in TypeScript rather than assembled by the model. A glossary write distinguishes adding another translation (stored as an `en__N` alias row, the existing translation is kept) from correcting one (the `term_id` names the row to change, and its English term must match).
- Beamer templates only reference the local TeX Live themes; no third-party `.sty`, `.cls` or font files are redistributed.
- Verified on macOS; Windows is untested. External binaries are discovered through PATH and PATHEXT rather than a fixed platform path, but that discovery has not been exercised on Windows.
- Skill content is adapted from the VeryMath MIT repositories; see [licensing](LICENSING.md) and [provenance](UPSTREAM.json).

Development and testing are described in the [build guide](DEVELOPMENT.md).

# Math research

[中文](README.md)

An optional EduWork plugin that brings VeryMath's math research skills and tools into the conversation: structured paper reading with theorem dependency graphs, a bilingual glossary, paper writing and Beamer slides, mixed-integer and quadratic programming, least squares and invariant computation, Lean patch acceptance, research-workflow gates, plus Sage documentation lookup and MATLAB execution. 16 skills and 14 tools. Compatible with DSH 0.2.1-rc.5 and 0.2.2-rc.1.

## Install and use

1. In a distribution that ships this plugin, open "Plugins → EduWork extensions" on the left and enable "Math research". To try it from source, prepare the plugin following the [build guide](DEVELOPMENT.md) and install it from a local directory in the same page.
2. Describe the task directly, for example "read this paper's structure and draw the theorem dependencies", "look up the Chinese term for manifold", or "solve this QP and verify the result". Artifacts are written to the current session workspace.
3. Glossary files, paper structure JSON and dependency graphs stay in the workspace and can feed follow-up tasks.
4. The mapping between skills and tools is documented in the [capability examples](docs/capability-examples.md), which also gives copy-paste prompts, sample inputs and verification notes for each scenario.

## Capability boundaries

- Python, SageMath, TeX Live, Lean/elan and MATLAB are installed by the user. The plugin only probes for them, returns install hints when something is missing, and bundles none of them. Sage support is documentation lookup only; MATLAB needs the user's own licence through the official MathWorks MCP server.
- Paper structure validation checks dependency integrity, cycles and dangling links. It does not judge whether a proof is correct.
- Dependency graphs and glossary writes are computed deterministically in TypeScript rather than assembled by the model.
- Beamer templates only reference the local TeX Live themes; no third-party `.sty`, `.cls` or font files are redistributed.
- Verified on macOS; Windows is untested, including path and binary discovery for external environments.
- Skill content is adapted from the VeryMath MIT repositories; see [licensing](LICENSING.md) and [provenance](UPSTREAM.json).

Development and testing are described in the [build guide](DEVELOPMENT.md).

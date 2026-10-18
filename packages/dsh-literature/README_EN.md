# EduWork literature tools

[简体中文](README.md) | **English**

`@eduwork/dsh-literature` provides literature search, BibTeX and available full-text retrieval for DSH. Other DSH applications can use it independently of EduWork.

Forked from [SihanLv/dsh-literature](https://github.com/SihanLv/dsh-literature) `0.1.2`, this package is maintained by EduWork under the MIT license. Thanks to the original author and upstream contributors. See [UPSTREAM.json](UPSTREAM.json) for the source commit and original file hashes, and [NOTICE.md](NOTICE.md) for attribution.

## Current capabilities

- Search **DBLP and arXiv**, merge and deduplicate records, and distinguish publications from preprints.
- Retrieve source-provided **BibTeX** entries.
- Try arXiv source archives, HTML and PDFs, plus accessible publisher PDFs; extract text into the calling session's workspace.
- Run full-text retrieval through official DSH Jobs by default, with result collection, cancellation and session sandbox enforcement.

Full-text availability depends on the source, network and access permissions. The package does not guarantee access to paywalled or restricted content. Publisher PDF link extraction uses the host's model; no model or account is included. DSH 0.2.0 retains a subagent with no action tools. On 0.2.1, one structured extraction uses the calling Agent's current model without executing returned tools or inheriting Agent-loop automatic retries. Retry the full-text task after a transient failure. Cancelling the task aborts extraction.

Compatible with DSH 0.2.x, explicitly including the 0.2.1 prerelease series. Both API paths require behavioral qualification. Legacy invariant exports remain available through an optional peer; 0.2.1 does not need to install the old kernel component.

## Installation and use

Requires Node.js `24.18.0+` and DSH `0.2.x (starting with 0.2.0-rc.1)`; other kernel versions have not been validated.

```sh
dsh plugin add @eduwork/dsh-literature@0.1.3
```

Alternatively, build from source:

```sh
# From the EduWork repository root
node scripts/packages/manage.mjs install dsh-literature
node scripts/packages/manage.mjs check dsh-literature
node scripts/packages/manage.mjs pack dsh-literature
```

The resulting `.tgz` is under `dist/npm-packages/dsh-literature/` and can be selected in DSH's plugin installer.

Agents receive `literature_search`, `literature_bibtex` and `literature_fulltext`. For example: “Find recent papers on retrieval-augmented generation, provide citations, and retrieve publicly available full text.” Use official `job_output` and `job_kill` for background work.

Configuration IDs remain `literature`, `literature-dblp`, `literature-arxiv` and `tool-literature`. For manual installation, disable the previous `@shlv/dsh-literature` bundle first to avoid duplicate tools. Installing this package does not migrate the host's profile/home configuration automatically; preserve the original configuration before changing kernels or plugins.

## Configuration and maintenance

The `literature` entry accepts `enabledSources` (`dblp`, `arxiv`), `searchMaxResults`, `timeoutMs` and download/extraction limits. `tool-literature.subagentProvider` applies only to the legacy subagent and defaults to `spawn`. Newer hosts use read-only extraction on the calling Agent's current model and explicitly reject custom legacy subagent providers. An omitted source list uses every registered available source; an empty list disables all sources.

The four source layers remain: `src/core` coordinates retrieval and extraction, `src/dblp` and `src/arxiv` implement sources, and `src/tool` integrates with DSH tools and Jobs. Public subpaths `/core`, `/dblp`, `/arxiv` and `/tool` include TypeScript declarations. The original five packages are consolidated into one independently versioned npm package.

Additional literature sources are planned, subject to further development. Only DBLP and arXiv are supported today; new sources will also need identifier, citation and full-text fallback rules and tests.

Regular checks use synthetic data without remote literature or model calls. `npm run test:live` separately runs external-service performance checks and is excluded from CI. See the [package maintenance guide](../../docs/PACKAGES_EN.md). Report issues and contribute through [EduWork](https://github.com/ECNU/EduWork/issues).

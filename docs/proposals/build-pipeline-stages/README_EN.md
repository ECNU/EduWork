# Declarative desktop build pipeline

[简体中文](README.md) | **English**

Status: implemented on this branch and verified end to end on macOS arm64, not yet merged upstream. The Windows x64 chain is rewritten against the same declarations but cannot be executed on macOS and must be accepted on a Windows runner. This document covers the goals, the design as built, and what is explicitly out of scope.

## Goal

Turn the desktop build from a sequence of PowerShell steps into a **build declaration a machine can read**: each stage states what it needs, what it produces, and which parameters change its result. The point is to make a rebuild predictable — knowing which stages rerun, why, and how much can be skipped — rather than relying on a script document that a person has to read.

The starting point was a review verdict: this is "a working pipeline, not a maintainable build system." The cost is measurable: changing one line in `product.mjs` meant a full rebuild of over ten minutes, when correct dependency tracking should make it about two.

## The problems

The pipeline (unchanged in shape by the earlier PowerShell-to-Node port) ran every step in one script, in a fixed order, to the end. Four concrete consequences:

1. **No declared dependencies.** The order was hardcoded, so nothing said why one stage had to follow another; changing it meant reading the whole script.
2. **No checkpoint.** Every run started from zero, even one repeating a run that had just succeeded with identical inputs.
3. **Repeated downloads.** Hash-pinned assets were re-fetched every run, including the toolchain and the speech model.
4. **Serial execution.** Stages with no dependency on each other (Web assembly, native inputs, the Electron runtime download) still waited in line.

## Design

### A stage is a declaration

Each stage declares four things: `requires` (hashed dependencies — changing one invalidates the stage), `dependsOn` (ordering edges only), `outputs` (artifacts, recorded by content digest), and `mutableOutputs` (artifacts this stage creates that a later stage appends to). The runner orders them from that, decides whether to skip, and reports an artifact modified behind its back instead of silently accepting it.

The `requires`/`dependsOn` split is deliberate: the first feeds invalidation, the second only says "after". "Must have finished before I read it" and "if it changes I must rerun" are different claims, and conflating them causes either over-rebuilding or missed rebuilds.

### Checkpointing

At the end of a run the runner records each stage's parameter digest, dependency digest and artifact digests. A later run skips a stage when all three match and the artifacts are still present. **A missing artifact is an error**, not something to trust the record about — the value of a checkpoint lies in its ability to notice it has gone stale.

A change to the parameter snapshot invalidates the whole checkpoint, so a new result is never reused under old parameters.

### Artifact ownership

An artifact may be created by exactly one stage. The runner enforces this rather than merely documenting it. It is what decides which stages must serialize.

`product/` is the one tree several stages touch: created by `product`, appended to by `install-host` and `native-install`. The rule that follows is that **any stage that changes an existing artifact runs after every reader of that artifact**. `product` declares the whole tree mutable (verified to exist, not to match bytes); the stages that append declare only the paths they write.

This rule came out of a real verification failure: `product` first declared `product/assembly.json` as an immutable output, while `install-product-host` legitimately rewrites it when recording the adapter it installed, and re-entry correctly reported `EDUWORK_MODIFIED_ARTIFACT`. That is precisely what `mutableOutputs` is for.

### Two cache layers

Native inputs do two expensive things of quite different kinds, so they get separate layers:

- **Download layer**: addressed by the pinned SHA-256, so a hit skips the network entirely. **An unpinned download is deliberately not cached** — without a hash there is no key, and storing an unverified response would be a way around the pin. A corrupt entry is discarded rather than served.
- **Compile layer**: addressed by source archive, patch set, target triplet and resolved tool versions. A toolchain upgrade must invalidate it, because silently reusing objects another compiler produced is the failure this exists to prevent. A restored entry is re-hashed against its manifest before admission, so the cache cannot be a channel for different bytes.

Both live under the system temporary directory by default, never inside the repository: the source audit rejects generated content, and a cache inside the working tree turns one build into the next one's failure.

### Parallelism derived from the graph

`parallelSets` computes the waves from the declared edges (everything in a wave can run at once; each wave depends only on earlier ones) and `maxParallelism` returns the widest. No run can finish sooner than that, so it is the default: `--jobs 0` means "as wide as the graph allows", and an explicit number still wins.

The current width is 2. That is an honest result rather than a defect: `desktop` needs `shell`, `electron`, `install-host` and `native-install` all finished, and the product tree serializes most of the rest.

### Platform differences by injection

Platforms no longer branch on `if (isMacOS)`; each supplies its own stage catalog. `shared-desktop-stages.mjs` is the spine every platform shares, and `macos-stages.mjs` / `windows-stages.mjs` add what each needs. The release orchestrators contain no platform branch at all — only argument validation, workspace entry and the receipt.

### A preflight ahead of the expensive work

Tools, directories, upstream cache integrity and pinned-URL reachability are checked before anything costly runs. The checks report and never repair: a half-installed cache is usually recoverable by reinstalling, and deleting someone's cache is not the script's decision. The tool probe treats only `ENOENT` as absent — `ditto --help` and `codesign --version` both exit non-zero on a healthy macOS, so a non-zero exit is not evidence a tool is missing.

## Verification

The refactor was checked by golden comparison against the pre-refactor pipeline, not by unit tests alone:

| Run | Result | Wall clock |
| --- | --- | --- |
| Baseline (`b2a398c`) | passed | 7m37s |
| Refactor, first run | passed | 3m27s |
| Refactor, second run | every stage skipped | 34s |

The second run's ZIP is byte-identical to the first and the receipts differ in no field. Across all three runs the check list, native runtime versions, browser version, Python import list and acceptance verdict match exactly.

The comparison caught two real defects no unit test would have found (the Python symlinks and the `assembly.json` ownership), both now fixed.

### Known limitation: not byte-reproducible

**The pipeline is not byte-reproducible, and was not before this work either.** Two builds of the same commit differ in roughly 200 files, because of embedded absolute paths (pip's `direct_url.json`, console-script shebangs, esbuild `//#region` comments), an `assembledAt` timestamp, and ad-hoc code signatures. The pre-existing build in `dist/` differs from the new baseline in the same 187 Python files for the same reason.

Byte-identical output would require normalizing paths and timestamps before packing. That is a real but separate hardening task, out of scope here.

## Layering

Split into independently reviewable layers, one PR each:

| Layer | Content | Status |
| --- | --- | --- |
| L1 | Source-audit overflow fix (iterative walk, generated-directory pruning) | implemented |
| L2 | Stage runner, checkpointing, macOS and Windows stage catalogs | implemented; macOS verified end to end |
| L3 | Two-layer native input cache | implemented |
| L4 | Parallel-set derivation and the concurrency default | implemented |
| L5 | Diagrams generated from the stage declarations | implemented |
| Preflight | Tool/directory/cache/URL checks, speech model download moved earlier | implemented |

## Out of scope

- **GitHub Release upload.** This pipeline only builds and installs locally; publishing is a separately authorized flow.
- **Windows x64 package acceptance.** That chain cannot be built on macOS. It is rewritten against the same declarations but has **never been executed**; the code says so, and it must be accepted on a Windows runner before anyone relies on it.
- **Byte reproducibility.** See above.
- **Linux desktop packages.** Linux currently covers Web assembly and Host validation only.

## What stays PowerShell

Changing these is out of scope: `assemble-wails-bridge`, `pack-wails-bridge`, `test-update-compat-local`, `pack-migration-release`, the dot-sourced helpers, both `speech.ps1` files, and `tests/desktop-window-icon.ps1`.

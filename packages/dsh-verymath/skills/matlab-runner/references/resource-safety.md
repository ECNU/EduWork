# Resource Safety Reference

> Path note: this file is addressed from `SKILL.md` as `./references/resource-safety.md` and must be resolved relative to the directory containing that loaded `SKILL.md`.

Load this reference only for tasks involving memory, large arrays, Monte Carlo simulations, batching, long runtimes, large outputs, spectral computations, or resource-feasibility decisions.

## Assess before allocating

Before a potentially large computation:

1. calculate the minimum primary-data size;
2. identify the computational order and output volume;
3. determine whether MATLAB environment measurements are required;
4. distinguish primary storage from additional working memory;
5. keep runtime feasibility separate from memory feasibility.

Do not create data or start a computation when a lightweight assessment already indicates serious risk of exhausting memory, freezing the system, or producing impractically large work.

## Exact storage versus peak working memory

Exact storage may be reported only for arrays whose element count and data type are known.

For example, `N` two-dimensional double points require at least:

```text
N × 2 × 8 bytes
```

This is the coordinate storage only. Peak working memory may additionally include:

- temporary arithmetic arrays;
- logical masks;
- copies created by expression evaluation;
- solver workspaces;
- returned results;
- file buffers and serialization overhead.

Do not label one input array or one batch's coordinates as the total peak memory. Unless measured or rigorously bounded, describe peak working memory as unmeasured and larger than the known primary storage.

## Official Windows MATLAB memory inspection

When the user asks for `MaxPossibleArrayBytes`, `MemAvailableAllArrays`, `MemUsedMATLAB`, or a Windows MATLAB memory-safety decision, use the official interface:

```matlab
m = memory;
```

Read these fields from the returned MATLAB structure:

- `m.MaxPossibleArrayBytes`
- `m.MemAvailableAllArrays`
- `m.MemUsedMATLAB`

Do not substitute:

- Java preferences;
- `ArraySizeLimit`;
- undocumented internal APIs;
- registry or environment values;
- static configuration limits.

`MaxPossibleArrayBytes` is the upper bound MATLAB reports for the largest array it can create at that time. It is not physical RAM.

Have MATLAB print raw bytes and requested decimal-GB and binary-GiB conversions in the same successful lightweight call.

If a required field is missing, empty, zero, nonfinite, or implausible:

1. confirm the official `memory` interface and correct field were used;
2. run one minimal official recheck when safe;
3. if no valid value is obtained, report that the environment measurement is unavailable;
4. do not compute a misleading ratio or infer “unlimited” or “not configured.”

## Units

Use consistent labels:

- decimal GB: bytes divided by `1e9`;
- binary GiB: bytes divided by `2^30`.

Prefer MATLAB-generated conversions in the same call. Copy the printed values and labels accurately.

## Batching and Monte Carlo

A chunked design can make memory usage bounded without making total work small.

- State the exact coordinate storage for one batch when known.
- State that derived arrays and temporary values add unmeasured overhead unless measured.
- Keep only accumulators when the task does not require retaining all points.
- Do not run demonstration batching code when the user asked only to see it.
- Do not give a concrete per-batch or total runtime without an authorized benchmark or other defensible evidence.
- “Memory-bounded” is not the same as “safe,” “fast,” or “practical.”

## Large outputs

Avoid printing or returning complete large arrays. Prefer:

- dimensions;
- minima and maxima;
- means and standard deviations with stated conventions;
- selected entries;
- residuals;
- counts and checksums;
- saved-file paths when output was explicitly requested.

## Spectral and sparse alternatives

Suggest alternatives only when mathematically appropriate:

- sparse storage for genuinely sparse data;
- operator forms when the algorithm supports them;
- `eigs` for a small subset of eigenvalues;
- chunked accumulation when all samples need not be retained;
- lower precision only when accuracy requirements allow it.

Do not imply that streaming can recover the complete spectrum of an arbitrary dense matrix, or that sparse storage helps dense random coordinates.

## Runtime claims

No concrete runtime estimate is supported merely because a loop count is known.

If runtime matters:

- run a small benchmark only with user authorization;
- make clear that extrapolation can be unreliable;
- otherwise state that the total work is large and runtime was not measured.

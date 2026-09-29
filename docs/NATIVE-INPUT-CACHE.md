# Native input caching (L3)

Two layers, both keyed by content, neither inside the repository.

## Why two layers

`native-inputs` currently costs minutes on a cold machine and seconds when the
workspace happens to survive. It does two very different kinds of work:

1. **Download** — Node, private Python, Office wheels, Chromium, OpenSSL
   tarball, whisper.cpp tarball, the speech model and licences. Network-bound,
   and identical across every build on every machine with the same lock.
2. **Compile** — OpenSSL `perl Configure && make && make install_sw`, and
   whisper.cpp `cmake --build --target whisper-cli`. CPU-bound, tens of
   seconds each, and a pure function of the extracted sources plus the
   toolchain.

Caching them together would throw away the compile whenever a download is
re-fetched, and the download whenever anything else changes. They get separate
layers with separate keys.

## Layer 1 — download cache

A single hook in `download()` (`scripts/lib/build-util.mjs`), which every
downloader already funnels through — macOS `downloadAsset()`, the speech model,
both licences, and the whole Windows prepare path.

- Key: the pinned SHA-256, which is also the integrity check.
- Layout: `<cache-root>/downloads/<sha256[0:2]>/<sha256>`.
- Hit: copy to the destination, no network. Miss: fetch, verify, then store.

Keying on the hash rather than the URL is deliberate: two URLs for the same
bytes share an entry, and a URL that starts serving different bytes cannot
poison the cache — the mismatch throws, exactly as it does today.

A download that omits `sha256` (the two licence files) is **not** cached. There
is no key to trust, and inventing one would let an unverified response persist.

## Layer 2 — compile-output cache

Keyed by everything that can change the output:

```
sha256(source archive) + sha256(patch set) + target triplet + tool versions
```

`tool versions` means the resolved `cc`, `perl`, `cmake` and `make` versions,
probed once per run. A Homebrew cmake upgrade changes the key; that is correct,
even though it costs a rebuild — silently reusing an object built by a different
compiler is the failure mode this is meant to prevent.

Layout: `<cache-root>/objects/<key>/…`, stored as the finished product (the
installed `openssl/` tree, the single `whisper-cli` binary), never as an
intermediate build directory.

- Hit: copy the stored tree into `inputs/`, then re-verify every recorded file
  hash before admitting it. A cache entry that fails verification is discarded
  and rebuilt, not trusted.
- Miss: build as today, then store.

## Cache root

Default `/tmp/eduwork-native-cache` on POSIX and
`<realpath(%TEMP%)>/eduwork-native-cache` on Windows. Overridable with
`--cache-root <dir>`, which is threaded through the same argument plumbing that
already carries `--runtime-source`.

`EDUWORK_TMPDIR` relocates the whole temporary root, and `EDUWORK_CACHE_ROOT`
overrides the cache directory outright; `--cache-root` sets the latter.

**Why not `$TMPDIR` outright.** `tmpdir()` resolves to `$TMPDIR` on POSIX, and on
a GitHub-hosted runner that is `RUNNER_TEMP` — emptied at the start of every job
and destroyed when the job ends. A cache there never survives long enough to be
used, in the one environment where a cold cache costs the most. A flat `/tmp`
path is what most people mean by "the temporary directory": it is stable between
local runs and is not per-job. Callers that need a durable cache on CI should
either set `EDUWORK_TMPDIR` to a path they persist (for example with
`actions/cache`) or pass `--cache-root`.

It is never inside `coreRoot`. The source audit walks the repository and rejects
generated content — the `dist/dsh-cache` incident showed exactly how a harmless
cache turns a passing audit into a failing one. Keeping the cache outside the
tree makes that class of mistake impossible rather than merely unlikely.

## Concurrency

Two builds may run on one machine. Every write goes to a temporary directory
beside the destination and is renamed into place, so a reader sees either
nothing or a complete entry. Layers are content-addressed, so two writers racing
on the same key produce identical bytes; last rename wins and both are correct.

## What this is not

- Not the stage checkpoint. The checkpoint decides whether a stage runs at all;
  the cache decides how much work a running stage has to do. They compose: a
  stage that must run because a parameter changed still gets cheap downloads.
- Not a substitute for the pins. Every cache read is verified against the same
  SHA-256 the uncached path would have checked.

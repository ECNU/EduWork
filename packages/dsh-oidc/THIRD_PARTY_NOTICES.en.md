# Third-party notices

[简体中文](THIRD_PARTY_NOTICES.md) | **English**

`dsh-oidc` is MIT-licensed and interoperates with the following directly declared packages. Exact versions are recorded in `package-lock.json`; transitive dependency license files remain in their distributed packages.

## Runtime peers (not copied into this repository)

- DeepSeek Harness packages `0.1.5-rc.1` and `@deepseek-ai/cordis` `4.0.2` — MIT, Copyright (c) 2026 DeepSeek, <https://github.com/deepseek-ai/deepseek-harness>
- `@earendil-works/pi-ai` `0.85.1` — MIT, <https://github.com/earendil-works/pi>
- React `18.x` — MIT, Copyright (c) Facebook, Inc. and its affiliates, <https://github.com/facebook/react>

This repository uses public package APIs and does not vendor their source. Their presence as peer dependencies does not imply endorsement of this project.

## Code embedded in the browser artifact

The generated `lib/client.js` bundles Zod:

### Zod 4.4.3

MIT License

Copyright (c) 2025 Colin McDonnell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Source: <https://github.com/colinhacks/zod>

## Development-only tools

The lock pins the RC.1 DSH test closure plus tsdown (MIT), TypeScript and Playwright Core (Apache-2.0), Ajv (MIT), YAML (ISC), and React types (MIT). Development tools are not copied into the published runtime files. Playwright Core does not download browser binaries during installation.

The current lock flags two lifecycle scripts: `@google/genai@1.52.0` has an echo-only preinstall; `protobufjs@7.6.6` reads local package manifests and may emit version-scheme warnings. Its reviewed postinstall contains no download or process execution. The local npm allow-scripts policy left these scripts unapproved; review them again when the lock changes. A successful install is not a security-audit result.

`fast-sha256@1.3.0`, reached through pi-ai → Anthropic SDK → standardwebhooks, declares Unlicense. Its distributed LICENSE grants copying, modification and distribution and disclaims warranty. The license check records a package/version-specific exception, not a blanket waiver for unknown licenses; no source is copied into this repository.

The reviewed lock has 260 licensed package entries: 0BSD (1), Apache-2.0 (46), BSD-3-Clause (12), ISC (2), MIT (197), Python-2.0 (1), Unlicense (1). Regenerate this inventory for the final release lock.

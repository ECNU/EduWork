# Third-party notices

[简体中文](THIRD_PARTY_NOTICES.md) | **English**

`dsh-oidc` uses Mulan PSL v2 for original contributions and preserves historical MIT grants ([scope](LICENSING.md)) and interoperates with the following directly declared packages. Exact versions are recorded in `package-lock.json`; transitive dependency license files remain in their distributed packages.

## Runtime peers (not copied into this repository)

- DeepSeek Harness packages and `@deepseek-ai/cordis` — MIT; development baseline `0.2.2-rc.2` / `4.1.0`, with supported host ranges in `package.json`. Copyright (c) 2026 DeepSeek, <https://github.com/deepseek-ai/deepseek-harness>
- `@earendil-works/pi-ai` `1.1.0` — MIT, <https://github.com/earendil-works/pi>
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

The lock pins the DSH 0.2.2-rc.2 test closure plus tsdown (MIT), TypeScript and Playwright Core (Apache-2.0), Ajv (MIT), YAML (ISC), and React types (MIT). Development tools are not copied into the published runtime files. Playwright Core does not download browser binaries during installation.


`fast-sha256@1.3.0`, reached through pi-ai → Anthropic SDK → standardwebhooks, declares Unlicense. Its distributed LICENSE grants copying, modification and distribution and disclaims warranty. The license check records a package/version-specific exception, not a blanket waiver for unknown licenses; no source is copied into this repository.


The development-only official DSH Host includes LibreOffice Kit 0.2.3 (MPL-2.0), sharp/libvips native packages (Apache-2.0 / LGPL-3.0-or-later), and lru-cache 11.5.3 ([Blue Oak Model License 1.0.0](https://blueoakcouncil.org/license/1.0.0)). These packages are installed separately for Host tests and are not bundled in this plugin archive; their own license files remain with their packages. Checks accept only the reviewed development-dependency versions.

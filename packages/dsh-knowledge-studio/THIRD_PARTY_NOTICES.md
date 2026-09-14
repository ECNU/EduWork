# Third-party notices

The project contains MIT-licensed original code and Office/video implementations extracted from ChatECNU Work (copyright ECNU contributors). Existing copyright notices and compatibility markers are preserved. No institution logos, credentials, model weights or third-party recordings are included.

The client bundles Markdown/rendering utilities and Zod; PDF extraction bundles unpdf (MIT, copyright Johann Schopplich) and PDF.js (Apache-2.0, copyright Mozilla Foundation). Full license texts for these bundled JavaScript dependencies are collected in `THIRD_PARTY_LICENSES.txt`. PDF.js is redistributed under Apache-2.0, not relicensed as MIT. The generated bundles adapt loading and environment setup for this plugin.

LadybugDB platform packages (MIT) supply the native database. DSH 0.1.5-rc.1 packages are host peers. Their package contents and licenses remain in their own distributions. React/React DOM (MIT), Playwright Core and Chromium (their respective upstream licenses) also retain their own terms.

The separate artifact services package owns Remotion 4.0.520 and its renderer, bundler, media and captions packages. Remotion uses its own license and commercial-use terms; this repository's MIT license does not override them. The Remotion compositor/FFmpeg binaries and Chromium retain their bundled third-party notices. See the shared package's `THIRD_PARTY_NOTICES.md`.

Python dependencies are provisioned separately and listed in `packages/artifact-services/python/requirements.txt`: python-docx, openpyxl, python-pptx, pypdf, ReportLab and Pillow. Each retains its license. Office creation uses the shared Python source; JSZip and direct Python library calls independently inspect or construct test fixtures.

Six included instrumental cues use original AI-assisted scores and deterministic synthesis without third-party audio samples. The music's provenance and applicable MIT grant are recorded in `packages/artifact-services/media/BGM-USAGE.md`; AI generation is not treated as a waiver of copyright. Studio SVG icons are project-authored; no NotebookLM icon or font assets are copied.

Exact npm dependency versions are in `package-lock.json`. Run `node scripts/generate-licenses.mjs` after changing bundled dependencies and retain the collected license text in the published Studio package.

# Official Office workflows

[简体中文](OFFICE_PROCESSING.md)

The Word, Excel and PowerPoint skills retain their `artifact-documents`, `artifact-spreadsheets` and `artifact-presentations` IDs and saved enablement preferences. When the host provides the official Office packages, they load that installed version's original workflow and resource directory, with a small EduWork integration note. No copied upstream skill is maintained. Project and user skill overrides remain intact.

## Legacy files

| Input | Read | Convert before editing | Conversion outputs |
| --- | --- | --- | --- |
| DOC / DOCX | `office_document` inspect | DOC → new DOCX | DOCX, PDF |
| XLS / XLSX | `office_spreadsheet` inspect | XLS → new XLSX | XLSX, PDF |
| PPT / PPTX | `office_presentation` inspect | PPT → new PPTX | PPTX, PDF |

Legacy inspection uses an official LibreOffice Kit conversion in a temporary directory, removed after reading. It neither changes the original nor leaves conversion files in the workspace. For edits, convert to a new modern-format file, inspect it, then edit using the official workflow. Outputs never overwrite existing files. The Kit does not export DOC/XLS/PPT. Only genuine OLE legacy inputs are supported; HTML/RTF renamed to DOC, encrypted inputs and damaged files report their actual errors.

Example `office_document` call:

```json
{"action":"convert","input_path":"source.doc","output_path":"editable.docx"}
```

Excel `recalculate` uses the official Kit and requires distinct XLSX input/output paths. Check formulas and cached values afterward; successful recalculation does not validate business logic.

## Conversations and Studio

Flexible authoring and editing follow the official skills with configured Python libraries and checks. Existing `office_*` tools remain deterministic adapters for structured requests and Studio specifications. Normal modern-format validation uses official `check_office.py`; legacy conversion, recalculation and Office-to-PDF export use the official Kit.

Studio keeps editable outputs, citations and speaker notes through the shared adapter. PDF export converts the saved DOCX/XLSX/PPTX, including later edits, rather than rebuilding HTML. Conversion failure is reported without selecting another renderer. Each PDF export creates a separate result, so repeated downloads neither overwrite existing files nor serve stale conversions. Non-Office HTML/PDF exports are outside this migration.

Existing workspace permissions apply. A standing write grant is reused; read-only mode requires host approval for conversion outputs, and rejection cannot be bypassed with scripts. Relative and canonical paths must remain within the authorized workspace; external symlinks/junctions are rejected.

## Host integration

Provide `@deepseek-ai/dsh-skill-office` and `@deepseek-ai/libreoffice-kit` in the host's locked runtime. EduWork uses its pinned DSH Runtime packages; the current combination is DSH `0.2.0-rc.2` and Kit `0.1.2`. These are optional host capabilities, not another engine bundled into this package.

`DSH_MEDIA_NODE_ENV` can select the host Node project directory; otherwise normal package resolution applies. `DSH_OFFICE_PYTHON` selects Python with the Office libraries. A Node Host uses its own executable; direct Electron/SEA embeddings must configure a standalone executable through `DSH_OFFICE_NODE`. No PATH search, download or system LibreOffice fallback is performed.

Older hosts without these packages retain structured creation, editing, validation and browser-based PDF export, but do not provide the new legacy reading/conversion or recalculation. EduWork's current Runtime uses the official workflows. Broken installed resources and execution failures never silently fall back. Template-only `strict` validation still uses the product template checker; ordinary external documents do not require branding markers.

Structural validation is not visual fidelity acceptance. Lossless preservation of complex revisions, macros, animations or all Excel features is not promised.

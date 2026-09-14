# Workspace artifact preview and file intake

[简体中文](README.md)

Session-scoped, workspace-confined inline preview and file-reveal remote. It
supports bounded images, audio, PDF, text/code, isolated HTML and product-owned
DOCX/XLSX/PPTX previews. Office files are converted to static HTML through the
existing private Python office runtime and rendered by the packaged browser;
no host Office installation or external upload is used. Reveal asks the
operating-system file manager to select the
validated file. Both operations resolve the target against the session
workspace and reject paths outside it; the browser never supplies an arbitrary
root.

Desktop assembly uses the native-opener extension point of DSH's
`SessionController` to share the Windows Explorer implementation between the
official deliverables menu and this module. Official session RPCs and the
default-application opener remain unchanged. Windows uses quoted native paths
and waits for Explorer to finish its handoff, including filenames with Unicode,
spaces and commas. The official menu retains upstream behavior on macOS/Linux.

For native regression acceptance, set `EDUWORK_TEST_PRODUCT` to an assembled
desktop's `resources/product` and `DSH_HOST_SOURCE` to the pinned DSH source
checkout, then run `node --test dsh-host/test/native-reveal.integration.test.mjs`
from the repository root. It invokes the real Host RPC, verifies Explorer's
selected temporary file and closes only its test window. Ordinary CI does not
run this interactive desktop check.

The same workspace-bounded remote accepts files selected, pasted or dropped in
the conversation composer. It stores them below `.chatecnu/attachments/` with
exclusive collision-safe names and returns relative paths for DSH's native
`@file` grammar. No binary file block is added to session history or model
requests. Desktop files arrive through a Wails-created, application-private,
single-use grant and are copied with the operating system rather than encoded
into Remote JSON. Each file is limited to 64 MiB, each batch to 20 files and
128 MiB as bounded local I/O and workspace-growth guardrails, not model-context
limits. The development browser fallback is restricted to 4 MiB because that
legacy path still uses JSON/Base64. Invalid grants/Base64, path escapes and
symlinked attachment directories are rejected.

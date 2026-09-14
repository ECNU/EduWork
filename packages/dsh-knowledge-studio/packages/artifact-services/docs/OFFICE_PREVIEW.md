# Shared Office file preview

Studio and conversation attachments use the same conversion service and browser viewer. The saved Office file is the input. Slide plans and model output are not alternative preview sources; reading, paging and zooming never invoke a model or generate another Office file.

Studio reports, data tables and slides all request the saved DOCX, XLSX or PPTX through this service, including reopened older artifacts without preview sidecars. The source hash changes when the actual file changes. HTML/PDF exports reuse an existing Office file when one is available. A failed or missing file remains a failed preview and offers retry or download; stored draft text is not presented as the file.

## Service

```js
import {renderOfficePreview} from '@eduwork/dsh-artifact-services/office-preview'

// First apply the application's workspace/path authorization.
const preview = await renderOfficePreview(authorizedFilePath, signal)
```

The existing `html` and `bytes` fields are preserved. `description` adds:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1` |
| `kind` | `slides` for PPTX fixed pages; `document` for other Office HTML |
| `sourceHash` | SHA-256 of the exact input bytes |
| `rendererVersion` | Conversion contract revision and renderer source hash |
| `fontFingerprint` | Fingerprint of runtime/font configuration, without exposing paths |
| `cacheKey` | Source content, renderer, font configuration and file extension identity |
| `pageCount`, `pageWidth`, `pageHeight` | Total slide count and actual page size in logical pixels at 96 dpi; `null` for non-slide documents |
| `warnings` | `{code, message}` conversion limitations, including objects outside the slide body |

Each request reads the current file before using an in-memory cache; callers must still check permissions. Identical bytes with a different filename reuse the same conversion identity. A private temporary copy makes the converter consume exactly the bytes that were hashed; it is removed after success, failure or cancellation. The bounded process cache retains at most eight previews and 64 MiB for five minutes. Failures are not cached. No conversion result or source document is stored in browser reading-state storage.

The runtime includes `DSH_OFFICE_FONT_FINGERPRINT`, `FONTCONFIG_FILE`, `FONTCONFIG_PATH`, the Python path, platform and locale in the font fingerprint. After changing installed fonts, the host should change `DSH_OFFICE_FONT_FINGERPRINT` or restart the conversion process. This configuration does not install fonts or add an external renderer.

## Browser component

```js
import {mountOfficePreview} from '@eduwork/dsh-artifact-services/office-preview-client'

const viewer = mountOfficePreview(container, {
  preview,
  title: 'Presentation',
  onExpand: () => openReadingArea(),
  onStateChange: state => rememberReadingActivity(state),
})

viewer.update({onExpand: undefined})
const state = viewer.getState()
viewer.destroy()
```

The browser entry has no Node, Python, React or media-runtime imports. Type declarations are included. Give the container an explicit height, at least 260 px. The shared component supplies page navigation, fit-page, fit-width, 100%, zoom buttons and an optional reading-area button. File opening, downloading and authorization remain in the application adapter. `update()` accepts partial options, including a new `preview`; `onError` optionally receives a display error.

DOCX/XLSX use a continuous document viewport with the same expand and zoom controls. Their original HTML layout stays in a 900-pixel logical viewport and scrolls inside the sandbox; zoom scales that viewport rather than reflowing text as the sidebar changes. Slide page navigation is hidden for continuous documents, because structural HTML cannot establish native Word pagination or Excel print pages.

Reading state is `{page, mode, scale}` with a one-based page and `fit-page`, `fit-width` or `manual` mode. Identical `cacheKey` values share state across independently bundled entry points in the same window and retain it across refresh through `sessionStorage`. Only page, mode and scale are stored. Manual zoom persists across containers; fit modes recompute their scale for the current viewport. New file bytes, renderers or font configuration reset the identity. Legacy HTML without a descriptor remains readable without a persistent cross-file identity.

PPTX pages are parsed from `main.slides[data-slide-width][data-slide-height][data-slide-count]`, with one `section.slide-wrap[data-slide-index] > div.slide` per available page. The viewer preserves slide markup, places a single page in a fixed-size iframe, and scales the entire iframe. It changes only outer page containers and hides converter headings/page labels. Paragraph wrapping and object coordinates are never adjusted to sidebar width. Only the selected page is serialized, avoiding duplication of large embedded-image style sheets for every slide.

The iframe retains an empty sandbox and a restrictive content policy: scripts, forms, child frames and external resources are blocked. Conversion warnings appear outside the page. A declared `page-limit` warning permits a partial preview while displaying both available and total page counts; unexplained missing pages fail visibly. Document HTML without slide metadata retains its existing isolated document view.

## Acceptance boundaries

Matching the two entry points does not establish fidelity to native Office. The current structural converter retains supported file geometry, explicit text properties and common objects, and reports unsupported objects. Compare the downloaded file against an independent document renderer before claiming visual fidelity. Browser-generated PDF inherits conversion limitations and is not an independent reference.

The parent repository's `office-preview-service.test.mjs`, `office-preview-client-smoke.mjs`, `office-preview-scaling-smoke.mjs` and `test:host:office` cover source identity, cache invalidation, immutable conversion snapshots, browser isolation, fixed page coordinates, cross-entry reading state and actual Studio downloads. The consuming application must also verify its conversation adapter with the same file.

## Host presentation

On the current official Sidebar, Studio and the consuming conversation UI use host fullscreen controls. Studio supplies no `onExpand` callback and registers no reading portal. The shared viewer’s optional callback remains an application extension point, not a required extra button. Keep download, system-open and file authorization in the caller. Official host document preview remains responsible for its ordinary document formats; use this component for Office files instead of replacing that host facility.

# Changelog

## Studio 0.5.0 / Artifact Services 0.2.0

- Studio pins Shared 0.2.0; both DSH integrations require official 0.1.5-rc.1. A stable plugin version does not imply a stable upstream host.
- Use the official Sidebar Start entry, tabs and fullscreen. Keep Wiki/infographics excluded, preserve historical data, and avoid duplicate reading overlays or cross-session state.
- Share Office generation and actual-file preview, TTS/ASR provider interfaces, media rendering and content guidance between conversation tools and Studio. Expose advanced editable-video and provider operations through the shared tools without inventing matching Studio cards.
- Retain six licensed 192 kbps MP3 BGM tracks, shared catalog IDs and loop/ducking behavior. Use one mediabunny 1.55.5 with Remotion 4.0.520; narration provider output remains WAV.
- Refresh installation, configuration, capabilities, licensing and publication documentation. Document platform requirements and the limits of macOS support.

## Studio 0.4.0 / Artifact Services 0.1.0

- Support DSH 0.1.2-rc.1 with matching package, client loader and Host/Client RPC identities under `@eduwork`.
- Provide eight workspace-driven Studio capabilities, optional local indexing/Wiki, collapsible controls and full reading mode.
- Share Office, TTS provider registration, captions, BGM and Remotion between Studio and dialogue tools.
- Preserve settings namespaces, workspace knowledge, artifacts and learning progress from development builds.
- Resolve PDF browsers and video-poster FFmpeg through the shared package, including isolated dependency installations and managed runtimes.
- Render report HTML/PDF with the same headings, formatted text, tables and reference appendix as the shared DOCX specification.
- Replace institution-specific starter narration defaults and recovery messages with portable configuration.
- Establish a reviewed public source snapshot, package auditing, cross-platform CI and manual packaging/publishing workflow.
- Document generic themes and externally supplied legacy branding; use neutral examples and links that also work in each npm package.

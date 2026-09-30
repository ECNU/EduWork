# Configurable OpenAI-compatible media

[简体中文](README.md)

Registers configured image and TTS providers in Artifact Services, so conversations and Studio share tools, skills and previews. There are no built-in institution service defaults in this module.

See [media configuration](../../docs/MEDIA.md). This is a product-owned internal adapter, not a separately published npm package. Host/Web use `lib/config.js`; desktop assembly copies the same configuration logic into `media-config.mjs`.

Shared tools and Studio use the same permission and cancellation boundary. Enterprise requests use the shared Host to validate the discovered API URL and authorize with the login Token, including refresh and logout isolation. They do not read legacy model keys or attach login Tokens to result downloads. Generated files are stored in `.eduwork/generated`. If image post-processing fails, preserve the original file and report the warning.

Providers may explicitly enable `images.edit:true` for standard multipart `POST /images/edits`; `images.editMaxImages` limits source count to 1–16 (default 1). The shared `image_edit` tool accepts real workspace PNG/JPEG/WebP files and an optional matching PNG mask, uses the same personal-key or OIDC authorization, saves a new image and preserves originals. Workspace write permission applies to editing as well as generation.

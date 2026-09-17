# Configurable OpenAI-compatible media

[简体中文](README.md)

Registers configured image and TTS providers in Artifact Services, so conversations and Studio share tools, skills and previews. There are no built-in institution service defaults in this module.

See [media configuration](../../docs/MEDIA.md). This is a product-owned internal adapter, not a separately published npm package. Host/Web use `lib/config.js`; desktop assembly copies the same configuration logic into `media-config.mjs`.

Shared tools and Studio use the same permission and cancellation boundary. Enterprise requests use the shared Host to validate the discovered API URL and authorize with the login Token, including refresh and logout isolation. They do not read legacy model keys or attach login Tokens to result downloads. Generated files are stored in `.eduwork/generated`. If image post-processing fails, preserve the original file and report the warning.

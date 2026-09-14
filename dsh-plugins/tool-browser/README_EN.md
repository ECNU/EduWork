# EduWork managed browser and search provider

[简体中文](README.md)

The `/search-auto` entry is selected as `web.searchProvider: eduwork-search`
in both distributions. Each request resolves the official
`web-search-deepseek` settings and credential reference (default
`DEEPSEEK_API_KEY`). A configured key uses DSH's original
`DeepSeekSearchProvider`; an absent key goes straight to browser search.
Adding or removing a key affects the next request. Institution login does not
implicitly send `EDUWORK_API_KEY` to DeepSeek. A user may explicitly select a
different search credential reference in the official plugin settings.

The official provider's endpoint, model and limits remain configurable in
that same settings section. A configured provider's authentication or network
failure stays visible; it is not mistaken for an absent key.

The package's `/search-provider` entry publishes ChatECNU Work's credential-free
Bing/Baidu search route as a profile-scoped provider on DSH's official `ctx.web`
seam. DSH's official `web_search` Tool, prompt guidance and result card remain
the model and UI owners.

The main entry retains the DSH-native interactive browser execution surface. It uses a
separate Playwright profile and the locally installed Edge/Chrome executable.
Interaction, visible mode and private-network targets pass through DSH
permission presets. Ordinary search belongs to `web_search`, not this browser
Tool.

The Tool intentionally exposes no arbitrary JavaScript execution. Returned page
content is labelled as untrusted data before it is rendered into the Agent turn.

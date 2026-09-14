# 浏览器与联网搜索

[English](README_EN.md)

提供免 Key 的浏览器搜索，并在配置 DeepSeek 凭据时复用官方搜索 Provider。`/search-auto` 将 `web.searchProvider` 设为 `eduwork-search`。

## 搜索路由

- 配置官方 DeepSeek 搜索凭据时，使用官方 DeepSeek Provider；默认凭据引用为 `DEEPSEEK_API_KEY`。
- 未配置时，使用 Bing/Baidu 浏览器搜索 Provider，经 `ctx.web` 接入官方 `web_search`，保留其提示词与界面。
- 凭据或配置变更从下次请求生效。企业 `EDUWORK_API_KEY` 不会自动当作 DeepSeek Key；管理员可显式配置凭据引用。
- 官方端点、模型与限制沿用官方配置。已配置 Key 后的认证或网络错误会正常显示，不悄悄换成浏览器结果。

## 交互浏览器

交互浏览器使用独立 Playwright Profile 和本机 Edge/Chrome，遵守可见浏览器与私有网络访问权限。常规检索优先使用 `web_search`。

不提供任意 JavaScript 执行接口。网页返回内容均视为不可信资料，不能成为 Agent 指令。

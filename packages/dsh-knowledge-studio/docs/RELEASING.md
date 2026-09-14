# npm 包发布

Studio 和共享服务的源码、Issue、PR 与发布流程统一在 EduWork。两包保持独立名称、版本和 tarball，公共流程见[包维护与发布](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES.md)（[English](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES_EN.md)）。

- 开发根为 EduWork/packages/dsh-knowledge-studio，保留已有 packages/artifact-services workspace。
- 独立发布分别选择 dsh-artifact-services 和 dsh-knowledge-studio；共享服务先发布并核验，Studio 后发布。
- CI 使用根目录 .github/workflows/packages-release.yml，默认只打包。需发布时从对应包的版本 tag 运行，npm Trusted Publisher 绑定 ecnu/EduWork、packages-release.yml、npm environment。
- npm run check、test:ui、test:host、test:exports 等专项验收仍可在当前开发根运行，按实际修改选择。Office 验收需先配置对应 Python 环境，浏览器验收需准备 Chromium。
- 工作流不创建桌面 Release，不部署 current，不修改产品的 npm 锁。

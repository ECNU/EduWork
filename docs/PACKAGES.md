# 包维护与发布

**简体中文** | [English](PACKAGES_EN.md)

EduWork 在一个仓库维护公共插件，npm 包仍分别安装、版本管理和发布。Issue、PR、协议和开发文档统一在 `ecnu/EduWork`；机构专属实现留在 EduWork-ECNU。插件可被其他 DSH 应用单独使用，不需要安装 EduWork 桌面端。

## 源码布局

| npm 包 | 源码与说明 | 开发安装根目录 |
| --- | --- | --- |
| `@eduwork/dsh-literature` | [文献检索、引用与全文](../packages/dsh-literature/README.md) | `packages/dsh-literature` |
| `@eduwork/dsh-oidc` | [身份、凭据与模型接入](../packages/dsh-oidc/README.md) | `packages/dsh-oidc` |
| `@eduwork/dsh-memory` | [本地记忆与历史检索](../packages/dsh-memory/README.md) | `packages/dsh-memory` |
| `@eduwork/dsh-mail` | [邮件助手](../packages/dsh-mail/README.md) | `packages/dsh-mail` |
| `@eduwork/dsh-knowledge-studio` | [Studio](../packages/dsh-knowledge-studio/README.md) | `packages/dsh-knowledge-studio` |
| `@eduwork/dsh-artifact-services` | [Office、语音、图像与媒体服务](../packages/dsh-knowledge-studio/packages/artifact-services/README.md) | 与 Studio 共用已有 workspace |

五个开发安装根分别保留自己的 `package-lock.json`，不把所有依赖提升到仓库根。Studio 保留已有 `packages/artifact-services` 子 workspace，两个包仍分别生成 tarball。其他包之间使用 npm 公开导出，不跨目录导入彼此的实现文件。

## 兼容声明与构建锁

`peerDependencies` 表示插件支持的宿主 API 范围；开发依赖、`package-lock.json` 和产品组件锁记录一次构建的确切输入，两者分别维护。对已验证兼容的同一 API 系列，peer 应使用有上下界的版本范围，避免逐个追加 rc 版本。范围需要检查预发布版本的匹配语义，并在支持范围内验证实际插件加载与工具调用；不能仅因版本号相邻就假定兼容，也不使用 `*` 跳过边界。

内核升级时先核对 API 与行为：兼容声明已覆盖且验证通过的包直接复用现有 npm 产物，不因宿主升级重发。若已发布包的声明过窄，修正元数据仍需新的 npm 版本，不能覆盖旧包，但这不应成为每次 rc 升级的固定步骤。当前文献包 `0.1.1` 仍按已发布的 rc.1／rc.2 声明使用；扩展范围须随该包后续经过验证的发布落地。

内置源码扩展目前在候选装配时重建，并将其 DSH peers 指向所用内核；这只说明该次装配经过验证，不能视作原 npm 包支持了新版本。对外发布时维护源 manifest 的真实兼容范围，不改写第三方包或配置兼容性豁免。

## 本地开发

Node 版本和 DSH 兼容范围以各包的 manifest 与锁文件为准；统一 CI 使用 Node 24.18.0。从 EduWork 根目录执行，以 OIDC 为例：

```sh
node scripts/packages/manage.mjs list
node scripts/packages/manage.mjs install dsh-oidc
node scripts/packages/manage.mjs check dsh-oidc
node scripts/packages/manage.mjs pack dsh-oidc
```

也可以进入包的开发根，使用原有 `npm ci`、`npm run build`、`npm test` 和专项验收命令。`pack` 使用已经构建的文件，不隐式重建；先运行 `check`。输出在 `dist/npm-packages/<包标识>/`，含 tarball、文件清单、版本、源码提交、脏目录标记和校验和。共享服务使用 `dsh-artifact-services` 作为选择标识，其检查同时覆盖 Studio。

Studio/共享服务的 Node 测试也会生成真实 Office 文件。先准备 Python 3.12+ 的独立环境，执行 `python -m pip install -r packages/dsh-knowledge-studio/packages/artifact-services/python/requirements.txt`，并将 `DSH_OFFICE_PYTHON` 环境变量设为该 Python 解释器的绝对路径。CI 会自动完成这一步；无需安装浏览器或登录任何企业服务。

自动检查只运行受影响的开发根。共享服务变更会连带检查 Studio；仅修改 Markdown 或文档图片时，只检查入口与链接。UI、真实服务登录、邮件、Office 与音视频全流程，按实际行为改动在本地做专项验收。普通 CI 不下载浏览器、不调用真实模型、不发布 npm 或桌面 Release。

## 六个独立的 npm 包

各包使用自己的 SemVer，保持现有包名、公开导出、配置标识和数据路径。每次发布使用新版本，不覆盖已经发布的版本。若共享服务版本变化，同步 Studio 的精确依赖与开发锁；先发布并核验共享服务，再发布 Studio。

唯一发布工作流为 `.github/workflows/packages-release.yml`（Actions 中的 **Package npm module**）。按包选择，默认 `publish=false`，只做构建、测试和打包。插件仅发布到 npm，不创建插件 GitHub Release 或 Git tag；GitHub 发布入口保留给桌面客户端版本。

真正发布时：

1. 确认该包的新版本、变更记录及相关本地验收；提交源码和 lock。
2. 将已审查的变更合入并推送到 `main`，记录准备发布的完整 40 位提交 SHA。
3. 在 **Run workflow** 的来源选择 `main`，将该 SHA 填入 `source_commit`，再选择包和 `publish=true`。工作流锁定触发时的提交；如果它与填写的 SHA 不一致，发布会停止，需要重新核对源码。稳定版本使用 `latest`，预发布版本使用 `dev`；产品版本号不参与 npm 版本判断。
4. 工作流构建并检查选定包，只发布同一工作流生成、校验通过的 tarball；发布 job 不重建、不执行包生命周期脚本。核验 npm 中的包版本、integrity 和 provenance 后，再更新客户端的精确依赖锁。

发布需要在 **每个 npm 包** 的 Trusted publishing 中设置 GitHub Actions：组织 `ecnu`、仓库 `EduWork`、workflow `packages-release.yml`、environment `npm`。GitHub 对应 environment 也叫 `npm`。此处带 provenance 的发布路径要求公开仓库和有效的绑定；仅检查打包时使用 `publish=false`。详见 [npm 官方 Trusted publishing 说明](https://docs.npmjs.com/trusted-publishers/)。

维护者可用 `npm trust list @eduwork/dsh-oidc --json` 检查绑定，其他包替换包名即可。调整仓库、工作流或 environment 时，先核对现有绑定，再创建新绑定并删除对应的旧绑定，不删除其他有效发布入口。npm 可能要求在系统浏览器完成账户验证。

不要保存长期 npm Token。若必须在完成 CI 发布验证前发布，由维护者在明确授权后用自己的 npm CLI 与交互验证发布已检查的 tarball；不能声称拥有 GitHub provenance。

## 客户端装配

`@eduwork/dsh-literature` 是面向 DSH `0.2.0-rc.2` 的独立包，fork 自 `SihanLv/dsh-literature`，由 EduWork 接续维护。0.2 候选装配从 npm 安装已发布的 `0.1.1`，版本、integrity、tarball SHA-256 和来源提交记录在 `third_party/dsh/candidate-v0.2.0-rc.2/literature.json`，不从源码覆盖该包。历史构建保留原 `@shlv/dsh-literature` 锁。

`config/assembly.eduwork.json` 仍通过 `third_party/npm-015-rc1/*/LOCK.json` 获取已发布 npm 包，版本、SRI 和 tarball SHA-256 都固定。编辑 `packages/` 不会自动混入 GitHub 桌面包；遵循[构建指南](BUILD.md)中的“发布插件 → 核验 registry → 更新锁 → 构建产品”顺序。开发根里的 workspace 链接不能作为正式客户端的发布凭据。

组件锁保存对应 npm 包的版本、来源提交和内容校验值。更新包时，核验 registry 中的实际产物，再同步锁文件；不要将开发目录的 workspace 链接作为发行输入。

# 构建 EduWork

本指南面向本机开发和桌面候选构建。桌面包由 Node.js 阶段流水线统一编排；Windows x64 与 macOS arm64 分别使用本机工具和原生资源。

## 选择入口

| 场景 | 入口 | 产物 |
| --- | --- | --- |
| 本机开发 | `node scripts/local-desktop-pipeline.mjs` | 当前平台的开发包，可选择安装 |
| main 更新后的 CI | `development-desktop.yml` | 双平台开发包 artifact |
| feature 分支验证 | 手动运行 `development-desktop.yml`，选择分支和 `platform` | 所选平台的开发包与验收报告 artifact |
| 手动候选 | `desktop-candidates.yml`，选择 `node` | 双平台候选 artifact；经授权可发布 GitHub Release |

手动候选使用 Product SemVer：`X.Y.Z` 为 stable，`X.Y.Z-alpha.N`、`-beta.N`、`-rc.N` 和 `-dev.YYYYMMDD.N` 为预发布。本 PR 不修改产品版本。发布说明须先经项目负责人确认并保存为 `docs/releases/<版本>.md`；CI 只读取该文件。发布须从 main 构建，两个平台都完成验收。[发行指南](RELEASE.md)说明后续人工验收和发布授权。

手动开发包验证不需要发行说明，也不会创建 Release。新 workflow 文件尚未进入仓库默认分支时，可运行已注册的 `desktop-candidates.yml`：选择 feature 分支、`build_mode=node`、`development=true`、开发版本及目标平台，并保持发布关闭、发行说明为空、审批未勾选。

## 本机构建

准备 Git、Node.js 24.18.0 和 Go 1.26.6。Windows 还需 Visual Studio 2022 Build Tools、x64 C++ 工具链、Windows SDK SignTool 和 VC++ Redist 输入；macOS 需 Xcode Command Line Tools 和 Python 3.10 或更新版本来制作 DMG。构建机要能访问锁定的 npm、GitHub 和原生资源。当前 Mac 为 macOS 27.0；macOS 15.4.1 与 27.0 的 Apple Silicon 候选装配和启动已有验证记录，实际覆盖范围以各次回执为准。

在仓库根目录运行：

```sh
node scripts/local-desktop-pipeline.mjs
```

入口从 `source-receipt.json` 取得基础版本并生成开发版，构建、检查并安装当前平台应用。`--skip-install` 只构建，`--install-root <目录>` 改变安装位置，`--workspace <目录>` 指定构建工作区。Linux 当前只做 Web 验证。

如需只生成某个平台的开发包，在对应系统上运行：

```sh
node scripts/ci-eduwork-windows-release.mjs --core-root . --edition-root . --distribution-config config/distributions/generic.json --version X.Y.Z-dev.YYYYMMDD.N --development --output ../eduwork-windows-dev
node scripts/ci-eduwork-macos-release.mjs --core-root . --edition-root . --distribution-config config/distributions/generic.json --version X.Y.Z-dev.YYYYMMDD.N --development --output ../eduwork-macos-dev
```

将示例版本替换为实际版本，输出目录须尚不存在。`publish/` 保存 ZIP、校验和与回执；macOS 另有 DMG，Windows 另有便携包。`evidence-public/` 保存可公开的检查报告。开发包只上传 artifact，不创建 Release。

当前 macOS 包与原 PowerShell 流程一样，仅使用本地 ad-hoc 签名，不需要 Developer ID 证书或公证。首次打开时可能需要在系统“隐私与安全性”中手动允许。后续若要取消这一步，需在受保护的发行环境中完成 Developer ID 签名、公证，并在目标系统验收 Gatekeeper；仅重新打包 DMG 不会解决信任提示。见 [macOS 支持](MACOS.md)。

## 候选构建做什么

本机开发包、自动开发包和手动候选的 Node 入口都按 `config/desktop-build.json` 选择同一锁定组合：从已校验的 npm 包准备 DSH `0.2.0-rc.2` Runtime，从锁定的上游提交构建 Host、Electron 壳和产品插件客户端，然后安装平台原生资源、打包并启动归档中的应用。保留的 PowerShell 候选也使用该组合；Node 负责阶段依赖、缓存和回执，不调用 PowerShell 脚本。[流程图](assets/build-pipeline.svg)和[流水线提案](proposals/build-pipeline-stages/README.md)给出阶段关系。

稳定版要求 Windows 更新契约及 macOS Sparkle 配置；预发布默认关闭软件自动更新。候选的 Windows ZIP 与安装包、macOS ZIP 与 DMG 都会校验哈希、归档内容和启动结果。macOS DMG 从通过 ZIP 验收的同一应用生成，挂载只读镜像后核对应用签名与内容。签名仍是 ad-hoc；系统权限、机构登录、升级体验等人工验收见 [发行指南](RELEASE.md)。

机构版使用相同 Node 入口，先检出 `core.lock.json` 指定的公版提交，再传入机构仓的 `--edition-root` 与 `--distribution-config edition/distribution.json`。公版构建跳过机构专属检查；机构版候选读取 `edition/desktop-build.json` 指定的签名配置描述文件，并检查首次启动激活。旧 PowerShell 候选另在配置了 `validationScript` 时执行机构仓的脚本；Node 流程不依赖该 PowerShell 文件，也不会把未执行的私有脚本记为已验收。私有配置和凭据留在机构仓或受保护的环境中，不写入公版源码。见[首次启动获取签名配置](PUBLISHER_BOOTSTRAP.md)。

## 依赖与复用

桌面开发包与发布候选默认使用同一 DSH `0.2.0-rc.2` 配方。两者的区别是产品版本、发布说明和交付方式：开发包只保留 artifact；手动候选可在核对后发布 GitHub Release。产品版本与 DSH 版本分别记录，不会因为输入一个新产品版本就自动升级 DSH。旧 npm 配方仅能显式通过 `--recipe npm` 调用。

候选流水线通过 `--reuse-workspace` 复用工作区，按阶段参数、输入和产物摘要决定是否重跑。`--jobs N` 控制并发，`--cache-root <目录>` 指定原生资源缓存；缓存命中后仍校验锁定哈希。上游升级需要同步更新依赖锁、Host 源码锚点、插件适配和验收回执，不能只修改版本字符串。

## Web 构建

需要单独检查 Web 时运行：

```sh
node scripts/ci-eduwork-web.mjs --core-root . --edition-root . --distribution-config config/distributions/generic.json --verify-snapshot --output ./dist/verify-generic
```

机构版先检出其 `core.lock.json` 指定的公版提交，再传入机构根目录和 `edition/distribution.json`。`--build-only` 只做源码、依赖和构建检查；Web 构建不产生桌面安装包。私有本机 Web 配置与 Office、媒体资源准备见 [Artifact Services 平台要求](../packages/dsh-knowledge-studio/packages/artifact-services/docs/PLATFORMS.md)。

## 旧版 PowerShell 流程（待移除）

`desktop-candidates.yml` 暂保留 `ps1` 选项，供已有候选与回执对照；它调用 `scripts/build-desktop-candidate.ps1`。日常构建和新候选优先使用上面的 Node 入口。

旧的静态机构配置重装配脚本 `scripts/configure-desktop-archive.ps1` 仍可处理已经验收的 Windows ZIP。它会改变原包并重新计算哈希，因此机构发布优先使用[签名配置首次启动获取](PUBLISHER_BOOTSTRAP.md)。

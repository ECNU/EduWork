# 从 npm 装配 EduWork

默认装配用于验证下一次发行的真实依赖组合。公版与 ECNU 版调用同一套脚本；机构仓只提供配置、学校服务插件和资源。当前可运行的构建环境是 Windows + PowerShell 7 + Node 24.18.0；macOS 按 [接手计划](MACOS.md)另行适配。

## 依赖从哪里来

| 输入 | 默认来源 | 校验与例外 |
| --- | --- | --- |
| DSH Runtime 0.1.5-rc.2 | 官方 npm 包 | `third_party/dsh/release-v0.1.5-rc.2/npm-runtime/package-lock.json`；`npm ci` 与 SRI |
| OIDC、Mail、Memory、Shared、Studio | 各自已发布的 npm 包 | `config/assembly.eduwork.json` 指向精确版本、源码提交、tarball SHA-256/SRI |
| Literature | 已有 npm 发行 | 保留自己的精确锁，不擅自代原作者发布 |
| 产品 UI、桌面边界与学校适配 | 各自仓库源码 | 由当前审阅提交构建，在装配回执中列出 |
| 官方 desktop Host / Electron 壳 | 固定 DSH 官方源码 | 此版本没有 `@deepseek-ai/dsh-desktop-host` npm 包；固定提交、源码归档哈希与构建依赖 |
| Node、Python、浏览器、语音资源 | 独立资源配方 | 按平台/架构准备；不从开发机隐式复制账号或整个环境 |

`assembly.json` 记录 `runtimeMode`、`pluginMode`、运行时锁哈希及每个独立包的实际来源。默认两种模式都是 `npm`。npm 不可用、版本尚未传播或哈希不匹配时停止构建；不会退回旁边的源码仓或旧 `.tgz`。`latest` 仅供用户安装，构建不追随它。

运行时投影会移除未启用的 Codex/Claude 外部运行时、开发调试载荷并消除已核对的重复依赖，保留单独的投影回执。它不会把裁剪后的产物冒充原始 npm tarball。依赖升级时重新生成和审阅锁，而不是在 CI 中运行 `npm update`。

### Runtime 与独立模块的兼容基线

默认桌面 Runtime 为 DSH `0.1.5-rc.2`，Studio `0.5.0` 与 Artifact Services `0.2.0` 的独立 npm 安装基线仍为 `0.1.5-rc.1`。产品装配按锁下载并校验 npm 包后投影其运行载荷，不在 Runtime 内执行这些模块 README 的独立安装命令。构建回执记录实际组合，桌面启动与产品能力按该组合验收。独立 Profile 项目则遵循模块自己的 rc.1 peer 与 overrides 要求；不要混用两套安装方法。

## 公版和机构版

在公版仓库根运行：

```powershell
./scripts/ci-eduwork-web.ps1 -CoreRoot . -EditionRoot . `
  -DistributionConfig config/distributions/generic.json `
  -Version 0.3.0-dev.20260911.2 -Output ./dist/verify-generic
```

机构仓库的 `core.lock.json` 必须指向已经存在的公版提交。将两个仓库分别检出，在机构仓库根运行：

```powershell
$core = (Resolve-Path ../EduWork).Path
git -C $core checkout (Get-Content core.lock.json -Raw | ConvertFrom-Json).commit
& "$core/scripts/ci-eduwork-web.ps1" -CoreRoot $core -EditionRoot . `
  -DistributionConfig edition/distribution.json `
  -Version 0.3.0-dev.20260911.2 -Output ./dist/verify-ecnu
```

这两条命令会审计源码、安装 npm 依赖、构建产品扩展并执行不需要学校账号的 Web 集成验证。GitHub CI 使用 `-BuildOnly` 保留构建检查，业务流程由维护者本地验证。它们不会生成可发行桌面包，也不会发布到 npm、GitHub 或更新渠道。真实 Office、语音、视频质量、系统凭据与生产登录要按 [发行清单](../RELEASE-CHECKLIST.md)另验。

## 启动本机 Web

完成上面的公版验证后，在仓库根目录创建 `.local/`，新建私有启动配置 `.local/web.private.json`。此处的装配路径对应上面命令的 `-Output ./dist/verify-generic`；验证其他装配时替换该路径。

```json
{
  "assembly": "dist/verify-generic/assembly",
  "home": ".local/user-home",
  "logs": ".local/web-logs",
  "profileName": "eduwork",
  "port": 8788
}
```

在仓库根目录运行：

```powershell
node scripts/dev-eduwork-web.mjs start .local/web.private.json
```

配置中的 `assembly`、`home`、`logs`、`userConfig` 和 `enterpriseProfile` 支持绝对路径；相对路径以执行启动命令时的目录为基准。请始终在仓库根目录执行 start、status、stop。后台 worker 和 Windows Profile 链接会继承同一基准，不因切换工作目录改变配置含义。资源环境变量及插件内的文件路径使用绝对路径。

启动器将带认证信息的本机访问地址写入 `.local/web-logs/url.txt`。在浏览器打开该地址，再到设置中配置模型服务和 API Key。退出时把命令中的 `start` 改为 `stop`。私有配置、访问地址、用户目录和日志不提交到 Git。

### Office 与媒体开发资源

GitHub 常规 CI 向脚本传入 `-BuildOnly`，只检查源码、npm 依赖和构建。上面的本地命令不带该开关，仍执行 `--mode clean-ci` 的完整 Web 集成验证并记录缺失资源。它不内置 Python、媒体浏览器、原生转写引擎或模型权重，也不代表完整 Office、音视频能力就绪。从干净检出运行 CI，不将构建目录和私有资源混入源码快照。

本机功能测试需要将以下字段合并进私有启动配置，并替换为已经准备好的实际资源路径：

```json
{
  "environment": {
    "DSH_OFFICE_PYTHON": "C:/EduWorkResources/python/python.exe",
    "DSH_MEDIA_BROWSER": "C:/EduWorkResources/browser/chrome.exe"
  },
  "pluginConfig": {
    "eduwork-artifact-services": {
      "transcription": {
        "local": {
          "executablePath": "C:/EduWorkResources/whisper/whisper-cli.exe",
          "modelPath": "C:/EduWorkResources/models/ggml-tiny-q5_1.bin",
          "model": "whisper-tiny-q5_1",
          "threads": 4
        }
      }
    }
  }
}
```

Python 环境须安装装配目录中 `d/node_modules/@eduwork/dsh-artifact-services/python/requirements.txt` 所列依赖；浏览器须为兼容的 Chromium 程序。启动器根据装配的 Node 运行时提供 `DSH_MEDIA_NODE_ENV`。Whisper 程序、依赖库和许可证应放在一起，配置路径不会自动下载资源。

执行语音任务前检查 `speech_voices`、`speech_transcription_providers` 的返回结果，只使用报告可用的提供方。共享组件的 `inspectMediaRuntime()` 为 Host 提供媒体就绪状态。缺失资源不能计为通过。资源完整的环境另用 `scripts/test-eduwork-web.mjs` 的 `--mode full-ready` 验证全部 Studio 能力可用；生成文件的实际质量仍需单独验收。

装配后 Artifact Services 包中的 `README.md` 和 `docs/TRANSCRIPTION.md` 说明资源要求与提供方契约。`scripts/prepare-desktop-resources.ps1` 从已验证的输入准备可迁移的 Windows 资源集合，发行前须审阅资源许可证并验收打包结果。

## 缓存和开发模式

默认运行时缓存保存在公版 `dist/dsh-cache/`。两种发行可通过 `-RuntimeSource` 显式复用同一个已验证的不可变运行时；这个参数是缓存路径，不是切换到源码模式。缓存身份必须与当前 npm 锁吻合。装配输出目录必须不存在，每次使用新的目录名；验收完只保留必要产物和回执。

要研究 DSH 源码，显式使用独立的源码构建目录：

```powershell
./scripts/assemble-eduwork-web.ps1 -CoreRoot . -EditionRoot . `
  -DistributionConfig config/distributions/generic.json `
  -RuntimeMode source -Output ./dist/source-experiment `
  -Version 0.3.0-dev.20260911.2
```

此时 DSH 使用 `third_party/dsh/development-v0.1.5-rc.1/LOCK.json` 固定的源码构建锁；独立产品插件仍从 npm 安装。只有在研究独立插件时才另传 `-PluginMode locked -AssemblyConfig <明确的开发装配配置>`。开发配置选择的包仍须有完整身份和哈希，不得用于默认 CI 或公开发行。公开仓库不包含未发布的开发包归档。

## 从 Web 到桌面

### 完整 Windows Electron 测试包

从干净检出运行，准备 Git、PowerShell 7、Node.js 24.18.0、Go 1.26.6，以及带 x64 C++ 工具和 Redist 文件的 Visual Studio 2022 Build Tools。脚本使用 `vswhere` 定位 Visual Studio，校验可再分发 DLL 的微软签名；仅安装系统 VC++ 运行库不能替代这些构建输入。需要能访问锁定的 GitHub、npm 和资源下载地址。仅做 Web 验证不需要 Go 和 Visual Studio。

在 EduWork 仓库根目录执行以下命令。使用源码回执中的开发版本；若源码已经是公测版，可将 `$Version` 改为符合 `X.Y.Z-dev.YYYYMMDD.N` 的本地测试版本。`-Development` 只构建和验收，不发布 GitHub Release、npm 或 OSS：

```powershell
$Version = (Get-Content source-receipt.json -Raw | ConvertFrom-Json).version
./scripts/ci-eduwork-windows-release.ps1 -CoreRoot . -EditionRoot . `
  -DistributionConfig config/distributions/generic.json -Version $Version `
  -Development -Output ../eduwork-electron-test
```

输出目录必须尚不存在，建议放在源码检出目录之外。`publish/` 包含 Electron ZIP、校验和与回执，`evidence-public/` 为脱敏检查结果。这个入口复用 GitHub CI 的脚本：自动准备锁定上游、Host、Node/Python/浏览器/ASR 资源和 Electron，检查解压后的同一 ZIP 并执行启动冒烟。下载和展开资源需要额外磁盘空间；不要将输出或本机配置提交到源码仓。

机构版在 EduWork-ECNU 根目录先检出 `core.lock.json` 指定的公版提交，再运行：

```powershell
$CoreRoot = (Resolve-Path ../EduWork).Path
$Version = (Get-Content core.lock.json -Raw | ConvertFrom-Json).version
& "$CoreRoot/scripts/ci-eduwork-windows-release.ps1" -CoreRoot $CoreRoot -EditionRoot . `
  -DistributionConfig edition/distribution.json -Version $Version `
  -Development -Output ../eduwork-ecnu-electron-test
```

原生资源准备入口是 [prepare-windows-release-inputs.ps1](../scripts/prepare-windows-release-inputs.ps1)，由完整构建脚本调用，无需自行拼接资源路径。完整业务、真实登录和升级仍按实际变更验收；构建启动成功不等于这些项目已经通过。

### 分阶段开发

先验收 Web，再按 [Electron 构建说明](../dsh-electron/README.md)准备 Host、原生资源和桌面壳。`prepare-desktop-product.ps1` 默认保留 Web 内的全部独立插件；npm 产品拒绝 OIDC/Studio 快照覆盖。公版与 ECNU 各打一个 Electron 包即可做日常业务比较；只有 Host/壳发生变化时才另外生成 Wails 做共同内容验证。

日常临时客户端与 Go/Wails 过渡包在本地构建、验证，不增加 GitHub 桌面打包矩阵或临时 Release。GitHub 后续正式桌面构建聚焦 Electron 的两种发行与已验收平台；现有源码/Web CI 和必要的 Mac 构建验证继续保留。Go 过渡包还须通过旧发布包的实际升级验收，不能直接使用独立 Wails 候选替代；详见 [发行与升级分工](RELEASE.md)。

macOS 不是将 Windows 依赖目录复制进 `.app`。先完成 [Mac 路径、资源与签名适配](MACOS.md)，再复用本页的组件锁和同一产品代码。

## 从 CI 原包装配机构配置

机构发行建议使用[首次启动获取配置](PUBLISHER_BOOTSTRAP.md)：CI 产物只内置更新源、公钥和公开默认值，客户端下载签名配置，CI 原包可直接分发，无需本机重装配。真实机构 Client ID 和业务参数不提交源码仓库，不通过 CI secret 注入程序包。

以下方式适用于选择本地静态配置的部署，例如公版加独立的机构配置包。管理员下载 CI ZIP，核对 SHA-256，再加入配置；程序和插件文件保持 CI 原样。启用 publisher bootstrap 的发行首次下载默认配置，之后同样读取 `config/eduwork.jsonc`。管理员可编辑本地文件，也可发布签名默认值更新；详见[配置文件](CONFIGURATION.md)。

仅替换 `config/eduwork.jsonc` 时，可使用以下共用脚本。输入配置必须启用至少一个机构并填写实际 Client ID；不支持在配置中分发用户 Key 或令牌。可省略 `updates`，继承 CI 原包的发行更新源和默认渠道；也可显式设置 GitHub、静态 HTTPS 源或关闭更新。显式 `defaultPolicy` 必须与包版本的渠道一致。

```powershell
./scripts/configure-desktop-archive.ps1 `
  -Archive ./downloads/ci-desktop.zip `
  -ExpectedSHA256 <CI回执中的SHA256> `
  -Config ./private-config/eduwork.jsonc `
  -Output ./configured/desktop.zip
```

例如机构使用公版默认 GitHub 更新时，不需要自建 OSS，可省略 `updates` 或加入：

```json
"updates": { "provider": "github", "repository": "ecnu/EduWork" }
```

静态源使用 `provider: "static"` 和 `manifestURL`；关闭更新使用 `provider: "disabled"`。`updates.defaultPolicy` 省略时按 CI 包版本继承；开发包为 development，公测包为 stable。此字段只提供发行默认值，不覆盖老用户主动保存的渠道选择。

脚本保留输入 ZIP，核对全部文件的包内校验值，只替换配置和 `RELEASE-MANIFEST.json`，再逐文件确认程序未变。输出 ZIP、`.sha256` 和 `.receipt.json`，回执记录 CI 原包与装配包的摘要关系，不记录机构 Client ID。自定义 Logo 文件不在此单文件覆盖流程内。

机构下载渠道提供装配后的包，用户解压后即可登录。必须分别验收全新安装、已有配置与数据的升级保留；新安装还要确认机构登录入口、默认模型与更新渠道正确。发布步骤见[更新源部署](UPDATES.md)。

## 更新锁与发布顺序

1. 在本仓库 `packages/` 对应模块完成源码、文档、许可证检查及 DSH 基线测试；按[包维护与发布](PACKAGES.md)冻结待发布 tarball。五个 npm 包独立发版，源码合并不改变默认客户端的 npm 装配路径。
2. 发布 Shared，再发布依赖该 Shared 版本的 Studio；OIDC、Mail、Memory 分别发布。产品发布权限与插件 npm 发布权限分开。
3. 从 registry 重新下载，核对版本、SHA-256、SHA1、SRI 与冻结包完全一致，再更新产品锁。
4. 在干净源码检出中重新装配两版并验收，机构仓更新 `core.lock.json`。不要只在开发工作树里验证。
5. 通过桌面验收后，按[版本与升级](RELEASE.md)执行发行。构建产物中的校验清单用于核对依赖和最终文件。


部分内部包名和生命周期辅助函数为兼容保留历史命名，但不因此启用机构能力。公版使用 `eduwork-web` 组合及明确的通用输入，保留但不启用的历史引用按来源记录中的文件哈希审阅。学校服务与资源由机构发行显式引入。

`scripts/record-npm-package-lock.mjs` 可以执行第 3 步：显式提供 `--package`、`--version`、`--commit`、`--repository`、`--sha256` 和一个新 `--output` 路径。它只读取 registry 并生成锁，不执行发布，不覆盖已有锁。新版本短暂返回 404 时，等 npm 传播完成再核验，不能拿本地包代替 registry 成功记录。

DSH 预发行版的宽范围 peer 可能解析到下一次 rc。应用应使用完整的 DSH 精确锁和 overrides；仅写一个顶层 `dsh@0.1.5-rc.1` 不足以固定所有间接包。依赖冲突时查清包树，不使用 `--force` 或 `--legacy-peer-deps` 隐藏问题。

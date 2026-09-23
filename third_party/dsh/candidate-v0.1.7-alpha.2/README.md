# DSH 0.1.7-alpha.2 升级候选

[English](README_EN.md)

此目录锁定用于迁移验证的上游源码和 npm Runtime，**尚不是桌面发行基线**。默认构建仍使用 `release-v0.1.5-rc.2`。不要把候选 Runtime 覆盖到已安装的 EduWork 或用户数据目录。

- 上游提交：`00102833dfaee1da9f48a3a8eae9d34005a75218`，标签 `dsh-v0.1.7-alpha.2`。
- `LOCK.json` 记录源码归档、pnpm 锁、npm 安装锁和包完整性；npm 依赖均来自官方 registry，DSH 包族锁定同一版本。
- 本锁只允许使用发布的 npm Runtime；不启用源码打包，不替换现有产品插件的 npm 锁。
- 提供独立的官方 Web Host 适配、原生配置迁移和源码插件验证入口。默认发行组装仍未切换；通过这些检查不等于桌面全流程已经验收。

在仓库根目录准备独立 Runtime，输出目录必须不存在：

```powershell
node dsh-desktop/scripts/prepare-dsh-runtime.mjs --source npm --lock third_party/dsh/candidate-v0.1.7-alpha.2/LOCK.json --output C:/EduworkTest/runtime-017
```

运行真实上游服务与合成数据迁移检查（适用于 Windows、macOS 和 Linux；按平台修改路径）：

```powershell
node scripts/probe-dsh-017.mjs --runtime C:/EduworkTest/runtime-017 --output C:/EduworkTest/probe-017
```

探测程序先核对安装回执，再创建全新的 DSH 用户目录。它检查本地 Web 鉴权、设置和预设等服务，以及合成 V3 日志的只读迁移、V4 后继发布、扩展数据保留和损坏日志拒绝。报告保存在输出目录的 `report.json`；保留该目录便于复查，再次运行请使用新目录。上游启动日志可能包含本地启动认证链接，不要将原始日志直接贴到公开 Issue。

单独检查文件转写适配器与官方语音服务的接口（不下载语音模型）：

```powershell
node scripts/probe-dsh-017-speech.mjs --runtime C:/EduworkTest/runtime-017 --output C:/EduworkTest/speech-probe-017
```

此检查使用真实 DSH `speechToText` 注册表、WAV 校验器和 Runtime 内 FFmpeg；识别提供方为合成实现。验证中文路径、重采样、超过单次大小限制的分段、时长上限、禁止切换云端、提供方替换与取消。可用 `--ffmpeg` 显式指定已准备好的 FFmpeg 绝对路径。输出目录必须不存在，结果写入 `report.json`。它不验证 SenseVoice 模型推理或识别准确率。

验证 Host 的鉴权、更新锁与流传输（`--upstream` 必须是锁定提交的源码）：

```powershell
node dsh-host/prepare-native.mjs --upstream C:/EduworkTest/source-017 --output C:/EduworkTest/host-017
node scripts/probe-eduwork-017-host.mjs --runtime C:/EduworkTest/runtime-017 --host C:/EduworkTest/host-017 --output C:/EduworkTest/host-evidence
```

验证源码插件时，将 `source-probe/package.json` 与 `package-lock.json` 复制到独立的 `C:/EduworkTest/source-deps`，在该目录执行 `npm ci --ignore-scripts`，然后：

```powershell
node scripts/build-017-plugin-clients.mjs --runtime C:/EduworkTest/runtime-017 --dependencies C:/EduworkTest/source-deps --output C:/EduworkTest/source-stage --report C:/EduworkTest/client-build.json
node scripts/probe-eduwork-017-settings.mjs --runtime C:/EduworkTest/runtime-017 --dependencies C:/EduworkTest/source-deps --source C:/EduworkTest/source-stage --full-product --output C:/EduworkTest/settings-evidence
```

该模式构建到独立目录，不修改已发布包或仓库内的生成文件。它检查旧偏好迁移、原生字段校验、修改与重启持久化、可选预设启停，以及组织配置、Studio、记忆、组件和技能的真实鉴权 RPC。`--serve` 可保留合成工作区进行页面验证；登录地址写入输出目录的 `launch.json`，不要公开其中的临时令牌。源码组合不包含外部文献插件。

旧设置原文保留为迁移备份；新偏好写入独立的 `desktop-017` 原生 Profile。用户编辑的产品配置入口仍是 `eduwork.jsonc`。旧自建预设保留原目录和 ID，转换后的定义由官方注册表管理；第三方预设所用插件仍需分别检查新内核兼容性。

以上检查不覆盖真实模型请求、组织登录、Studio 生成、原生窗口、Office/音视频渲染或程序更新，也不证明所有历史会话都可迁移。完成这些验收后才能提升桌面发行基线。候选 CI 只上传报告，不上传带登录地址的原始启动日志。

# DSH 0.1.7-alpha.2 升级候选

[English](README_EN.md)

此目录锁定用于迁移验证的上游源码和 npm Runtime，**尚不是桌面发行基线**。默认构建仍使用 `release-v0.1.5-rc.2`。不要把候选 Runtime 覆盖到已安装的 EduWork 或用户数据目录。

- 上游提交：`00102833dfaee1da9f48a3a8eae9d34005a75218`，标签 `dsh-v0.1.7-alpha.2`。
- `LOCK.json` 记录源码归档、pnpm 锁、npm 安装锁和包完整性；npm 依赖均来自官方 registry，DSH 包族锁定同一版本。
- 本锁只允许使用发布的 npm Runtime；不启用源码打包，不替换现有产品插件的 npm 锁。
- 桌面 Host、设置服务、Agent 预设和产品插件尚需迁移。候选安装成功不表示 EduWork 已兼容。

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

这些检查不覆盖真实模型请求、组织登录、Studio、原生窗口、预览渲染或程序更新，也不证明所有历史会话都可迁移。完成这些验收后才能提升桌面发行基线。

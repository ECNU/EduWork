# Windows 便携解压包

[English](PORTABLE-EXTRACTOR.en.md)

便携解压包是首次下载的可选附件：外层 ZIP 只有一个 EXE，EXE 内包含原始 Windows 桌面发行 ZIP。解压器使用发行包中的产品名称和图标，提供保存位置、进度、取消和完成后启动按钮。

解压器不注册安装记录、不创建快捷方式、不修改 PATH 或开机启动。配置和数据的存储方式由原来的便携应用决定。应用目录已存在时拒绝覆盖；升级仍使用应用现有更新机制。

## 构建

在 Windows 上使用 PowerShell 7 和 `dsh-desktop/go.mod` 固定的 Go 工具链：

```powershell
./scripts/pack-portable-extractor.ps1 `
  -Archive '<已验证的 Windows 发行 ZIP>' `
  -ExpectedSHA256 '<发行 ZIP 的 SHA-256>' `
  -OutputDirectory '<尚不存在的输出目录>'
```

输入 ZIP 必须包含 Electron 产品标识、品牌图标和 `RELEASE-MANIFEST.json`。脚本生成 `*-windows-x64-unpack.zip`、SHA-256 文件与构建回执。回执记录解压器源码提交、工作树是否有改动、Go 版本、原始发行 ZIP 和最终附件的哈希。公开附件应从已提交、干净的源码构建。

构建不重新装配应用，不修改原始发行 ZIP、版本号或更新源。`*-windows-x64-electron.zip` 仍是现有更新器使用的附件，不应改名或替换为解压包。发布时可为同一个 Release 追加解压包及其校验文件；Release 说明仍遵循维护者确认流程。

## CI 与发行流水线

Windows 候选、开发版和正式发行配方默认调用 `prepare-windows-portable-extractor.ps1`。它生成解压器 ZIP，读取并校验其中唯一的 EXE，再用该 EXE 解压原始发行包。随后现有的文件清单、原生运行时和桌面启动检查都针对解压器的输出运行；任何一步失败均阻止产出成功回执。

`publish` 目录同时保留原始 ZIP、解压器 ZIP、两者的 SHA-256 文件及对应回执。正式发布器要求八个已核验文件，验证解压器与原始 ZIP、版本、发行版和干净的公版源码提交一致后才上传。自动更新清单仍只引用原始 ZIP。Source Alpha 工作流仅保留这些构建附件，公开发布和 Release 说明仍需维护者确认。

公版和机构版共用这套配方；机构仓通过更新 `core.lock.json` 接入，不能复制实现。macOS 流程不生成 Windows 解压器。PR 的专项 CI 用两种品牌、稳定版和开发版的合成输入运行完整打包/解压链路，并测试缺失或篡改附件会在上传前被拒绝。

## 校验与边界

- 启动解压前核对内嵌 ZIP 的 SHA-256，并验证清单身份、文件数量、路径和大小。
- 解压时使用 Go 文件 API，支持超过传统 260 字符限制的完整路径；逐文件检查 CRC、大小和 SHA-256。
- 在所选位置的上级目录创建独立临时目录。所有文件通过校验后才改名为最终目录；错误或取消时清理本次临时目录，清理失败会给出目录位置。
- 仅接受本地新目录，检查空间和写入权限。启动 EXE 的完整路径必须少于 260 个 UTF-16 单元；应用内部文件可超过此长度，但这不代表所有第三方工具均支持任意长路径。
- 不提供覆盖安装或强制提权。使用 `asInvoker` 和 `longPathAware` 清单，不更改 Windows 长路径注册表设置。
- 外层 ZIP 用于方便下载和避免资源管理器展开深层应用目录，不能保证安全软件不拦截 EXE。当前构建脚本不执行 Authenticode 签名。

自动化验证可使用解压器的 `--verify --report <新 JSON 文件>`，或 `--extract-to <新目录> --report <新 JSON 文件>`；后者不会自动启动应用。GUI 的“启动应用”只在解压完成后由用户触发。

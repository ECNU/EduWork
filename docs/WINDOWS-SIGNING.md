# Windows 代码签名

Windows 可选使用硬件证书提供的 RSA Authenticode 签名。私钥保留在维护者的 USB Key 或 HSM 中，GitHub 托管机负责构建、摘要生成、签名回填、时间戳、打包与验收。公开仓库不携带机构证书或凭据。没有启用签名策略的公版保留原构建路径。

本流程面向已批准版本说明的 Node 正式/alpha 候选；`development=true` 临时开发包不满足来源和发布门禁。配置完成不等于正式产物已验收，完整安装、启动与升级验收仍须针对实际候选执行。签名可确认发布者及文件完整性，不保证免除 SmartScreen 提示。

## 策略与构建

在版本仓库提交 `edition/windows-signing.json`，并随源码审查：

```json
{
  "schemaVersion": 1,
  "required": true,
  "certificate": "公开叶证书的DER内容，使用base64编码",
  "thumbprint": "证书SHA1指纹，40位大写十六进制",
  "subject": "Windows证书对象的完整Subject字符串",
  "timestampURL": "证书供应商支持的RFC3161时间戳地址"
}
```

证书公开部分不包含私钥。不要提交 PFX、PIN、口令或 API 密钥。本实现要求 RSA 3072 位或以上、Windows SDK SignTool 和已安装的硬件提供程序。

原候选工作流仍完成 Windows、Mac 双架构构建。Windows 上传原 `windows-release`，但回执标记 `publication: awaiting-windows-signing`、`passed: false`。其中的启动结果只描述原始未签名候选。启用策略时不能从原候选直接发布，也不能使用旧 PowerShell 构建入口。

机构沿用自己的候选工作流；当前受支持来源为公版 `.github/workflows/desktop-candidates.yml` 和学校版 `.github/workflows/development-windows.yml`。签名工作流统一为 `.github/workflows/windows-signing.yml`。机构用同名 `workflow_dispatch` 薄调用者调用已审查、固定完整提交的公版 reusable workflow，`core_commit` 必须与该机构提交的 `core.lock.json` 相同。所有阶段使用与原候选相同的版本仓库提交。

## 两轮签名、三个托管阶段

| stage 输入 | 其他输入 | 产物 |
| --- | --- | --- |
| `inner-request` | `source_run_id`，父运行和回复留空 | `windows-signing-state`、`windows-signing-request` |
| `outer-request` | 同一 `source_run_id`，`parent_run_id` 指向第一阶段，`response_json` 为第一轮本机回复 | 新的同名状态与请求工件 |
| `finalize` | 同一 `source_run_id`，`parent_run_id` 指向第二阶段，`response_json` 为第二轮本机回复 | 最终 `windows-release`、验收证据 |

第一轮固定签署 `ChatECNU-Work.exe`、`EduWork.exe`、`EduWork-Electron.exe` 和 `resources/update/EduWork-Updater.exe`。完成回填、时间戳、验签后，才生成新的清单和全量 ZIP，再构建外层 Setup。第二轮只签署该 Setup。其他文件必须与原清单一致；第三方 PE 保留原始字节和签名，并记录原有签名状态，无法验证的既有签名会阻止继续。

第一轮本机待检查文件在下载的状态工件 `payload/<产品名>/`，第二轮在 `extractor/`。`windows-signing-request` 仅包含公开的 `request.json`，可单独下载和核对。状态工件包含签名所需的实际文件；本机工具必须由这些文件重新生成摘要，不接受只有摘要的盲签请求。

SignTool 生成摘要时可能调整 PE 对齐或证书区。请求分别记录原文件的 `inputSHA256/inputBytes` 和生成摘要后实际待回填文件的 `sha256/bytes`。本机从批准的待回填文件副本重算，原文件保持不变；托管回填只接受请求绑定的准确字节。

本机使用已审查的相同核心版本运行以下脚本；所有审批字段都必须明确填写。`GITHUB_TOKEN` 只需读取该仓库 Actions/Contents，不能将其放进命令文本、回复文件或仓库。

```powershell
node scripts/sign-windows-request.mjs `
  --request C:/signing/request.json `
  --payload-root C:/signing/state/payload/EduWork `
  --output C:/signing/response-round-1 `
  --repository ECNU/EduWork `
  --edition-commit <完整版本仓库SHA> `
  --core-commit <完整核心SHA> `
  --source-run <原候选运行ID> `
  --request-run <产生该请求的签名运行ID> `
  --request-sha256 <已核对的请求哈希> `
  --policy-sha256 <已核对的策略哈希> `
  --version <已批准的版本号>
```

请求和策略哈希均为 `SHA256(JSON.stringify(对象))`，不包含文件缩进或末尾换行；请求哈希会打印在托管阶段日志中。审批前核对仓库、两个源码提交、版本、原运行、原 artifact ID/摘要、证书和全部目标路径。本机工具再次验证成功的运行、官方请求工件、文件完整 SHA256、SignTool 重算摘要及 CMS 内容绑定，之后才调用硬件 `/ds`。PIN 若需要，由硬件驱动自己的对话框处理。工具不读取、接收或保存 PIN。

返回的 `response.json` 只有公开的 RSA 签名值及来源标识。将其作为下一阶段 `response_json` 输入；总 UTF-8 内容限制为 60000 字节，不能截断。调用 GitHub CLI 时使用结构化 dispatch JSON 和 `gh api --input <文件>`，不要把 JSON 或外部值拼进 shell 命令。签名工具不会自动发起工作流或发布。

## 最终验收与发布

`finalize` 验证签名和时间戳后，从同一已签 Setup 中取回嵌入 ZIP，重新执行解压、清单、原生运行时与真实 GUI 启动验收，再针对签名后的清单生成差分包。最终回执记录原候选、两轮请求/回复、三个签名运行、artifact 身份、签名前后哈希、发布者与时间戳。未完成或失败的阶段不能输出可发布的成功回执。

发布工作流同时传入原 `source_run_id` 和最终 `windows_signing_run_id`。Windows 只取最终签名运行的 `windows-release`；Mac 双架构仍取原候选。publisher 独立检查所有父运行、来源提交、请求工件摘要、回复 RSA 签名和完整发布文件哈希。源码里的签名策略不能由输入关闭，旧独立 Windows publisher 也不能绕过这个门禁。

完整候选三阶段需要在工件保留期限内完成。过期工件、错误运行、重跑后替换的 artifact、不同证书或摘要、漏签、缺少时间戳都会失败。重试前核对当前运行和工件身份；不要将旧回复套到新请求。最终发布仍使用现有版本说明审批和发布授权流程。

实现依据：[Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)、[GitHub workflow_dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatchinputs)、[Microsoft SmartScreen 信誉机制](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)。

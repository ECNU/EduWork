# 命令自动审批插件

**简体中文** | [English](README_EN.md)

`@eduwork/dsh-auto-approval` 在专门的权限预设下，先审查 bash/pwsh 命令越出沙箱的申请：固定规则和 SystemOne 兼容的决策模型都认为用户会同意的，直接放行这一次；其余申请原样交给确认卡，由用户决定。插件不会替用户拒绝申请。

插件使用 DSH 原生的审批、工具和配置机制，无 runtime 补丁。服务地址、模型及认证均由用户或发行版提供，包内没有默认机构或公共推理地址。

## 审查方式

审查只发生在同时满足以下条件时：会话选择的是插件配置的预设（默认 `auto-approval`）；申请来自 `bash` 或 `pwsh` 工具；命令带有 `sandbox_permissions`，需要越出当前沙箱；其他工具策略（如 hooks）没有要求先问用户。文件写入、MCP 等其他工具的审批，其他策略要求确认的调用，以及其他预设下的会话，都不受影响。

插件把这次申请整理成一份状态交给决策模型，字段依次为：系统、工作区（沙箱允许写入的范围，即会话开始时的目录）、当前目录（命令实际运行的目录）、本次会话创建的文件、用户回复的助手消息、用户最近的消息、申请理由、之前执行的命令、风险标记、待执行的命令；bash 命令只是运行一个本地脚本文件时（如 `bash scripts/deploy.sh prod`、`python3 tools/sync.py`、`./run.sh --all`），再附上脚本内容。

固定规则标出必须由用户明确要求的操作：推送和发布、远程连接、上传、运行部署或发布脚本、钥匙串和凭据、sudo 和提权、安装、改软件配置、系统设置。规则同样检查命令要运行的脚本内容。

- 命中规则：模型只回答一个问题，即用户是否明确要求过这件事；概率不低于 0.7 才放行。
- 未命中规则：并行问两个问题，即用户会不会同意，以及做错了后果有多严重；两者平均（同意概率与 1 − 严重程度取均值）不低于 0.5 才放行。

放行只对这一次申请有效，不记住。

## 安装和配置

在 DSH 插件管理中安装 `@eduwork/dsh-auto-approval`；原生 bundle 使用固定 ID `auto-approval`，默认 `enabled: false`。

插件本身不能新增权限预设，需要在 DSH 权限插件（ID `permission`）的配置里加一个沙箱为 `workspace-write`、审批为 `ask` 的预设。配置会整体替换原有预设表，所以要把原有预设一起写上：

```json
{
  "presets": {
    "read-only": { "sandbox": "read-only", "approval": "ask" },
    "workspace-write": { "sandbox": "workspace-write", "approval": "ask" },
    "auto-approval": {
      "sandbox": "workspace-write",
      "approval": "ask",
      "name": "自动审批（实验）",
      "description": "工作区外的命令先由决策模型审查，拿不准时再问你"
    },
    "danger-full-access": { "sandbox": "danger-full-access", "approval": "never" }
  }
}
```

插件配置示例（在凭据服务中保存真实 Key，不把 Key 填进此配置）：

```json
{
  "enabled": true,
  "preset": "auto-approval",
  "baseURL": "https://decision.example.org/v1",
  "model": "your-decision-model",
  "authMode": "api-key",
  "credentialRef": "SYSTEMONE_API_KEY",
  "timeoutMs": 5000
}
```

`baseURL` 包含 API 前缀，请求沿用 [`@eduwork/dsh-decision`](../dsh-decision/README.md) 的客户端。机构登录选择 `authMode: "oidc"` 并填写 `oidcProfileId`，需要兼容的 `@eduwork/dsh-oidc`；明确免鉴权的服务才选择 `authMode: "none"`。

## 失败与超时

- 一次审查的总时限为 `timeoutMs`（默认 5 秒），超时交给用户确认。
- 网络错误、429 和 5xx 在时限内重试一次；问题本身不产生副作用。
- 同一会话连续失败 3 次后暂停审查 5 分钟，期间申请直接交给用户。
- 未登录、没有 Key、回答缺字段、服务拒选（`choice: null`）都按失败处理，不回退到其他模型或认证方式。
- 用户在审查期间撤回申请，不计入失败。

每次审查在日志 `auto-approval` 中记录结果、分数和耗时，失败时记录警告。

## 发送给决策服务的内容

状态里包含用户最近 3 条消息（每条前 300 字）、用户回复的那条助手消息（最后 1000 字）、之前 6 条命令（每条前 300 字）、本次会话用文件工具新建的最近 8 个文件路径，以及命令要运行的脚本（最多 16000 字）。启用前请确认决策服务可以接收这些内容。

## 评测与限制

规则和问法在 6 组共 419 条真实越界申请上评测（每组都先标注“应当放行”或“应当询问”再运行）：自动放行 284 条（68%），134 条应当询问的申请没有一条被放行。评测用的是一个 SystemOne 兼容的决策模型；换用其他模型需要重新评估。

- 子智能体：DSH 把子会话的审批固定为 `never`，越界申请在审批之前就被拒绝；插件也不审查子智能体会话，因为其中的“用户消息”来自委派它的智能体。
- “本次会话创建的文件”只记录文件工具（`write` 新建的文件、`apply_patch` 的 Add File）成功新建的文件，命令新建的文件不计入；Host 重启后从空开始。
- 确认卡保持原样，不显示审查结果。
- 超过 16000 字的命令不审查，直接交给用户；评测数据里最长的命令约 13000 字。
- 规则按命令文本匹配。脚本内容只在整条 bash 命令就是运行一个写明路径的脚本时才附上，脚本再调用的其他文件不读取；命令序列、`cd`、变量（包括命令前的 `NAME=value`）、通配符、管道、重定向、路径里的 `..`、`node -e` 这类内联代码、不带路径按名字运行（由 shell 在 PATH 里找）以及 PowerShell 命令，都看不准实际运行的是哪个文件，不附脚本，命令本身照常审查。

## 开发与装配

源码在 `src/`，构建仅复制 ESM 模块。Node >=24.22.1，已在 DSH 0.2.2-rc.1 上验证。将 `EDUWORK_AUTO_APPROVAL_RUNTIME` 指向锁定 Runtime（含 package.json/node_modules 的目录），运行 `npm ci`、`npm run check`；测试使用合成材料与本地 HTTP，并在真实 Runtime 上跑通从模型发起申请到审批完成的流程。

仓库统一入口为 `node scripts/packages/manage.mjs check dsh-auto-approval` 和 `pack dsh-auto-approval`，详见[包维护指南](../../docs/PACKAGES.md)。正式产品需先发布并核验 npm 原包，再更新精确锁。

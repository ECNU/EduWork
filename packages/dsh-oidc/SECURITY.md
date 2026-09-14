# 安全政策

**简体中文** | [English](SECURITY.en.md)

## 支持版本

当前受支持发布线为 `0.1.x`，安全修复应用于该发布线的最新版本。`0.1.0` 之前的 alpha 版本仅保留用于迁移和历史复现，不再接收常规修复。

## 报告漏洞

怀疑存在漏洞、秘密泄露、私有 endpoint、身份混淆、凭据暴露或授权绕过时，**不要创建公开 Issue**。

请通过 GitHub 的 [Private Vulnerability Reporting](https://github.com/ecnu/EduWork/security/advisories/new) 私密提交报告。不要在公开 Issue、Discussion、Pull Request 或日志附件中披露漏洞细节、真实凭据或个人信息。如果该入口不可用，请只创建一条不含技术细节的公开 Issue，提醒维护者检查安全报告配置。

在安全允许的情况下，请提供：

- 受影响版本/commit 和 DSH 版本；
- 部署拓扑（Web/native、单用户/共享、Credential Provider）；
- 复现步骤或 PoC；
- 影响范围，以及是否访问了秘密或个人数据；
- 已脱敏 Token、Cookie、API Key、subject 和内部 host 的日志；
- 建议缓解措施或保密期要求。

维护者目标是在三个工作日内确认完整报告，在七个工作日内给出初步评估，并在修复可用后协调披露。上述时间是响应目标，不是法律或服务等级承诺。

## 范围内

- OIDC state/nonce/PKCE/token 校验和 callback 处理；
- ID Token、UserInfo、bootstrap、Profile 或 native 后端之间的身份混淆；
- Key Binding 授权、Provider 绑定、幂等或 API Key 暴露；
- 凭据存储/解析，以及跨用户或跨 Profile 隔离；
- Profile 校验绕过或远程代码/样式执行；
- Client loader、品牌替换、XSS、开放重定向、SSRF 或不安全 URL 处理；
- 依赖、构建和发布供应链攻击。

## 范围外

- 只存在于未修改上游 DSH/pi-ai/Node 依赖中的漏洞（应报告上游；若能在本项目中利用，也请通知本项目）；
- 运维方违反明确禁令，主动在 Profile 中公开秘密；
- 使用全局/文件型 Credential Provider 的不受支持共享多用户部署；
- 社会工程、物理攻击，或需要不现实流量的拒绝服务攻击，除非存在低成本放大。

## 秘密处理

不得在 Issue 中附加真实 Token、Key、Cookie、用户记录、生产 Profile 或原始 session 导出。如果发现仓库秘密，应先撤销或轮换；仅删除 Git 历史不构成修复。

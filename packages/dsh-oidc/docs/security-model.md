# 安全模型与部署要求

**简体中文** | [English](security-model.en.md)

## 资产

`dsh-oidc` 会处理：

- OIDC authorization code、access token、refresh token 和 ID Token；
- 稳定 OIDC subject 标识符和可选显示 claim；
- 模型运行时 API Key；
- 机构、Provider 和模型配置；
- 账号与能力状态。

机构密码不属于本插件资产，必须只输入 OIDC Provider。

## 信任边界

1. 浏览器到 DSH Host callback/UI。
2. DSH Host 到 OIDC Provider。
3. DSH Host 到 Key Binding 服务。
4. DSH Host 到模型网关。
5. 插件到 DSH Credential Provider。
6. 受信任的本地可执行插件代码与声明式 Enterprise Profile 数据之间。

同一机构可以运营第 2–4 项边界，但它们仍是彼此独立的协议权威，应该使用不同 audience 和凭据。

## 本仓库实现的安全控制

### OIDC

- 仅使用 Authorization Code + PKCE S256。
- 随机 state、nonce 和 verifier。
- 待处理流程十分钟过期，且数量受限。
- 固定 callback 路径和显式 public origin。
- 拒绝重复安全参数。
- 校验 RS256 签名、JWK、issuer、audience、azp、subject、nonce 和时间。
- 存在 `at_hash` 时校验它。
- UserInfo `sub` 必须等于 ID Token `sub`。
- Callback return path 只能同源。
- 远程 endpoint 必须 HTTPS；只有显式 loopback 开发环境可以使用 HTTP。
- OIDC 与 Key Binding JSON 响应最大 1 MiB。

### 配置

- 拒绝未知字段。
- Profile 最大 512 KiB。
- 不允许远程选择 adapter、module、tool 或 Skill。
- Key Binding 路径和字段固定。
- 生产 URL 使用 HTTPS，且不得包含凭据或 fragment。
- Data logo 只允许 PNG/WebP，不允许 SVG。
- 只覆盖有边界的品牌 token。

### 秘密

- 使用 OIDC public client，不使用 client secret。
- Session 和 API Key 只通过 DSH Credential Provider 写入。
- 模型 adapter 在请求时解析 Profile 规范化后的凭据引用；未配置时才按 Provider ID 确定性派生。
- 独立空 pi-ai auth store 防止环境凭据遮蔽已绑定 Key。
- 凭据响应必须精确匹配 Provider ID。
- Native 宿主报告的凭据引用必须与 Profile 一致，防止生产/测试环境交叉取 Key。
- 退出登录会清除本地会话和模型 Key。

## 宿主假设

插件假设：

- Node.js TLS 和 DNS 信任得到正确管理；
- DSH 插件和 Profile 文件只能由受信任管理员写入；
- DSH WebServer 精确监听 `127.0.0.1`，且 `/oauth/callback` 路由注册不会被绕过；
- 当前 Credential Provider 能保护机密性，并隔离目标用户；
- 日志和崩溃报告不会转储凭据值或请求 body；
- 没有反向代理、端口转发或隧道把本地 WebServer 暴露给其他用户；
- 系统时间基本同步。

任何假设失效时，插件无法独自恢复安全边界。

## 单用户与共享 Web 部署

Web 后端会按 Profile 凭据引用保存一个逻辑 OIDC 会话。在使用文件型凭据存储的本地 DSH 进程中，这属于**单用户进程模型**。访问同一进程的多个浏览器可能通过共用 Host 服务看到或替换同一账号状态。

因此，当前 Web backend 强制 DSH WebServer 监听 `127.0.0.1`，并拒绝 `publicBaseURL` 或非 loopback host。它不得作为共享多用户服务公开。

共享部署要求宿主而不是本插件提供：

- 已认证的浏览器 session；
- 每用户服务/请求上下文；
- 每用户 Credential Provider 命名空间；
- 带轮换和备份策略的加密存储；
- Secure、HttpOnly、SameSite Cookie；
- 对非 OIDC 状态变更操作的 CSRF 防护；
- tenant/subject 隔离测试；
- session 终止和管理员撤销；
- 限流和滥用监控。

上述能力需要由未来新的宿主 backend 实现；它们不是放宽当前 Web backend loopback 检查的理由。在 DSH 暴露并且本项目验证这些契约前，支持的 Web 拓扑是每个进程/Profile 仅供一名受信任用户使用。

## SSRF 与 endpoint 策略

配置受信任 issuer 后，OIDC 元数据仍由远端控制。标准允许跨 origin endpoint，因此插件仅在 HTTPS 下接受它们。这样可阻止任意网络 HTTP 降级，但不能阻止恶意或已被攻陷的 issuer 指向私有 HTTPS endpoint。

运维方应该实施出口策略，使 DSH 进程只能访问已批准的身份、Key Binding 和模型 origin。云部署应该在网络层阻断 metadata-service 地址段和内部控制面。DNS rebinding 防护属于 HTTP agent/出口代理职责，本插件尚未实现。

## 浏览器安全

宿主应该设置严格 Content Security Policy，至少审查：

- `connect-src`：DSH/WebSocket 流量；
- `img-src`：HTTPS 和批准的 `data:` 图片；
- `frame-ancestors 'none'`：除非明确需要嵌入；
- `base-uri 'none'` 和 `object-src 'none'`；
- `Referrer-Policy: no-referrer` 或同等严格策略。

即便没有 referrer，远程品牌图片仍可能向其宿主暴露客户端 IP 和访问时间。无法接受时，应打包资产或通过受控代理提供。

## 已知限制

- 只支持 RS256，尚无算法敏捷性。
- 不支持 PAR/JAR/JARM、DPoP、mTLS 或加密 token。
- 不支持 RP-Initiated、front-channel 或 back-channel logout。
- 进程重启会丢失内存中的待登录状态，且该状态不跨集群共享。
- Discovery 在进程生命周期内缓存；紧急 endpoint 变更需要重启。
- Native 后端安全性取决于宿主 `enterpriseAccounts` 实现。
- Key Binding v1 没有远程凭据撤销操作。
- 依赖完整性依靠 npm lockfile 和发布控制；仓库不 vendor DSH/pi-ai 源码。

## 部署安全审查清单

- [ ] 精确 issuer、client ID、redirect URI 和 audience 已获批准。
- [ ] OIDC 符合性和反向测试通过。
- [ ] Key Binding scope 和授权已测试跨用户/跨 tenant 访问。
- [ ] Provider/Key 不匹配和旧 Key 撤销已测试。
- [ ] Credential Provider 拓扑符合单用户或隔离多用户要求。
- [ ] 反向代理和 CSP 已审查。
- [ ] 应用、代理、APM 和崩溃日志中没有秘密。
- [ ] 出口策略会阻断意外的私有/metadata 目标。
- [ ] 依赖 lockfile、安装脚本和许可证已审查。
- [ ] 事故响应联系人和远程凭据撤销流程已记录。

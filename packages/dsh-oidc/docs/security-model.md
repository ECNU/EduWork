# 安全边界

**简体中文** | [English](security-model.en.md)

Profile 由发行方或本机用户明确配置，限制为数据。发现与 Token 响应不允许改写执行模块、品牌脚本或任意请求目的地。

- Code + PKCE、一次性 state 和适用的 nonce 绑定登录；桌面回调只监听 127.0.0.1。
- OIDC 校验签名、issuer、aud/azp、时间、nonce、at_hash 和 UserInfo sub；刷新返回 ID Token 时验证原身份。
- 模型 API 地址来自已校验的发现。Host 限制目的地址和重定向，机构资源读取只接受有界相对路径、GET 和有界正文。
- Token 由 Host 凭据服务保存，不通过 RPC、配置、诊断或模型元数据暴露。个人 Key 与机构 Token 分开。
- 请求绑定登录上下文；退出和重新授权取消旧请求，迟到响应不能恢复旧登录或流入新账户。相同授权的 Token 刷新不应误伤在途调用。
- 客户端先本地退出，再尽力撤销 Refresh Token；远程失败不恢复本地授权。已签发 Access Token 的剩余有效期由服务端控制。

客户端不再创建、读取或迁移机构模型 API Key。遇到旧配置明确拒绝，迁移需重新登录；不会凭 URL 或 Token 外观猜测兼容方式。旧 Key 不会被批量删除，以免影响其他独立配置。

仅身份模式、Token 模型模式及两种网关的配置边界见[Profile](enterprise-profile.md)与[协议说明](gateway-auth/README.md)。本机 Web 不可作为多人共享服务。

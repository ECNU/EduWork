# ADR 0002：受信 Host 的精确服务读取与账号身份

**简体中文** | [English](0002-host-service-reads.en.md)

- 状态：提案，等待维护者接受；不表示已发布或冻结契约。
- 需求：[EduWork #186](https://github.com/ECNU/EduWork/issues/186) 中授权订阅、账号隔离及插件边界。

需要获取个人课表等机构资源时，业务插件不能另存 Token，也不能把机构数据接口硬编码进公共 OIDC。仅有模型资源前缀和 issuer POST 路径不足以表达一个经过机构配置批准的只读地址。

Host 专属 `authorizedFetch(profileID, endpoint, init, { serviceURL })` 增加一次精确目标读取能力。`serviceURL` 必须与规范化后的目标 URL 完全一致，只允许无正文 GET，拒绝 URL 凭据、片段和重定向。默认要求 HTTPS。它不扩充持久化模型资源白名单，也不新增 Remote 或 OpenAPI 路由。

该选项只能由受信 Host 插件根据机构配置生成，不能直接透传浏览器、模型或来源响应里的授权目标。订阅插件先检查机构 `authorizedServices: [{ profileID, url }]` 精确白名单，模型只能选择已批准的 profile/地址组合。加载任意 Host 代码本身属于受信边界，OIDC 不把一个恶意 Host 插件当作沙盒内的不可信程序。

测试服务沿用显式 `allowInsecureDevelopment` 约定：订阅 Host 配置与 OIDC Profile 都开启时，仅额外允许字面 IP `127.0.0.1` 或 `[::1]` 的 HTTP 精确地址。不接受普通主机名、localhost、非回环 IP；生产配置默认关闭。此例外不允许把 HTTP 地址扩充为通配 origin。

Host 专属 `accountIdentity(profileID)` 返回 `{ profileID, accountID }` 或未登录时的 null；accountID 是 profile、issuer 和已验证 subject 的 SHA256 摘要，不返回 subject、Token 或其他凭据。插件据此隔离本地缓存，它不是服务端的登录证明。相同身份续期保持摘要，换账号产生新摘要。

读取继续使用现有凭据存储与轮换、超时、一次401恢复和账号世代检查。业务插件在请求前后检查身份、监听 `oidc/accounts-changed`、取消退出/切换前的在途请求，阻止旧响应写入新账号。网络、授权或解析失败保留上次成功快照；退出后旧账号缓存不可见。订阅接收体有5 MiB上限，不能把异常正文、header或Token传入UI或日志。

另一个选择是把所有机构 origin 永久加入 OIDC 配置，但它扩大了同源其他接口的权限，且把业务配置耦合进公共身份包。因此采用精确、单次、只读能力。将账号字段直接交给模型或让每个业务插件保存 Token 也不采用。

验证应包含精确目标/方法/协议拒绝、账号摘要稳定性、续期、持续401、注销及切换中晚回包。使用真实回环 HTTP 资源与 token 服务贯通后端和订阅；此验证不等于真实学校登录、HTTPS部署或 Electron 验收。专项复核结论和维护者接受是后续冻结/发布前的必要条件。

# 双协议网关认证提案

**简体中文** | [English](README_EN.md)

状态：设计提案，尚未实现或发布。本页供贡献者评审接口边界和开发范围。当前可用功能仍以 [dsh-oidc 文档](../../../packages/dsh-oidc/README.md)为准，不应按本提案修改生产配置。

## 目标

通过配置完整的服务发现地址，让 EduWork 接入两类网关：LiteLLM 原生客户端 OAuth，以及暂名 `oidc-llm` 的身份与模型资源协议。两个适配器共用授权码、PKCE、系统浏览器、本机回调、Access Token 生命周期和模型请求层。

用户通过浏览器完成授权后，客户端直接用获准的 Access Token 获取资料、列出模型并调用模型；新协议不要求额外创建 API Key。Key Binding 不进入新公共协议，已有机构接入保留兼容路径。配额标准化和团队管理不在本提案范围。

## 发现与适配

| 范围 | LiteLLM 原生路径 | oidc-llm 草案方向 |
| --- | --- | --- |
| 发现 | 校验 native discovery 的完整契约结构及版本 | 标准元数据上的显式扩展及版本 |
| 客户端注册 | 使用网关已有动态注册 | 支持机构预注册 public client，动态注册可选 |
| 授权 | Code + PKCE S256，明确 resource | 复用同一授权底层，明确目标模型资源 |
| 用户资料 | 适配实际账户响应 | 从 `userinfo_endpoint` 发现，复用 OIDC 字段 |
| 模型访问 | Access Token 直调网关 | Access Token 直调已授权资源 |
| 身份验证 | 不把 native OAuth 伪装成完整 OIDC | OAuth 兼容模式与完整 OIDC 身份模式分别定义 |

不根据网址包含某个品牌、Token 外观或缺失 ID Token 来猜协议。未知版本、冲突标志或缺少关键能力必须报错，不在授权失败后自动降级。普通 OIDC 服务的 Access Token 也不能因此被发送给一个未授权的模型资源。

LiteLLM 的接口行为必须依据固定官方版本核验，不能按新协议的期望修改事实描述。初始兼容基线为 [LiteLLM v1.101.0](https://github.com/BerriAI/litellm/releases/tag/v1.101.0) 的 native contract 1；实际 scope 与撤销语义属于适配边界。

## UserInfo 约定

oidc-llm 草案要求发现结果提供 `userinfo_endpoint`，客户端不固定拼接资料接口路径。普通 JSON 响应必须包含字符串 `sub`；`name`、`preferred_username`、`picture`、`email`、`email_verified` 采用 OIDC 标准含义，按授权可选返回。缺少姓名或头像时界面降级显示，不使登录失败。

账户标识依据 issuer 与 sub；用户名、姓名、邮箱不作为唯一主体键。完整 OIDC 模式校验 UserInfo 的 sub 与已经验证的 ID Token 一致；OAuth-only 兼容模式需要明确自身语义，不宣称完成标准 OIDC 身份验证。

参考：[OIDC UserInfo](https://openid.net/specs/openid-connect-core-1_0.html#UserInfo)、[标准字段](https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims)、[服务发现](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata)。端点必填是本提案的接入要求；姓名、邮箱等并非 OIDC 的普遍必填字段。

## 实现边界

通用代码在 `packages/dsh-oidc` 维护；需要的桌面宿主边界在公版实现。机构只通过发行配置和可选扩展接入，不复制认证实现。公开示例使用合成地址与 client ID。

单一凭据管理者负责安全存储、到期刷新、并发刷新合并、原子保存和退出。主会话、子代理与插件通过同一入口取得有效模型 Token。账户切换后，旧刷新和目录请求不能把结果写入新授权。

现有配置和已发布 npm 包继续按现有契约运行。新适配器通过新的显式配置进入，不能通过关闭旧 OIDC 验签来兼容另一套协议，也不能自动把用户的静态 Key 转成 Access Token。

## 开发拆分与验收

1. 确定发现与配置结构、共享凭据管理边界，补充合成契约测试。
2. 实现 LiteLLM adapter，覆盖注册、授权、资料映射、模型请求、刷新和撤销。
3. 确定 oidc-llm 的 scope、有效期和撤销契约后，实现第二 adapter 与可独立联调的服务端接口。
4. 验证历史 OIDC profile、账号切换、重启、模型普通/SSE 请求及异常恢复。

每个 PR 报告实际执行的验证和未验证范围。模拟契约测试不能替代真实网关与桌面验收；普通 CI 沿用模块检查和必要构建，本地完成系统浏览器及桌面行为验证。

尚待明确的内容包括 scope 集合、Token 有效期、刷新家族撤销保证和模型目录的可选能力字段。本文不预先将这些讨论项固化为已发布接口。功能实现、合并、npm 发布和桌面发行分别处理。

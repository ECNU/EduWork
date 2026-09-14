# dsh-oidc

> npm 包：`@eduwork/dsh-oidc@0.2.3` · DSH 开发基线：`0.1.5-rc.1`。

**简体中文** | [English](README_EN.md)

`dsh-oidc` 是面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的企业身份与模型闭环集成插件。

插件提供四项能力：

1. 标准 OIDC Authorization Code + PKCE 公共客户端登录；
2. 固定的企业 **Key Binding** 协议，用 OIDC Access Token 申请、解析或轮换可撤销的模型运行凭据；
3. 本地 OpenAI-compatible Provider 与可自动同步的模型目录；
4. 安全的账户刷新和注销，可选机构账户扩展。

这些能力配有共享账号界面和可选品牌配置。纯身份接入可省略资源协议，个人模型入口始终保留。

插件面向单机客户端。本机 Web 用于功能验证；桌面通过 `backend: desktop` 使用临时 loopback 回调和宿主浏览器服务，无需常驻 WebServer。`backend: native` 仅兼容旧宿主账户桥。三种后端都不依赖特定外壳，详见 [桌面宿主接入](docs/desktop-host.md)。

准备接入自己的机构？先读 **[服务端接口规范](docs/server-integration-contract.md)**，再按 **[完整中文接入指南](docs/getting-started.md)** 部署。前者以请求、响应、字段和错误码形式定义一个机构服务必须共同实现的 OIDC + PKCE、Key Binding 和模型网关能力；后者覆盖配置、安装、验收和排障。

## 接入架构

- OIDC 负责确认用户是谁；
- Key Binding 负责确认该用户能否获得哪个 Provider 的运行凭据；
- Enterprise Profile 负责声明品牌、OIDC 公共客户端、Key Binding 基址和模型事实；
- 本地 Provider 适配器把凭据和模型事实接入 DSH；
- 配额由独立机构扩展提供；桌面外壳、学校业务页、心跳与更新器由产品实现方扩展。

远程配置只能是数据，不能指定 JS 模块、脚本、CSS、工具、Skill 或自定义 Provider adapter，也不能修改 Key Binding 的路径和字段。

## 能力与非目标

已包含：

- loopback 回调 `http://127.0.0.1:<实际端口>/oauth/callback`：Web 取 WebServer 端口，桌面默认临时随机端口；
- OIDC Discovery、PKCE S256、state、nonce、RS256 ID Token 校验、UserInfo subject 绑定、刷新和可选撤销；
- 只读取标准 `userinfo.name`，缺失时降级到必需字段 `userinfo.sub`；
- 固定 `worker-user-center-v1` 的 bootstrap / provision / resolve / renew；
- 使用 DSH Credential Provider 保存 OIDC 会话和模型 API Key；
- 声明式 Provider/模型目录和有边界的品牌 token；
- 两种桌面壳和本机 Web 共用官方模型设置、onboarding、侧栏账号与通用设置插槽，按宿主能力显示操作；
- 桌面原生账号后端适配边界；
- 稳定的 `enterpriseTransforms` 扩展服务，图像理解等插件可以增强某条模型路由，但不会再注册一套重复 Provider。

明确不包含：OIDC 服务端、Key Binding 服务端、多用户会话数据库、学校人员目录、Wails 外壳、客户端更新器和远程可执行插件。

## 品牌替换范围

`dsh-oidc` 当前已经包含品牌替换。部署方可以在 Enterprise Profile 的 `brand` 中声明：

- `productName`、`organizationName` 和 1–4 字符的 `mark`；
- HTTPS 或 base64 PNG/WebP `logoURL`；
- 六位十六进制 `primaryColor`；
- `loginTitle`、`loginDescription` 和 HTTPS `supportURL`。

这些字段会作用于页面标题、侧栏品牌、对话开场标记、登录/确认界面和一组受限 DSH 主题 token。它们不能注入任意 CSS、SVG、脚本或组件，也不会替换桌面外壳、更新器、配额界面和机构业务页面。完整字段、大小限制与安全规则见 [Enterprise Profile 规范](docs/enterprise-profile.md#品牌替换)。

## 最小接入步骤

1. 按[服务端接口规范](docs/server-integration-contract.md)联合提供 OIDC、Key Binding 和模型网关。
2. 为无 Client Secret 的 Public Client 精确登记 `http://127.0.0.1:3080/oauth/callback`。
3. 从 [`examples/enterprise-profile.example.json`](examples/enterprise-profile.example.json) 复制一份可信本地配置。
4. 在统一的 DSH `0.1.5-rc.1` 宿主中安装精确 npm 版本：

```bash
dsh plugin --profile web add @eduwork/dsh-oidc@0.2.3
```

需要审计、开发或测试尚未发布的改动时，也可以从本地 checkout 安装：

```bash
git clone https://github.com/ecnu/EduWork.git
cd EduWork/packages/dsh-oidc
npm ci
npm run check
dsh plugin --profile web add .
```

本地路径安装会把当前 checkout 以依赖链接到 DSH `web` Profile；安装后不要移动或删除源码目录。团队部署应固定经过复核的 npm 精确版本，不要混装其他 DSH 预发布线。

高级产品也可以在自己的 DSH bundle 中显式引入 `dsh-oidc`：

```yaml
- insert:
    - id: enterprise-oidc
      name: '@eduwork/dsh-oidc'
      config:
        profilePathEnv: EDUWORK_OIDC_PROFILE
```

5. 用环境变量传入配置文件路径，并让 DSH WebServer 监听 `127.0.0.1`：

```text
EDUWORK_OIDC_PROFILE=/etc/dsh/enterprise-profile.json
dsh --profile web --host 127.0.0.1 --port 3080
```

回调 host 与 path 不可配置。端口取 DSH WebServer 实际端口；如修改 `3080`，OIDC 注册值也必须同步修改。

## 最重要的部署约束

当前 Web backend 只支持“可信单用户机器上的一个本地 DSH 进程”，并强制 DSH WebServer 绑定 `127.0.0.1`。它不支持共享公网 Web，也不应通过反向代理暴露为多人站点。需要共享部署时，应由另一个具备每用户会话、凭据隔离、Cookie/CSRF 和存储安全的宿主实现新的 backend，而不是放宽本插件的 loopback 限制。详见 [`docs/security-model.md`](docs/security-model.md)。

## 协议原则

OIDC 部分坚持标准化，不增加机构私有的 UserInfo 映射语法：

- Discovery 的 `issuer` 必须与配置完全一致；
- OIDC endpoint 可以按标准位于不同 HTTPS origin；
- UserInfo 的 `sub` 必须等于 ID Token 的 `sub`；
- 展示名取 `name`，缺失时才取 `sub`；
- bootstrap 中即使返回姓名，也不得覆盖 OIDC 身份。

纯身份接入只需 OIDC，省略 `keyBinding` 与 `provider` 即可。需要自动获得企业 Key 和配置模型时，这两项必须同时配置，并提供 Key Binding 与模型网关。Key Binding 是本项目定义的企业协议：Profile 通过 `baseURL` 指定接口组，其余路径、请求字段和响应字段全部固定。Provider ID 决定运行路由；默认企业凭据统一使用 `EDUWORK_API_KEY`。旧自动名称兼容迁移，独立的自定义引用仍由 `keyBinding.credentialRef` 配置。凭据归属由已验证的身份、资源绑定和 Key 指纹校验，不改变服务端接口。完整接口见[服务端接口规范](docs/server-integration-contract.md)。

## 开发与复核

```bash
npm ci
npm run check
```

开发依赖与锁文件固定 DSH `0.1.5-rc.1`，不依赖开发机已有客户端目录。完整检查包括锁文件、所选 DSH 基线的 Host/Client/API 契约核对、Host/Client 构建、单元测试、OIDC 安全边界测试、JSON Schema 示例校验、OpenAPI 结构检查、敏感信息扫描和 npm tarball 预检。

插件与 EduWork 产品分别管理版本。装配使用精确 npm 版本及 integrity；源码路径用于开发。见[开发说明](docs/development.md)。

详细材料：

- [`docs/architecture.md`](docs/architecture.md)：组合架构与代码边界
- [`docs/server-integration-contract.md`](docs/server-integration-contract.md)：机构服务端必须共同实现的完整接口规范
- [`docs/getting-started.md`](docs/getting-started.md)：第三方从零接入、部署、验收与排障
- [`docs/enterprise-profile.md`](docs/enterprise-profile.md)：Enterprise Profile 字段和信任规则
- [`docs/oidc-interoperability.md`](docs/oidc-interoperability.md)：OIDC 兼容性要求
- [`docs/key-binding-protocol.md`](docs/key-binding-protocol.md)：Key Binding 规范
- [`docs/security-model.md`](docs/security-model.md)：威胁模型和部署要求
- [`docs/dsh-integration.md`](docs/dsh-integration.md)：DSH 服务依赖和扩展点
- [`docs/ecnu-reference.md`](docs/ecnu-reference.md)：华东师范大学参考组合（仅占位配置）
- [`docs/compatibility.md`](docs/compatibility.md)：版本与发布策略

代码和原创文档使用 MIT 许可证。ECNU/ChatECNU 示例不包含真实地址、Client ID 或密钥，也不授予任何校名、商标和品牌资产使用权。

源码、Issue 与 PR 统一在 [EduWork](https://github.com/ecnu/EduWork/tree/main/packages/dsh-oidc)。开发命令在 `EduWork/packages/dsh-oidc` 中执行，npm 安装保持独立；发布流程见[包维护说明](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES.md)。

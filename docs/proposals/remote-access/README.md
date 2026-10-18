# 远程访问提案：用另一台设备的浏览器操作本机 DSH Agent

**简体中文** | [English](README_EN.md)

状态：Draft。原型已实现并通过包内测试与真实设备验证，尚未发布；本文确定公共接口的边界与验收条件，不代表已经发布的功能或可直接照抄的配置。npm 发布、产品依赖锁、桌面 Release 与机构部署分别授权。

关联：[Issue #116](https://github.com/ECNU/EduWork/issues/116)；原型分支 `feat/remote-access-skeleton`；实现包 [`packages/dsh-remote-access`](../../../packages/dsh-remote-access/README.md)；中继部署 [`deploy`](../../../packages/dsh-remote-access/deploy/README.md)。

## 目标

让另一台设备（典型是手机）的浏览器跨网络查看并继续本机 EduWork/DSH Agent 的工作区、会话与任务，同时保住宿主的数据面：

1. 远端浏览器加载**宿主自己的 Web UI**，能列出/打开宿主工作区、读取会话历史、发送 prompt、接收流式事件。
2. 宿主与设备端到端加密；中继只转发密文，不持有宿主启动凭据。
3. 设备先配对/确认再连接；逐设备撤销，撤销同时切断已建连接。
4. 远端只获得明确列出的操作；宿主管理面（配对、凭据、插件装卸、终端、邀请）默认不可达。
5. 独立插件包 + 可自托管中继；不绑定学校、机构域名或公共服务。

维护者 2026-10-16 的方向作为本提案的约束：URL-first（任何浏览器打开即可，二维码只是便利）；配对后的远端终端可审批/拒绝、回答 Agent 提问；独立插件放 `packages/`，允许独立 npm 包；服务端可以是独立仓库；不以“零新依赖”为硬约束，优先复用官方 UI/连接层/成熟依赖；先原型，协议可收敛。

**非目标**：改变 DSH 内核 `/api` 的授权模型；多用户/多租户；公网 SaaS 中继、计费、企业目录集成；把宿主完整文件系统暴露给远端；本提案内完成 npm 发布或桌面 Release。

## 组件与信任边界

| 组件 | 位置 | 信任 |
| --- | --- | --- |
| 宿主插件 | `packages/dsh-remote-access`，DSH Host 进程内 | 可信；持有宿主身份与设备登记表 |
| 中继 | 独立进程/服务，可自托管 | **不可信**：只看到密文与路由元数据；可替换它下发的 bootstrap，因此部署者仍需可信 |
| 设备端 bootstrap | 中继下发的经典脚本 | 设备端加密与传输；设备私钥在浏览器 IndexedDB |
| 远端浏览器 | 现代浏览器（WebCrypto、IndexedDB、WebSocket） | 设备身份，需宿主确认 |
| 本机管理页 | 宿主 loopback Web 服务器 | 仅本机；per-boot token |

中继可见 hostId、连接时间、帧大小/时序，不能看到会话内容。它能替换 bootstrap，这是端到端加密不能防的；部署者必须可信，文档必须明说。设备被宿主确认后才进入 trusted；pending/revoked 设备在门禁处先于端点查询被拒绝。每台设备一份凭据；撤销同时使凭据作废并关闭实时通道。

## 协议与数据面

- 中继路径：宿主 `wss://<relay>/eduwork/host`；设备 `wss://<relay>/eduwork/peer?h=<hostId>`。hostId 首次注册时绑定公钥，换钥注册被拒；同键重连替换旧连接；同一 host 同时只接一个设备。
- 握手：P-256 ECDSA 身份 + ECDH 协商，导出方向独立的 AES-GCM 密钥；帧含版本、方向、严格递增序号；未认证/乱序帧丢弃。
- 应用层：`client-request`/`server-response` 信封；逻辑流帧 `open/item/end/cancel/error`；unary 与流共用密封通道。
- 流：`$events`（Gateway 转发事件，连接世代来源）、`workspace/follow`（工作区状态流）、`session/control`（审批/提问控制流）、`session/follow`（会话历史/状态流）。
- 门禁：`ENDPOINT_OPERATIONS` 把宿主 RPC 端点映射到 `surface:operation`；`gate.js` 的 `OPERATION_TABLE` 是唯一授权表。Agent 面：会话 list/read/create/prompt/cancel、工作区 list/read、artifact read/download、settings read、只读模型/任务目录。Host 面：代码级白名单只放行 `directory:list` 与 `workspace:create`；凭据、配对、插件、终端、邀请仍拒绝。未知端点按 `unknown-operation` 拒绝，不按名字猜。
- 有副作用的调用带客户端生成的 `requestId`；重连重发由宿主至多一次缓存吸收。

## Web UI 复用

远端跑官方 UI，而不是另做一个客户端：

1. 宿主用进程内 kernel cookie 取自己渲染后的 `/`（含 `__ModuleLoader__` facade、boot graph、index 注入行）与页面命名的 `/plugins/...` combo，导出快照。
2. 部署把快照镜像到中继；中继在 `/eduwork/` 提供服务，并在 `</head>` 注入设备 bootstrap。
3. bootstrap 安装 `__DSH_TRANSPORT__.rpc.call`，并实现 Gateway 的 `/api/remote.mux`：把 mux 的 JSON 帧接到同一条密封通道；`streamBaseUrl` 指向页面所在目录。
4. 远端页面 origin 与宿主不同：`<base href="./">` 保持相对资源；`/plugins` combo 由中继按 `sha256(path+query)` 回放；宿主 origin 不出现在页面里。
5. 非回环浏览器把 `isLoopback` 判为 false，宿主专属 settings 写入退化为进程内确认（预览版说明不再卡住）。

**上游耦合**：index 注入行、boot graph、`/plugins` combo 格式、`__DSH_CONNECTION_RECOVERY__`、`isLoopback` 语义。这些是 DSH `0.2.0-rc.2` 的宿主契约；上游改语义会破坏远端，需要同步评审。

## 本机组合与目录选择

远端选择工作区需要列宿主目录。官方为远程/无人值守宿主提供了 browse 后端与 browse 客户端；原型在 profile 组合里禁用桌面原生 picker，启用 browse 对。结果是**本机也使用应用内目录对话框**，这是已知兼容性影响。后续方向：按客户端条件化（本机原生、远端 browse），或提供远端专用入口。

`directory:list`/`workspace:create` 被归入**窄 host 面**，确认设备默认获得；这是本提案唯一新增的 host 授权，需要维护者明确认可。

## 兼容性边界

- DSH：Host 插件 API `0.2.0-rc.2`；依赖 `settings`、`connection`、`typertGateway.wireStream`、`webServer.collectIndexInjections` 等官方 seam。
- 浏览器：WebCrypto P-256/ECDH/AES-GCM、IndexedDB、WebSocket；已在 iPhone Safari 与 Chromium 验证。
- 宿主：Electron 桌面与 Web host；中继：Node，无额外原生依赖。
- 数据：设备身份存浏览器 IndexedDB；宿主身份存 `ctx.credentials`；设备登记存 settings 行；不迁移会话/工作区格式。
- 包：`@eduwork/dsh-remote-access`，`0.1.0-dev`，独立 npm 版本；新增到 `scripts/packages/catalog.mjs`。
- 组合：profile 的目录 picker 从 native 换成 browse；可回滚的配置改动，但影响本机 UX。
- 公开示例使用合成工作区、占位域名与合成设备 ID；不提交真实会话、路径、密钥或机器配置。

## 验收条件

1. 未配对设备被拒绝；错误不泄露端点是否存在。
2. 配对设备可 `session/list`、`session/page`、`session/prompt`，收到流式事件；控制流可用。
3. 断线重连不重复执行有副作用的操作（`requestId` 至多一次）。
4. 撤销设备后，其已建立连接立即断开，后续握手被拒。
5. 远端浏览器从**中继**加载宿主渲染的 UI，工作区列表与会话历史正确显示；移动网络可用。
6. 中继只看到密文；设备无法访问凭据/配对/插件/终端/邀请管理。
7. 中继重启、宿主重连后恢复；同键新连接替换旧连接。

每个 PR 报告实际执行的验证与未验证范围。包内测试、协议级设备验收与真实设备验收分别记录；模拟契约测试不能替代真实网络与桌面行为。

## 未决问题

1. 提案与 Draft PR 的顺序（先提案，还是 PR 内附提案）。
2. 设备端 bootstrap 是否作为公开源码放进包（部署可复现），以及部署者信任的文档措辞。
3. 窄 host 面的边界是否接受；是否要求本机原生目录对话框在本 PR 内解决。
4. 邀请码与中继访问密钥是否作为 v1 的阻塞项。
5. 审批/提问的端到端验收是否 v1 必须。
6. npm 发布/依赖锁/Release 的时机（与本提案分离）。

## 演进

- v1：邀请码真实流程、中继访问密钥、审批/提问验收、PC 原生目录对话框条件化、iOS 后台重连。
- 之后：多设备并发策略、中继可观测性、bootstrap 的完整性与可替换性讨论。

# 变更日志

**简体中文** | [English](CHANGELOG_EN.md)

记录本包的重要变更。项目使用语义化版本，1.0 之前的兼容性说明见[协议文档](docs/protocol.md)的版本一节。

## 0.1.0-dev — 未发布

本包**尚未发布到 npm**，也还没有被装配进公开发行版。下面记的是它当前包含什么、处于什么状态，不是一份可以照抄的发布说明；发布说明由维护者确认后再写。

**已实现**

- 设备登记、逐设备凭据、逐设备撤销与活动连接管理；宿主身份持久化在 `ctx.credentials`，不再每次启动重新生成；本机管理页（loopback、per-boot token）列出/确认/撤销/移除设备。
- 端到端通道：P-256 ECDSA + ECDH 握手、方向独立的 AES-GCM 帧、严格递增序号；未认证/乱序帧丢弃；宿主与设备两端都按序串行化收发。
- 自托管中继：`/host` 注册与 hostId 绑定、`/peer` 设备接入、同键重连替换旧连接、单设备链路、静态 Web 壳与 `/plugins` combo 服务、bootstrap 注入；中继只转发密文。注册使用 `eduwork-relay/2` 的持有证明（nonce+hostId+publicKey 签名），验签失败不能替换已有主机。
- 会话隔离与幂等：异步响应、流事件和发送队列绑定发起会话，设备断开后的迟到帧被丢弃；宿主按 `(deviceId, requestId, endpoint, payload)` 去重成功副作用并合并并发同键请求。
- DSH 0.2.1 接入：官方 owner `Peer`（`browserPeer`/`operator`）传给 `wireStream.open` 与共享 fetch 处理器；响应信封按公开契约严格解码，不再读取客户端私有 bundle 路径。
- 逻辑流：`$events`、`workspace/follow`、`session/control`、`session/follow` 与 unary 共用密封通道；工作区列表、会话历史、流式事件可用。
- 门禁接线：`gate.js` 的 `OPERATION_TABLE` 是唯一授权表，`channel/operations.js` 映射宿主端点；Agent 面放行会话/工作区/artifact/settings 只读与 prompt/cancel/create，Host 面代码级白名单只放行 `directory:list` 与 `workspace:create`。
- Web 壳复用：宿主用进程内 cookie 导出渲染后的 index、注入行与 `/plugins` combo；中继镜像；远端浏览器跑宿主自己的 UI。
- 应用内目录浏览组合（`dsh-host-directory-picker-browse` + `dsh-client-ui-directory-picker-browse`），供远端选择工作区目录；本机也使用同一对话框（已知限制）。
- 319 项包内测试；协议级设备验收、桌面浏览器与真实手机（Wi-Fi）验收通过。

**未完成 / 已知限制**

- 一次性邀请码的真实流程未接线；当前实际流程是 pending+confirm。
- 中继访问密钥未实现；知道 hostId 只能发起连接尝试，仍需宿主确认设备。
- 审批/提问的端到端验收未做（控制流已放行）。
- 本机原生目录对话框未恢复；组合切换影响本机 UX。
- iOS 切后台会挂起 WebSocket，当前需要手动刷新；自动重连是后续项。
- 同一 host 同时只接一个设备。
- 中继可替换其下发的 bootstrap；部署者信任是前提。
- 非回环浏览器的预览版说明确认只保留在进程内，刷新后会再次出现。

**发布说明**

`0.1.0-dev` 不代表可发布版本。npm 发布、产品依赖锁、桌面 Release 与机构部署分别授权；版本号与 Release notes 由维护者确认。

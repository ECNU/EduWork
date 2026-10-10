# @eduwork/dsh-remote-access

[English](README_EN.md) | 中文

让**另一台设备**通过 Web 查看并继续本机 DSH Agent 正在运行的会话、任务与工作区成果。

这是一个 **DSH 插件**：设备登记、一次性配对、设备凭据、活动连接管理与中继门禁。
操作面围栏的决策表在 `./gate`，但**尚未接线**——详见下文。
它不绑定任何学校、机构域名或公共服务 —— 中继是可选组件，
同 LAN、自建 VPN、端口转发都能在没有中继的情况下工作。

## 功能

| 能力 | 说明 |
| --- | --- |
| **逐设备身份** | 每台设备一份独立凭据，可单独撤销，互不影响 |
| **一次性配对** | 短时邀请码，用过即失效；重放、迟到、错字三者不可区分 |
| **本机确认** | 设备必须由人**在这台机器上**确认后才生效，不由远端自行决定 |
| **撤销即断连** | 撤销会**同时**使凭据作废并切断该设备已建立的长连接，而不只是拒绝下一个请求 |

### 操作面围栏为什么还不能算数

`./gate` 里的 `decide()` 把远端可做的操作列成了一张表——会话与工作区**只读加一次
`prompt`**，宿主管理面（配对、凭据、插件装卸、终端、`workspace:write`）一律拒绝。
这张表是**纯函数**，有测试，但它**目前没有任何调用方**：`./listener` 只按路径放行，
不看操作。

更要紧的一点不是「还没接线」，而是**按当前设计接上也拿不回来**。中继要让手机进得了
宿主自己的门，就得把宿主的启动凭据交给它（见下文「已知取舍」）。手机因此持有一个
**完整的宿主浏览器会话**——宿主愿意给这个会话的权限，中继在路径上再拦一道也剥夺不掉。
真正的围栏得由**宿主**在它自己的授权层执行，而不是由前面的一道 HTTP 中继执行。

所以：`decide()` 是下一阶段的输入，不是本阶段的安全边界。**不要因为 `./gate` 有导出
就认为远端碰不到宿主管理面。**

## 安装

```bash
npm install @eduwork/dsh-remote-access
```

插件以普通 DSH 插件形式装配，`inject: ['settings']`，把设备登记表挂到
`ctx.settings` 的 `eduwork-remote-access` 命名空间下，并通过 `ctx.provide('remoteAccess', …)`
发布给同一进程内的其他插件。

## 快速上手

```js
import { DeviceStore, createGatedRelay } from '@eduwork/dsh-remote-access/listener'
import { LiveConnections } from '@eduwork/dsh-remote-access/connections'
import { emptyCredentials, issueCredential, authenticate } from '@eduwork/dsh-remote-access/credentials'
import { createInvitation, redeemInvitation } from '@eduwork/dsh-remote-access/pairing'
import { decide } from '@eduwork/dsh-remote-access/gate'

// 1. 发一条一次性邀请（只把 code 交给设备，登记表里只留摘要）
const { invitations, code } = createInvitation(emptyInvitations(), { now: new Date().toISOString() })

// 2. 设备拿 code 来兑换；兑换发生在校验之前，所以重放与错字留下的状态相同
const { invitations: remaining } = redeemInvitation(invitations, code, new Date().toISOString())

// 3. 只有摘要落盘；明文密钥只出现这一次
const { store, secret } = issueCredential(emptyCredentials(), deviceId, new Date().toISOString())

// 4. 每次请求校验凭据（常数时间比较）
const { ok } = authenticate(store, deviceId, secret, new Date().toISOString())

// 5. 决定某个操作是否允许（默认拒绝）
const verdict = decide(device, 'session:prompt')   // { allowed: true, sideEffect: true }

// 6. 撤销时先封设备再清扫，撤销瞬间正在握手的连接会失败而不是溜过
const live = new LiveConnections()
live.closeAll(deviceId)

// 7. 把闸装到宿主前面：宿主只监听回环，中继是唯一的门
const relay = createGatedRelay({
  hostPort: 8901,                       // 宿主的回环端口
  store: new DeviceStore('.state/devices.json'),
  onRequest: async device => confirmInPerson(device),   // 由人在这台机器上决定
  upstreamToken: () => hostLaunchToken(),
})
relay.listen(8899, '0.0.0.0')
```

## 已知取舍

**手机持有宿主自己的会话凭据。** 中继要让手机进得了宿主的门，就得把宿主的启动凭据
转交给它。这是本阶段最重的一条取舍：手机拿到的不是一份被裁剪过的权限，而是一个
**完整的宿主浏览器会话**。上面那条「操作面围栏」之所以不能算数，根子在这里，不在
`./gate` 有没有接线。

**中继不替宿主做幂等。** 有副作用的调用带着客户端生成的 `requestId` 一路透传，去重由
宿主的 `hasPromptRequest` 负责——它同时覆盖「已入队未执行」和「已进事件流」两个窗口。
中继自己再去重，反而是多一份会和宿主不一致的状态。

**`./gate` 是下一阶段的输入。** 它的表是完整的、有测试的，也是宿主侧执行围栏时该用的
东西。本阶段它不构成安全边界。

**包里有两处可以记设备的地方，它们互不可见。** `./`（`src/index.js`）的 `DeviceRegistry`
是面向产品的那一份：存在宿主的 settings 里，**只有设备**。`./listener` 的 `DeviceStore`
是中继真正查的那一份：一个文件里同时放着**设备、凭据和邀请**，好让一次撤销不会留下前两者
互相矛盾。中继用不了 settings——它可以脱离 Cordis 独立运行，没有宿主可注入。

单独看，两份都没有错；错在把它们当成同一张表。**经其中一份确认的设备，另一份不知道**，
而本包没有任何东西让它们保持同步。这个义务属于把本包装配进产品的人，不属于任何一份存储。
`test/index.test.mjs` 里有一条测试把这份隔离钉住：将来若有人把它们合并，那条测试失败就是
提醒——文档和集成约定要跟着改。

## 状态

| 部分 | 状态 |
| --- | --- |
| 设备登记表、一次性配对、设备凭据、活动连接管理 | **已实现**，`node --test` 覆盖 |
| 门禁中继（`./listener`）：准入门禁、配对入口与等待页、逐设备撤销 | **已实现**，`node --test` 覆盖 |
| 操作面围栏（`./gate`）：决策表本身 | **已实现但未接线**——见上文，没有任何调用方 |
| 宿主侧执行围栏、装配进产品运行时、独立的 Web 客户端、端到端加密 | **计划中**，本包不含 |

本包的逻辑模块**不做 I/O**：时间由调用方传入，因此配对与撤销语义可以被直接测试。
`./listener` 是唯一持有文件与网络的模块，它把存储位置、监听端口与拓扑留给使用方决定。

## 文档

- [远程接入协议 v1](docs/protocol.md) —— 设备、中继与宿主之间的契约，
  包括凭据划分、门禁顺序、撤销的三个动作与幂等规则。

## 许可

MIT

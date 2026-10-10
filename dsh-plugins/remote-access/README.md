# @chatecnu-work/dsh-remote-access

[English](README_EN.md) | 中文

让**另一台设备**通过 Web 查看并继续本机 DSH Agent 正在运行的会话、任务与工作区成果。

这是一个 **DSH 插件**：设备登记、一次性配对、设备凭据、操作面围栏与活动连接管理。
它不绑定任何学校、机构域名或公共服务 —— 中继是可选组件，
同 LAN、自建 VPN、端口转发都能在没有中继的情况下工作。

## 功能

| 能力 | 说明 |
| --- | --- |
| **逐设备身份** | 每台设备一份独立凭据，可单独撤销，互不影响 |
| **一次性配对** | 短时邀请码，用过即失效；重放、迟到、错字三者不可区分 |
| **本机确认** | 设备必须由人**在这台机器上**确认后才生效，不由远端自行决定 |
| **撤销即断连** | 撤销会**同时**使凭据作废并切断该设备已建立的长连接，而不只是拒绝下一个请求 |
| **操作面围栏** | 默认拒绝；远端**够不到**宿主管理面（凭据、插件装卸、终端、`workspace:write`） |

## 安装

```bash
npm install @chatecnu-work/dsh-remote-access
```

插件以普通 DSH 插件形式装配，`inject: ['settings']`，把设备登记表挂到
`ctx.settings` 的 `chatecnu-remote-access` 命名空间下，并通过 `ctx.provide('remoteAccess', …)`
发布给同一进程内的其他插件。

## 快速上手

```js
import { DeviceStore, createGatedRelay } from '@chatecnu-work/dsh-remote-access/listener'
import { LiveConnections } from '@chatecnu-work/dsh-remote-access/connections'
import { emptyCredentials, issueCredential, authenticate } from '@chatecnu-work/dsh-remote-access/credentials'
import { createInvitation, redeemInvitation } from '@chatecnu-work/dsh-remote-access/pairing'
import { decide } from '@chatecnu-work/dsh-remote-access/gate'

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

## 状态

| 部分 | 状态 |
| --- | --- |
| 设备登记表、一次性配对、设备凭据、操作面围栏、活动连接管理 | **已实现**，`node --test` 覆盖 |
| 门禁中继（`./listener`）：准入门禁、配对入口与等待页、逐设备撤销 | **已实现**，`node --test` 覆盖 |
| 装配进产品运行时、独立的 Web 客户端、端到端加密 | **计划中**，本包不含 |

本包的逻辑模块**不做 I/O**：时间由调用方传入，因此配对与撤销语义可以被直接测试。
`./listener` 是唯一持有文件与网络的模块，它把存储位置、监听端口与拓扑留给使用方决定。

## 文档

- [远程接入协议 v1](docs/protocol.md) —— 设备、中继与宿主之间的契约，
  包括凭据划分、门禁顺序、撤销的三个动作与幂等规则。

## 许可

MIT

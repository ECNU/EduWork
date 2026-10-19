# 远程接入协议 v2（`eduwork-remote/2`）

状态：原型。本文描述**当前产品路径**：设备端 bootstrap、自托管中继与宿主隧道之间的线协议。旧的「门禁中继 + `/__remote/*` 控制面 + 宿主启动凭据」协议归档在 [v1](protocol-v1.md)，它只对应包内的 legacy `./listener`，不是远端 Web UI 的路径。

协议不依赖任何学校、机构域名或公共服务；中继是可选组件，但远端浏览器要跨网络访问宿主时需要一个可路由的转发点。

## 1. 角色与信任

| 角色 | 职责 | 不做什么 |
| --- | --- | --- |
| 设备端 bootstrap | 持有设备私钥；握手；密封每一帧；把 Gateway mux 接到密封通道 | 不管理宿主；不读取中继状态之外的东西 |
| 中继 | `/host` 注册、`/peer` 接入、转发密文、静态壳与 combo、bootstrap 注入 | 不解析业务内容；不持有宿主密钥；不替宿主去重 |
| 宿主隧道（插件） | 识别设备、门禁、执行 RPC、承载逻辑流 | 不把宿主 token 交给设备 |
| Web 壳 | 宿主自己渲染的 index、注入行与 `/plugins` combo | 不包含宿主凭据 |

中继是**不可信**的：它能看到 hostId、连接时间、帧大小/时序；它**能够替换自己下发的 bootstrap**，所以部署者必须可信。端到端加密防的是中继以外的第三方。

## 2. 版本

- 应用层协议字符串：`eduwork-remote/2`（握手消息的 `v` 与 bootstrap/宿主一致）。
- 帧头版本字节：`0x02`；帧头 11 字节，GCM tag 16 字节。
- 中继注册帧有自己的 `v`（`RELAY_VERSION`，当前 `eduwork-relay/2`）；不匹配即拒绝。`eduwork-relay/1` 的注册签名只覆盖 nonce，已废弃。
- v1（`eduwork-remote/1`）是遗留的 listener 协议，见 [protocol-v1.md](protocol-v1.md)。

## 3. 标识与凭据

**宿主身份**由两对 P-256 密钥组成：签名（ECDSA/SHA-256）与协商（ECDH）。持久化在 `ctx.credentials` 的 `remote-access/host-identity`，不是每次启动生成；宿主公钥以 `p256:<base64url>` 形式出现在中继绑定与设备 pin 中。

**设备身份**同样由签名与协商两对密钥组成，私钥在浏览器 IndexedDB，公钥随 `hello` 发送。宿主登记表记录 `deviceId`、`publicKey`、`agreementKey`、`status`（pending/trusted/revoked）、`surfaces`（agent/host 的授权操作列表）。

- 未登记设备：宿主先记录为 pending（`onUnknownDevice`），然后**仍拒绝握手**；确认只能在本机管理页发生。
- 首次成功握手后设备 pin 住宿主公钥；之后宿主公钥变化在**任何密码学之前**被拒绝。
- 一次性邀请码是模块级实现（`pairing.js`），当前实际流程是 pending+confirm；中继访问密钥尚未实现。
- 握手结束时两端得到同一个**短认证字符串（SAS）**，供人核对；它不替代设备确认，只是让双方确认没有中间人。

## 4. 传输与中继注册

- 宿主：`wss://<relay>/<prefix>/host`。连接后中继发 `challenge`；宿主回 `register`（hostId、publicKey、sig）；中继回 `registered` 或 `denied`。
- 设备：`wss://<relay>/<prefix>/peer?h=<hostId>`。中继把设备接到该 host 的链路，并在两端 `ready` 后才放行数据帧；设备先发的帧被扣住，READY 后按原序补发。
- 中继对 hostId 做 trust-on-first-use 绑定，但**注册必须证明持有私钥**：`challenge` 是每次连接新生成的 32 字节随机数；宿主对长度前缀编码的 `eduwork-relay-v2 || nonce || hostId || publicKey` 做 ECDSA P-256/SHA-256 签名。中继**先验签，再读写绑定或替换连接**。
- 首次注册：验签通过才记下公钥；失败回 `denied`/`bad-signature`，不落盘。换钥注册回 `host-id-taken`。
- 同一 host 已有在线连接时，**同钥且签名有效**的新连接替换旧连接（旧 socket 以 1000 关闭）；同钥但签名无效回 `bad-signature`，旧连接不受影响。不同钥仍拒绝。
- 同一 host 同时只接一个设备；已有设备时新设备收到 `host-busy` / 对应关闭。
- 宿主为每个设备会话建立独立通道；异步响应、流事件、取消和发送队列都绑定该会话。设备断开后，迟到帧被丢弃，不会用新会话的密钥和序号发给下一台设备。
- 中继不解析、不改写、不去重业务内容；它只验证注册身份并转发两个方向的帧。它不持有任何长期私钥。

## 5. 握手

消息按序：

1. 设备 → 宿主：`hello`
   `{ t:'hello', v, deviceId, Sh, Xh, Rp, Ep }`
   `Sh`/`Xh` 是设备签名/协商公钥，`Rp` 是设备 nonce，`Ep` 是设备临时公钥。
2. 宿主 → 设备：`host`
   `{ t:'host', v, Sh, Xh, Rh, Eh, sig }`
   `sig` 是宿主对 transcript 的签名；设备先用 pin 核对 `Sh`，再验签。
3. 设备 → 宿主：`prove`
   `{ t:'prove', v, sig }`
   设备对同一 transcript 的签名；宿主核对设备记录中的公钥。
4. 宿主 → 设备：`ready`
   连接建立；随后的帧都是密封的。

**transcript** 绑定：hostId、deviceId、双方静态签名公钥、双方 nonce、双方临时公钥。签名分别用域分隔 `eduwork-host-v2`（host）与 `eduwork-peer-v2`（prove）；`ready` 用 `eduwork-ready-v2`。

**会话密钥**：临时 ECDH 秘密与静态 ECDH 秘密（双方协商密钥）连同 transcript 派生 `peerToHost`、`hostToPeer` 与 `sas`。两个方向使用不同密钥；nonce 由方向与序号确定。

**失败**：`transcript-invalid`、`host-signature-invalid`、`peer-signature-invalid`、`device-unknown`、`device-revoked`、`protocol`。设备端在失败时关闭并显示原因；宿主端关闭该设备链路，但不影响其他设备。

## 6. 帧

```
+--------+-----------+------------------+--------+
| version| direction | sequence (u64 BE) | kind  |
+--------+-----------+------------------+--------+
| ciphertext ...                           | tag   |
+------------------------------------------+-------+
```

- `version` = `0x02`；`direction` = `0x01`（peer→host）或 `0x02`（host→peer）；`sequence` 严格递增；`kind` 区分 handshake/call。
- AES-GCM，`tag` 16 字节；nonce 由方向与序号确定；header 作为附加认证数据。
- 接收端期望**恰好**下一个序号；乱序/重放/未认证一律丢弃。一个帧丢失会让该会话后续帧全部失败，这是有意的：宁可断开，不接受空洞。
- 两端都对入站帧串行化（`session.open` 的序号检查发生在异步解密之前，并发处理会让按时到达的帧被误判）；发送也串行化，保证线序与序号一致。

## 7. 应用层

**unary**：`{ type:'client-request', rpcId, method, payload }`；宿主回 `{ type:'server-response', rpcId, result }`。`result.ok` 为 true 时带 `value`，否则带 `{ code, message, details }`。

**流**：`{ type:'open', streamId, endpoint, payload }`、`{ type:'item', streamId, value }`、`{ type:'end', streamId }`、`{ type:'cancel', streamId }`、`{ type:'error', streamId, error }`。流端点：

| 端点 | 用途 |
| --- | --- |
| `$events` | Gateway 转发的连接事件，连接世代来源 |
| `$events/result` | 客户端回答 Host 的 waterfall |
| `workspace/follow` | 工作区状态流：baseline + upsert/remove/order |
| `session/control` | 审批与提问控制流 |
| `session/follow` | 会话历史/状态流 |

`$events` 与 `$events/result` 是 Gateway 内部端点，单独列在 `CONNECTION_ENDPOINTS`，仍要求 trusted 设备。

**幂等**：有副作用的 unary 带客户端生成的 `requestId`；宿主按 `requestId` 至多一次。中继不缓存、不去重。

## 8. 门禁

- `ENDPOINT_OPERATIONS` 是唯一的端点→操作映射；`OPERATION_TABLE` 是唯一的操作表。未知端点回 `unknown-operation`，不按名字猜。
- 判定顺序：设备状态（unknown/pending/revoked）→ 操作是否存在 → host 白名单 → 设备授权面。未授权设备问不出端点是否存在。
- Agent 面：会话 list/read/create/prompt/cancel、工作区 list/read、artifact read/download、settings read、只读模型/任务目录、控制流与提问。
- Host 面：代码级白名单只放行 `directory:list` 与 `workspace:create`；凭据、配对、插件装卸、终端、邀请仍拒绝。
- 撤销：先封设备，再关闭其活动连接；撤销后新的握手回 `device-revoked`。

## 9. Web 壳与 bootstrap

远端页面不是中继上的静态 dist，而是宿主自己渲染的 `/`：

1. 宿主用进程内 kernel cookie 取 `/`（含 `__ModuleLoader__` facade、boot graph、index 注入行），与页面命名的 `/plugins/...` combo 一起导出快照。
2. 中继在 `/eduwork/` 提供 index，在 `</head>` 注入 `bootstrap.js`；combo 由 `sha256(pathname+search)` 回放。
3. bootstrap 在应用模块读取之前安装 `__DSH_TRANSPORT__.rpc.call`，并把 Gateway 的 `/api/remote.mux` 做成同一条密封通道上的 JSON 帧；`streamBaseUrl` 指向页面所在目录。
4. `<base href="./">` 让壳资源相对解析；`/plugins` 的根相对 URL（如有）需要改写到中继的公开前缀。
5. 非回环浏览器 `isLoopback=false`：宿主专属 settings 写入退化为进程内确认，预览版说明不会卡住。

## 10. 重连与关闭

- 设备掉线：宿主收到 `peer-gone`，关闭该设备的流；宿主的中继链路保留。
- 宿主重连中继：同钥替换旧连接；设备重连后重新握手。
- 设备重连：客户端重建 mux 与传输；有副作用的请求用原 `requestId` 重发时至多一次。
- 关闭原因：`device-unknown`、`device-revoked`、`host-busy`、`host-id-taken`、`host-already-online`、`transport`。中继关闭码 1008/1000 用于拒绝与替换。

## 11. 兼容性

- 宿主插件 API：DSH `0.2.0-rc.2`（`settings`、`connection`、`typertGateway.wireStream`、`webServer.collectIndexInjections`）。
- 浏览器：WebCrypto P-256/ECDH/AES-GCM、IndexedDB、WebSocket；iOS Safari 与 Chromium 已验证。
- 中继：Node，无额外原生依赖；loopback 绑定，TLS 由反向代理终止。
- 上游契约：index 注入行、boot graph、`/plugins` combo、`__DSH_CONNECTION_RECOVERY__`、`isLoopback`。上游改这些语义需要同步评审。

## 12. 版本历史

| 版本 | 状态 | 说明 |
| --- | --- | --- |
| `eduwork-remote/1` | 遗留 | 门禁中继、`/__remote/*`、宿主启动凭据、cookie 设备凭据；对应 `./listener`，不是远端 Web UI 路径。 |
| `eduwork-remote/2` | 当前原型 | 中继只转发密文；设备身份 + 握手 + 密封帧 + 逻辑流；Web 壳复用。 |

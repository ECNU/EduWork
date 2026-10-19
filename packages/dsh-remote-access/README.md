# @eduwork/dsh-remote-access

[English](README_EN.md) | 中文

让**另一台设备**通过浏览器跨网络查看并继续本机 EduWork/DSH Agent 的工作区、会话与任务。

本包是一个 **DSH 插件**，配套可自托管的**中继**和**设备端 bootstrap**：宿主与设备端到端加密，中继转发握手元数据与密文业务帧，不持有宿主启动凭据。远端浏览器加载的是**宿主自己渲染的 Web UI**，而不是另做的客户端。

> 状态：原型（`0.1.0-dev`，未发布 npm）。已通过 314 项包内测试、协议级设备验收、桌面浏览器与真实手机（Wi-Fi）验收；邀请码真实流程、中继访问密钥、审批/提问端到端、iOS 切后台重连尚未完成。公共接口与验收条件见[提案](../../docs/proposals/remote-access/README.md)；npm 发布、产品依赖锁与桌面 Release 另行授权。

## 它能做什么

- **URL-first**：手机打开 `https://<relay>/eduwork/?h=<hostId>`，加载宿主的 Web UI。
- **工作区与会话**：远端看到宿主自己的工作区列表，打开/继续已有会话，读取历史，发送 prompt 并接收流式事件。
- **本机确认**：新设备在宿主上显示为 pending，由人在本机管理页确认后才生效；每台设备一份身份，可单独撤销，撤销同时切断已建连接。
- **审批与提问通道**：`session/control` 与 `userQuestions/*` 已放行，远端可走与本地相同的控制流（端到端验收待补）。
- **目录选择**：远端可以通过宿主的目录浏览器选择/创建作为工作区的文件夹（窄 host 面，见下）。
- **不依赖公共服务**：中继可自托管；协议不假设任何学校、机构域名或特定外部服务。

## 组成

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 宿主插件 | 本包 `src/index.js` | 设备登记、宿主身份、隧道、门禁、管理页、Web 壳快照 |
| 中继 | `src/relay/relay.js` | 自托管；`/host` 注册、`/peer` 接入、静态壳与 combo 服务、bootstrap 注入 |
| 设备端 bootstrap | `deploy/web/bootstrap.js` | 设备密钥、握手、密封通道、Gateway mux 适配、连接恢复 |
| 本机管理页 | 宿主 loopback Web 服务器 | 列出/确认/撤销/移除设备；per-boot token |
| 部署样例 | `deploy/` | systemd、Caddy、环境变量、Web 壳镜像脚本 |

## 安全模型

**信任边界**：中继不可信。它看到 hostId、连接时间、帧大小/时序，以及握手阶段的 deviceId、双方公钥与来源 IP；业务帧（请求/响应/流）是密文。它**可以替换自己下发的 bootstrap**，所以部署者必须可信。端到端加密防的是中继以外的第三方，但它不能隐藏握手元数据。

**设备身份**：设备密钥在浏览器 IndexedDB；宿主身份在 `ctx.credentials`；设备登记在 settings 行。未确认设备在门禁处先于端点查询被拒绝。

**操作面**：`gate.js` 的 `OPERATION_TABLE` 是唯一授权表，`channel/operations.js` 把宿主 RPC 端点映射到操作；未知端点按 `unknown-operation` 拒绝，不按名字猜。

| 面 | 放行 | 拒绝 |
| --- | --- | --- |
| Agent | `session:list`/`read`/`create`/`prompt`/`cancel`、`workspace:list`/`read`、`artifact:read`/`download`、`settings:read`、只读模型/任务目录 | 其余 |
| Host（窄） | `directory:list`、`workspace:create` | 凭据、配对、插件装卸、终端、邀请 |

**撤销**：先封设备再清扫；已建长连接被切断，不只是拒绝下一个请求。

**幂等**：有副作用的调用带客户端生成的 `requestId`，宿主侧至多一次；中继不替宿主去重。

## 安装与配置

### 1. 装配插件

在 DSH profile 的 `dsh.profile.bundles` 中加入本包，并在 profile 的 `cordis.patch.yml` 中配置：

```yaml
- {
    "id": "eduwork-remote-access",
    "config":
      {
        enabled: true,
        devices: [],
        relay: { url: "wss://<relay-host>/eduwork", hostId: "<host-id>" }
      }
  }
```

行 id 必须与 `@deepseek-ai/dsh-api-remote-access` 的 `remote-access` 区分开：DSH 0.2.1-rc.2 起后者由 base bundle 占用，同 id 会替换它而不是叠加，导致客户端半边不挂载、UI 插件一直 pending。

`devices` 由插件写入（宿主身份、确认过的设备），通常不需要手填；`hostId` 是宿主在中继上的唯一标识，首次注册会验证宿主对 nonce、hostId 和公钥的签名，再绑定公钥。

### 2. 部署中继

见 [`deploy/README.md`](deploy/README.md)：systemd、Caddy、环境变量、前端镜像；远端 URL 是 `https://<relay-host>/eduwork/?h=<hostId>`。

### 3. 确认第一台设备

1. 手机打开上面的 URL；bootstrap 生成设备身份并连接宿主。
2. 宿主日志出现 `admin page http://127.0.0.1:<port>/remote-access-admin/<token>/`；在本机打开它，确认 pending 设备。
3. 手机刷新同一标签页；设备进入 trusted，工作区列表与会话历史可用。

> 一次性邀请码（`pairing.js`）还是模块级实现，当前实际流程是 pending+confirm；中继访问密钥尚未实现。不要把 hostId/设备 ID/工作区路径贴到公开 issue 或截图里。

## 已知限制

- **邀请码真实流程**未接线；当前是 pending+confirm。
- **中继访问密钥**未实现；知道 hostId 只能发起连接尝试，仍需宿主确认设备。
- **审批/提问**的端到端验收未做。
- **本机目录对话框**：为远端目录选择切换了 profile 组合，本机也使用应用内对话框；恢复本机原生是后续项。
- **iOS 切后台**会挂起 WebSocket，当前需要手动刷新；自动重连是后续项。
- **单设备**：同一 host 同时只接一个设备。
- **bootstrap 可被中继运营者替换**；部署者信任是前提。
- 预览版说明在非回环浏览器只保留进程内确认，刷新后会再次出现。

## 开发与测试

```bash
node scripts/build.mjs                  # src -> lib
node --test test/*.test.mjs             # 309 tests
```

测试覆盖设备登记/凭据/配对/撤销、门禁、握手、帧序列、逻辑流、中继注册与转发、tunnel、Web 壳快照、管理页等；真实设备验收见 PR 描述，模拟测试不替代真实网络与桌面行为。

## 文档

- [远程访问提案](../../docs/proposals/remote-access/README.md) —— 公共接口、信任边界、兼容性与验收条件。
- [协议 v2](docs/protocol.md) —— 设备、中继与宿主之间的线协议。
- [中继部署](deploy/README.md) —— 自托管、Caddy、Web 壳镜像与排障。
- [变更日志](CHANGELOG.md)。

## 许可

MIT

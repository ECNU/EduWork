# 自托管中继部署

**简体中文** | [English](README_EN.md)

本目录是**部署样例**，不是 npm 包的运行时依赖。中继只转发密文；它不持有宿主密钥，也不需要凭据。`server.mjs` 只读环境变量，不包含业务逻辑。

**信任边界**：中继下发的 `bootstrap.js` 是设备端加密的起点，中继运营者可以替换它。端到端加密只防中继以外的第三方；部署者必须可信。当前版本没有中继访问密钥，任何知道 hostId 的人都能尝试连接，最终仍要宿主确认设备。

## 组成

| 文件 | 用途 |
| --- | --- |
| `server.mjs` | 中继入口；从 `EDUWORK_RELAY_*` 读配置 |
| `relay.js`、`protocol.js`、`websocket.js` | 从构建产物 `lib/relay/` 复制到 `/opt/eduwork-relay/` |
| `web/bootstrap.js` | 设备端脚本；中继通过 `EDUWORK_RELAY_BOOTSTRAP_SCRIPT` 注入 |
| `eduwork-relay.service` | systemd unit（loopback、动态用户、状态目录） |
| `eduwork-relay.env` | 环境变量样例；安装到 `/etc/eduwork-relay.env` |
| `mirror-web-snapshot.mjs` | 把宿主导出的 Web 壳快照整理成中继的 frontend 根 |
| `frontend/` | 运行时生成（见下文），不提交 |

## 1. 准备中继

```bash
# 在仓库里构建包
cd packages/dsh-remote-access
node scripts/build.mjs

# 服务器上
install -d /opt/eduwork-relay/web /opt/eduwork-relay/frontend
install -m 0644 lib/relay/relay.js lib/relay/protocol.js lib/relay/websocket.js /opt/eduwork-relay/
install -m 0755 deploy/server.mjs /opt/eduwork-relay/server.mjs
install -m 0644 deploy/web/bootstrap.js /opt/eduwork-relay/web/bootstrap.js
install -m 0644 deploy/eduwork-relay.service /etc/systemd/system/eduwork-relay.service
install -m 0600 deploy/eduwork-relay.env /etc/eduwork-relay.env
```

- `EDUWORK_RELAY_BIND` 保持 `127.0.0.1`；公网入口由 Caddy 终止 TLS。
- `EDUWORK_RELAY_STORE` 必须落在 unit 的 `StateDirectory` 里；它是 trust-on-first-use 的 hostId→公钥绑定，丢失后别人可以抢注该 hostId。
- `EDUWORK_RELAY_FRONTEND_ROOT` 指向下面第 3 步的镜像目录。
- `EDUWORK_RELAY_BOOTSTRAP_SCRIPT` 是**浏览器能取到的 URL**；反向代理剥掉前缀时不能写中继内部路径。

## 2. Caddy

```caddyfile
<relay-host> {
  handle_path /eduwork* {
    reverse_proxy 127.0.0.1:8792
  }
}
```

`handle_path` 会把 `/eduwork` 剥掉，所以中继看到的是 `/host`、`/peer`、`/`、`/plugins/...`、`/eduwork-assets/...`。设备页 URL 是：

```
https://<relay-host>/eduwork/?h=<hostId>
```

## 3. 镜像宿主的 Web 壳

远端页面跑的是**宿主自己渲染的 index**，不是中继上的静态 dist。宿主插件提供 `POST /remote-access-admin/<token>/export-web`（token 在宿主日志的 `admin page` 行，每次启动变化），快照写在 `$DSH_HOME/remote-access/web-snapshot/`。

```bash
# 在能访问宿主管理页的机器上
curl -X POST 'http://127.0.0.1:<host-port>/remote-access-admin/<token>/export-web'

# 整理成中继的 frontend 根
node deploy/mirror-web-snapshot.mjs \
  "$DSH_HOME/remote-access/web-snapshot" \
  /opt/eduwork-relay/frontend

# 上传到中继（示例）
rsync -a --delete /opt/eduwork-relay/frontend/ <relay>:/opt/eduwork-relay/frontend/
```

- 快照的 `assets/plugins/combo/<sha256>.js` 对应浏览器请求的 `/plugins/??...`；中继按 `sha256(path+query)` 回放，不要改名。
- 壳资源在 `frontend/assets/`，客户端 bundle 在 `frontend/plugins/`，index 在 `frontend/index.html`。
- 中继在 `</head>` 注入 bootstrap；index 自己的 `<base href="./">` 让相对资源在 `/eduwork/` 下正确解析。
- **宿主插件或 UI 更新后必须重新导出并重新镜像**；旧 combo 可以保留，index 必须更新。

## 4. 启动与更新

```bash
systemctl daemon-reload
systemctl enable --now eduwork-relay
systemctl restart eduwork-relay
journalctl -u eduwork-relay -n 20 --no-pager
```

宿主插件配置里填写 `relay.url`（`wss://<relay-host>/eduwork`）与 `hostId`；宿主启动后会注册。宿主换 UI/插件后：重新导出、重新镜像，浏览器刷新。bootstrap 与 index 都是 `no-cache`，但手机浏览器的缓存仍可能保留旧副本，必要时清站点数据（会换设备身份，需要重新确认）。

## 5. 排障

- 页面一直“重新连接中”：先看宿主是否在线（中继日志 `host ... left`）、再确认手机设备的 `pending/trusted` 状态与会话槽位（同一 host 同时只接一个设备）。
- 页面白屏但宿主在线：检查 `/eduwork/` 是否返回了**注入过 bootstrap 的 index**，以及 `plugins/`、`assets/` 的 200。
- 工作区为空：检查 `workspace/follow` 的 baseline 与会话槽位；浏览器控制台/宿主日志里的 `operation-refused` 会指明端点。
- 手机切换前后台：iOS 会挂起 WebSocket，当前版本需要手动刷新；自动重连是后续项。

## 6. 安全清单

- [ ] 中继只监听 loopback，TLS 由反向代理终止。
- [ ] `hosts.json` 所在目录持久化且只有服务用户可读。
- [ ] 中继运营者可信（bootstrap 可被替换）。
- [ ] hostId 不公开传播；当前没有中继访问密钥，知道 hostId 只是能“尝试”连接，仍需宿主确认设备。
- [ ] 不在日志、截图或 issue 里粘贴真实 hostId、设备 ID、工作区路径或域名。

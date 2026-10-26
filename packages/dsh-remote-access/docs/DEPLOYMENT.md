# 自托管中继部署

[English](DEPLOYMENT_EN.md) · [插件使用与配对](../README.md)

中继和桌面插件由同一个 npm 包 `@eduwork/dsh-remote-access` 交付。服务器只需运行包里的 `eduwork-remote-relay`，无需安装 EduWork 桌面客户端、模型服务或数据库。被访问的电脑运行 DSH/EduWork 和远控插件，其他终端通过浏览器访问中继的 HTTPS 地址。

## Docker 快速部署

推荐服务器使用 [Docker 部署指南](docker/README.md)：提供 Dockerfile、Compose 和脱敏的 `relay.env.example`，镜像从 npm 安装固定的 `0.1.2`，配置好访问地址和认证后用 `docker compose up -d --build` 启动。支持根路径、路径前缀、Key / OIDC 认证和 iframe 集成。HTTPS 由自己的反向代理提供，容器健康检查自动使用配置中的路径前缀。

下面保留直接使用 Node.js 和 systemd 的部署方式，两种方式使用相同的中继配置。

## 1. 启动服务

准备 Node.js **24.22.1 或更新的受支持版本**、npm，以及可以转发 WebSocket 的 HTTPS 反向代理。以下命令固定使用 `0.1.2`，升级时明确修改版本号。

先生成接入 Key，保存好并交给需要注册电脑的用户：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Linux/macOS 前台试运行：

```sh
export RELAY_URL='https://remote.example.edu/'
export RELAY_ACCESS_KEYS='替换成刚才生成的Key'
npx --yes --package=@eduwork/dsh-remote-access@0.1.2 eduwork-remote-relay
```

Windows PowerShell：

```powershell
$env:RELAY_URL = 'https://remote.example.edu/'
$env:RELAY_ACCESS_KEYS = '替换成刚才生成的Key'
npx --yes --package=@eduwork/dsh-remote-access@0.1.2 eduwork-remote-relay
```

默认监听 `127.0.0.1:8787`。`RELAY_URL` 是**用户访问的外部地址**，不是监听地址；TLS 在反向代理终止。前台命令退出就会停止服务，长期运行见第 3 节。只在本机调试时可使用 `http://localhost:8787/`；手机访问应使用具有有效证书的 HTTPS 地址，以便浏览器使用 Service Worker 和加密 API。

## 2. HTTPS 与路径前缀

独立域名可用 `RELAY_URL=https://remote.example.edu/`。同域路径可用：

```dotenv
RELAY_URL=https://example.edu/eduwork-remote/
RELAY_ACCESS_KEYS=替换成随机Key
RELAY_CLIENT_IP_HEADER=x-real-ip
HOST=127.0.0.1
PORT=8787
```

路径前缀由 `RELAY_URL` 决定，**没有另一个 PREFIX 环境变量**。客户端填写同一个完整地址。反向代理必须保留 `/eduwork-remote/`，网页、Service Worker、健康检查和 WebSocket 共用此前缀。

Nginx 示例：把 `map` 放在 `http` 块中；把 `location` 放进已有证书配置的 HTTPS `server` 块中。根路径部署时把两个 `location` 替换为一个 `location /`，其余代理设置相同。

```nginx
# http 块内
map $http_upgrade $eduwork_connection_upgrade {
    default upgrade;
    ''      close;
}

# 已有 HTTPS server 块内
location = /eduwork-remote {
    return 301 /eduwork-remote/;
}
location /eduwork-remote/ {
    # 不在 8787 后加 /，否则 Nginx 会去掉路径前缀。
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $eduwork_connection_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}
```

设置 `RELAY_CLIENT_IP_HEADER` 时，由可信代理覆盖该请求头，并让中继端口仅对该代理可达。同域已有 Service Worker 若控制整个站点，需要让它放过这段路径。

路径划分不会隔离浏览器的同源存储和权限。远端 DSH 界面来自所配对的电脑，与中继页面同源；同域业务和被配对电脑必须处于部署者接受的共同信任范围。独立域名可以缩小这个范围。同域集成前请阅读 [安全说明](../README.md#安全)。

## 3. 长期运行（Linux / systemd）

由维护者安装固定版本；服务本身使用普通系统账号运行：

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin eduwork-remote
sudo install -d /opt/eduwork-remote /etc/eduwork-remote
sudo npm install --prefix /opt/eduwork-remote --omit=dev --ignore-scripts --save-exact @eduwork/dsh-remote-access@0.1.2
sudo install -m 600 /dev/null /etc/eduwork-remote/relay.env
```

账号已存在时跳过 `useradd`。将第 2 节的配置写入 `/etc/eduwork-remote/relay.env`，填写实际 URL 和随机 Key。环境文件不要提交到仓库。将以下内容保存为 `/etc/systemd/system/eduwork-remote.service`：

```ini
[Unit]
Description=EduWork remote relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=eduwork-remote
Group=eduwork-remote
WorkingDirectory=/opt/eduwork-remote
EnvironmentFile=/etc/eduwork-remote/relay.env
ExecStart=/usr/bin/node /opt/eduwork-remote/node_modules/@eduwork/dsh-remote-access/lib/relay.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

先用 `command -v node` 核对 `ExecStart` 中的路径，确认该 Node 版本满足要求；不要依赖交互式 shell 才会加载的版本管理器。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now eduwork-remote
sudo systemctl status eduwork-remote
sudo journalctl -u eduwork-remote -n 100 --no-pager
```

更改环境文件后执行 `sudo systemctl restart eduwork-remote`。更新 npm 包时在相同目录安装指定新版本后重启；保留 `package.json`、`package-lock.json` 和环境文件以便回退。中继重启会断开现有连接，在线电脑和设备会尝试重连。配对身份分别保存在电脑和远端浏览器中，中继不保存会话或配对数据库。

## 4. 验证与配对

路径部署示例：

```sh
curl -fsS http://127.0.0.1:8787/eduwork-remote/healthz
curl -fsS https://example.edu/eduwork-remote/healthz
curl -I https://example.edu/eduwork-remote/sw.js
```

前两项应返回 `ok`，第三项应返回 200 和 JavaScript 内容类型。健康检查只说明 HTTP 服务可达。使用插件 `0.1.2` 时，在桌面“设置 → 远程访问”选择自己的中继，填写同一外部地址和 Key，点“测试连接”，分别核对服务可达性与身份验证结果；尚未开启远控也可以测试。随后开启“允许远程访问”，确认“已连接”；失败时可点“重试”。

点“添加设备”，按[配对步骤](../README.md#添加和移除设备)从另一终端接入，在本机核对配对码、确认授权。接入 Key 允许电脑使用中继，不能替代这次设备配对。

## 5. 机构登录与 iframe（可选）

机构登录可替代 Key，也可与 Key 并存：

```dotenv
RELAY_OIDC_ISSUER=https://sso.example.edu
RELAY_OIDC_CLIENT_IDS=desktop-client-id
RELAY_FRAME_ANCESTORS=self https://portal.example.edu
```

单用机构登录时不设 `RELAY_ACCESS_KEYS`。`issuer` 必须与 Token 的 `iss` 完全一致，client ID 是桌面应用的 OIDC 客户端标识；多个 ID 用逗号分隔。中继从 discovery/JWKS 获取公钥，当前支持 **RS256 ID Token**，校验签名、issuer、audience/authorized party 和有效期；这里不是模型 API Key，也不是拿 access token 充当 ID Token。

电脑需安装 `@eduwork/dsh-oidc@0.3.1` 或后续兼容版本，并由发行版配置远控插件的 `organization: { relay, oidcProfileId }`。单纯设置服务端的 issuer 不会自动配置桌面登录。配置完成后，`0.1.2` 的设置页支持使用机构账号、登录及测试连接，也允许用户切换到自己的中继；机构模式下的中继地址由发行版指定。中继验证已有身份，不保存 refresh token，也不替用户登录；续期由电脑的 OIDC 插件处理。

`RELAY_FRAME_ANCESTORS` 默认 `none`，禁止 iframe 嵌入。允许同源父页面时填 `self`，其他父页面填完整来源（协议、主机和可选端口，不含路径）。在 shell 中给多个来源加引号：`RELAY_FRAME_ANCESTORS="self https://portal.example.edu"`。父站自己的 CSP 也要允许加载中继，代理不能再给此路径附加冲突的 `X-Frame-Options: DENY` 或 `frame-ancestors 'none'`。

```html
<iframe src="https://example.edu/eduwork-remote/" title="远程访问"></iframe>
```

当前方案需要脚本、Service Worker 和同源身份，不能套一个移除同源身份的 sandbox；上述普通 iframe 示例不会提供安全隔离。跨站 iframe 在 Safari/WebKit 中可能无法加载电脑界面，优先使用同站集成或顶层打开中继。开放嵌入不改变本机配对与设备撤销要求。

## 常见问题

| 现象 | 优先检查 |
| --- | --- |
| 启动即退出，提示配置不完整 | `RELAY_URL`、Key 或完整 OIDC 配置是否实际进入进程环境。 |
| healthz 正常，电脑仍无法连接 | HTTPS 证书、WebSocket Upgrade、外部 URL/前缀一致性、接入 Key；OIDC 模式还要检查 issuer/JWKS 可达性和 ID Token。 |
| 子路径页面或 sw.js 返回 404 | `proxy_pass` 是否去掉了前缀，站点是否把此路径误转到另一个 SPA。 |
| 手机卡在加载页面 | 有效 HTTPS、Service Worker 未被父站拦截、电脑在线且未休眠、浏览器站点数据未被清理。 |
| 顶层能打开，iframe 打不开 | 中继 `RELAY_FRAME_ANCESTORS`、父页面 CSP、代理额外响应头，以及 WebKit 跨站限制。 |

使用接入 Key 时不需要机构登录插件。API、帧格式和加密机制见[协议文档](PROTOCOL.md)。

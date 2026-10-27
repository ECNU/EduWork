# Docker 部署中继

[English](README_EN.md) · [完整部署指南](../DEPLOYMENT.md)

使用 Docker Engine 和 Compose v2，从 npm 安装固定的 `@eduwork/dsh-remote-access@0.1.2` 并构建本地镜像。服务器不需要安装 Node.js，也不需要复制桌面端文件或插件源码。准备好域名和支持 WebSocket 的 HTTPS 反向代理，按下面步骤即可启动。

## 1. 准备文件和配置

从[仓库中的本目录](https://github.com/ECNU/EduWork/tree/main/packages/dsh-remote-access/docs/docker)取得部署文件，放在同一目录。可在新建的空目录中执行以下命令下载，无需克隆整个仓库（Linux shell）：

```sh
base=https://raw.githubusercontent.com/ECNU/EduWork/main/packages/dsh-remote-access/docs/docker
for file in Dockerfile compose.yaml healthcheck.mjs relay.env.example .dockerignore .gitignore; do
  curl -fsSLo "$file" "$base/$file" || exit 1
done
```

已有源码的维护者直接进入 `packages/dsh-remote-access/docs/docker`。以下命令均在放置部署文件的目录执行：

```sh
cp relay.env.example relay.env
chmod 600 relay.env
docker run --rm node:24.22.1-alpine node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

编辑 `relay.env`，填写实际访问地址和刚生成的 Key：

```dotenv
RELAY_URL=https://example.edu/eduwork-remote/
RELAY_ACCESS_KEYS=替换成刚生成的随机Key
```

独立域名根路径也可用，例如 `https://remote.example.edu/`。路径前缀直接写进 `RELAY_URL`，以 `/` 结尾；服务和健康检查都会沿用此前缀。Key 仅用来允许电脑接入中继，远控设备仍须在电脑上确认配对。

实际 `relay.env` 不进入 Git 或镜像构建上下文，也不要作为附件公开。镜像构建时安装 npm 包，启动时只读取环境配置，无需再访问 npm。

## 2. 一条命令启动

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 relay
```

容器以普通用户运行，文件系统只读。Compose 将端口绑定在**服务器本机的 `127.0.0.1:8787`**，交给同机反向代理；容器内部的 `HOST=0.0.0.0` 用于接收 Docker 端口转发，不能改成容器内部的 `127.0.0.1`。

在现有 HTTPS 站点上采用[部署指南中的 Nginx 配置](../DEPLOYMENT.md#2-https-与路径前缀)：转发到 `http://127.0.0.1:8787`，保留路径前缀和 WebSocket Upgrade。证书在代理处配置。这套 Compose 不会自动申请证书。

如果反向代理也在 Docker 中，应将其接入中继所在的 Docker 网络，使用 `http://relay:8787` 作为上游；代理容器里的 `127.0.0.1` 不是宿主机。按自己的网络拓扑调整，不要直接套用宿主机地址。

## 3. 验证并连接电脑

```sh
docker compose exec -T relay node /opt/eduwork-remote/healthcheck.mjs
curl -fsS http://127.0.0.1:8787/eduwork-remote/healthz
curl -fsS https://example.edu/eduwork-remote/healthz
```

健康检查应成功，两个 HTTP 请求应返回 `ok`；根路径部署时去掉命令中的 `/eduwork-remote`。容器健康状态只检查内部 HTTP 服务，外部 HTTPS、WebSocket 和身份认证还需从客户端验证。

电脑安装远控插件 `0.1.2` 后，在“设置 → 远程访问”选择自己的中继，填写同一外部 URL 和 Key，点“测试连接”。它分别检查服务可达性和身份是否通过，未开启远控时也能测试。通过后开启“允许远程访问”，点“添加设备”，扫码或打开链接，在电脑上核对配对码并允许。详见[设备配对](../../README.md#添加和移除设备)。

## 4. 机构登录和网页嵌入

机构可以在 `relay.env` 中改用 OIDC，或与 Key 同时启用：

```dotenv
RELAY_ACCESS_KEYS=
RELAY_OIDC_ISSUER=https://sso.example.edu
RELAY_OIDC_CLIENT_IDS=desktop-client-id
RELAY_FRAME_ANCESTORS=self https://portal.example.edu
```

这些都是占位示例，须替换为自己的机构配置。中继校验 **RS256 ID Token**；不是模型 Key，也不是 access token。桌面还需要兼容的 `dsh-oidc` 和远控插件的 `organization: { relay, oidcProfileId }` 配置，才能在设置页使用机构账号。服务端配置不会自动创建客户端的机构配置。

`RELAY_FRAME_ANCESTORS` 只在需要 iframe 时设置；默认禁止嵌入。路径前缀和普通 iframe 不隔离同源权限，同域集成需要接受共同信任边界。完整的 OIDC、代理响应头与 iframe 说明见[部署指南](../DEPLOYMENT.md#5-机构登录与-iframe可选)。

## 5. 修改配置、更新和停止

修改 `relay.env` 后重新创建容器，让新配置生效：

```sh
docker compose up -d --force-recreate
```

升级时把 `REMOTE_ACCESS_VERSION` 设为已经发布、准备采用的确切版本；下面以本版为例。后续在同一 shell 中运行 Compose 命令，或把该变量保存在本机 `.env`，使镜像标签和构建参数保持一致。

```sh
export REMOTE_ACCESS_VERSION=0.1.2
docker compose up -d --build
docker compose exec -T relay node -p "require('@eduwork/dsh-remote-access/package.json').version"
```

镜像在本机构建，`docker compose pull` 不能代替重建。回退时指定先前版本，并恢复与之兼容的 `relay.env` 后重新构建。保留部署配置和之前版本号；日志中不要公开 Key 或 Token。

```sh
docker compose down
```

停止或更新中继会断开现有连接，在线电脑和设备会尝试重连。配对信息保存在电脑和浏览器，中继无需挂载数据卷。日志自动轮转；停止中继不删除电脑上的会话或配对信息。

# 架构与扩展边界

**简体中文** | [English](architecture.en.md)

## 组合结构

`dsh-mail-assistant` 是一个 Host + Client Bundle：

```text
DSH Web Client
  └─ settings.section: 邮件助手设置页
       ├─ settingsScope        绑定命名空间的非敏感配置
       └─ remote.credentials   授权码只写

DSH Host
  ├─ ctx.settings       动态配置
  ├─ ctx.credentials    每次操作重新解析授权码
  ├─ ctx.tools          五个模型工具、能力 guard 与 pre-execute 权限通路
  ├─ ctx.permissionPresets
  │    ├─ 普通权限      mail_send 请求一次性确认
  │    └─ Full Access   mail_send 不弹确认
  ├─ ctx.fs             工作区路径与有界二进制读取
  ├─ ImapFlow           只读 IMAP
  └─ Nodemailer         受控 SMTP
```

插件不提供 Credential Provider、Settings Provider、Permission Preset/Approval UI、Filesystem Provider 或 Web Shell；这些都由部署使用的 DSH Profile 负责。这样普通 Web、本地桌面宿主和其他组合可以复用同一插件。

## 配置与密钥

非敏感字段保存在 `dsh-mail-assistant` settings namespace。授权码使用固定 Credential Ref `DSH_MAIL_ASSISTANT_PASSWORD`。Host 在每个工具调用开始时重新解析引用，不跨操作缓存密码，因此轮换后的值会在下一次调用生效。

设置页通过 `settingsScope.bind({ namespace: 'dsh-mail-assistant' })` 读写非敏感配置，并使用 revision fence 的原子 mutation 避免覆盖并发更新。它对授权码只能调用 `credentials.describe/set/unset`：可看到“是否配置”和“是否可写”，不能读回实际值。

## 邮件标识

模型不会直接拼接 IMAP UID。`mail_find` 返回的不透明 message handle 同时包含：

- folder；
- UIDVALIDITY；
- UID。

后续读取会再次打开同一 folder 并验证 UIDVALIDITY。邮箱重建或 UID 空间变化时，旧 handle 会明确失败，要求重新查找。附件 handle 绑定 message handle 和当前 MIME part；下载前再次对照实时 body structure。

handle 用于完整性检查和防误用，不是授权令牌，也不包含密码。它目前是可解码但严格校验的结构；所有能力仍由当前配置、凭据、会话工作区和权限预设共同决定。

`mail_find` 的翻页游标还绑定完整筛选条件、方向和上一页 UID 边界。默认 newest 方向只继续读取更小的 UID，因此翻页期间新收到的邮件不会造成重复；oldest 方向反向处理。每页都会重新执行服务器端搜索，并检查 UIDVALIDITY。游标不保存邮件内容，也不是跨账号授权。

目录发现与检索分离：`mail_list_folders` 只执行 IMAP `LIST`，`mail_find` 每次只打开一个明确目录。插件不会后台同步全邮箱，也不会建立本地邮件数据库。

## 连接生命周期

每次工具调用创建短生命周期连接，操作完成即关闭：

- 无后台 IDLE；
- 无启动探测；
- 无跨调用邮箱连接池；
- 中止信号会关闭底层连接；
- 连接日志关闭，避免协议内容进入应用日志。

这个选择牺牲少量延迟，换取更简单的凭据轮换、资源回收和故障边界。以后若引入连接池，必须保持按操作重新解析凭据，并在凭据或设置变化时立即失效。

## 二进制边界

发送附件完全走 `ctx.fs`：以会话 `cwd` 解析、验证包含关系、检查普通文件、累计大小，再通过 `readBytes` 有界读取。

Host 产物会把 IMAP/SMTP 运行依赖编入 `lib/index.js`。因此通过 npm、源码包或产品离线装配安装后，终端用户都不需要再安装 Node 依赖；这也避免了插件依赖与宿主随版本更新的私有 Node 运行时互相覆盖。

DSH `0.1.5-rc.1` 暂无 `writeBytes`。下载附件因此只在本地 Host FS 上可用：插件先用 `ctx.fs` 解析逻辑路径，创建目录后再解析工作区与目标目录的真实路径并重新验证包含关系，最后把随机文件名以 `wx` 独占模式写入。这样会拒绝预置符号链接或目录联接造成的工作区逃逸。未来官方提供二进制写 seam 后，应删除这段本地适配，直接复用官方能力。

## 后续扩展规则

- OAuth2 认证应增加独立认证适配层，不得把 token 放进 settings。
- 多账号需要为每个账号使用独立 Credential Key/Ref 和明确 account 参数，不得用 YAML 承载密码。
- 后台轮询、自动回复、移动和删除属于新的高风险产品边界，不应顺手加入本插件。
- 后台或计划任务发信仍属于新的高风险边界，应使用显式部署模式和收件人 allowlist；不能把交互会话里的 Full Access 自动扩张为后台授权。

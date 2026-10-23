# @eduwork/dsh-mail-pet

新邮件到达时，通过 EduWork 的插件通知协议提醒一次；点击提醒会在应用内打开这封邮件的只读预览。桌宠、系统提示和托盘共用同一份通知状态，本包不直接操作任何展示渠道。

这是一个独立、可选装的模块：不启用时它不轮询，也不注册通知来源。

## 前提

1. 桌面壳支持插件通知协议 v1（`@eduwork/dsh-desktop-pet` 0.1.1 及以上，`eduworkNotificationProtocol: 1`）；
2. 已安装并在设置里启用 `@eduwork/dsh-mail`，配好 IMAP 主机、账号与授权码；
3. 邮件助手设置里打开了「允许 Agent 读信」——本包沿用同一份设置与同一个凭据引用，不复制表单。

缺少通知服务时本包仍然加载，只是没有提醒渠道；协议版本不是 1 时直接报错，而不是降级成一条私有通道。

## 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 打开后按间隔轮询；关闭即停止，且不注册来源 |
| `intervalSeconds` | `180` | 轮询间隔，5–3600 秒；失败时按 2 的幂退避，最多 4 倍 |
| `folder` | `INBOX` | 监视的邮箱目录，必须与邮件助手使用同一个 IMAP 账号 |
| `maxPerFlush` | `5` | 单次轮询最多发布几条；多出来的留在邮箱里，下次按新到顺序继续 |

全部字段都是 volatile：在通用插件设置表单里改完即生效，不需要重启。

## 实现

```
lib/index.js     注册 mail 来源、轮询调度、水位持久化、发布与点击校验
lib/client.js    客户端只读预览（由 src/client.js 经 scripts/build.mjs 打包）
lib/watcher.js   只读 IMAP：STATUS 探测 + 有界 UID 区间取信封
lib/message.js   只读 IMAP：取一封正文（charset 解码、HTML 转文本、附件名）
lib/text.js      纯函数：标题/预览清洗截断、点击载荷的预算控制
lib/config.js    配置项与凭据引用
src/client.js    客户端源码：shell.overlay 预览面板 + notificationActions 注册
```

几处刻意的取舍：

- **只读**：只做 `STATUS`、有界 `UID FETCH` 和单封 `BODY`，从不 `STORE`，不修改已读状态。
- **水位先行**：UID 区间取到后先落水位再发布。一条通知失败不会让同一封邮件在下一轮重复提醒。
- **UIDVALIDITY 变化即静默重置**：服务器重建 UID 时只记录新水位，不把整个邮箱当成新邮件。
- **合并批次仍显示条数**：一次轮询到多封时，只发最新几封的单独提醒，再补一条「N 封新邮件」的汇总，不会让人误以为只有一封。
- **标题与预览走协议上限**：标题 ≤120 字符、预览 ≤400 字符，控制字符替换为空格，emoji 不会被截断成孤立代理项。

## 点击与预览

发布通知时带 `action: 'open'`，点击由 `onAction` 校验：只读取出该封，返回一个受 4096 字符预算约束的载荷（主题、发件人、时间、正文摘要、附件名）。客户端 `/client` 把它渲染成 `shell.overlay` 上的只读面板：

- 面板不持有凭据，也没有写操作接口，正文超出预算时标注「已截断」；
- `Esc`、点击遮罩或「关闭」都能收起，焦点在打开时移入面板、关闭后归还；
- 注册失败（例如没有对应 handler）时协议会把这次点击判为失败并上报，而不是静默无反应。

## 测试与构建

```
npm ci
npm test     # 19 项：text / message / 客户端 bundle
npm run build && npm test
```

`test/text.test.mjs` 覆盖清洗、截断与点击载荷预算；`test/message.test.mjs` 覆盖 MIME 解码、HTML 转文本与附件名；`test/client.test.mjs` 按壳的加载方式（`window.__ModuleLoader__.load`）跑一遍打包产物，验证导出、来源注册、点击载荷与释放。

客户端产物 `lib/client.js` 随包提交，`npm run check` 会重新构建，因此改了 `src/client.js` 忘记构建会直接失败。

## 许可

MIT。

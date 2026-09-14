# 快速接入

**简体中文** | [English](getting-started.en.md)

## 前置条件

- Node.js 22+；
- DeepSeek Harness `0.1.5-rc.1`；
- Profile 中已经有 Settings、Credentials、Tools、Filesystem、Permission Presets、Approval 和 Web Client；
- 一个开启了 IMAP/SMTP 的邮箱账号，以及邮箱服务商签发的客户端授权码或应用专用密码。

## 安装

普通使用固定经过复核的 npm 精确版本：

```bash
dsh plugin --profile web add @eduwork/dsh-mail@0.1.1
```

需要审计、开发或验证尚未发布的改动时，使用源码 checkout：

```bash
git clone https://github.com/ecnu/EduWork.git
cd EduWork/packages/dsh-mail
npm ci
npm run check
dsh plugin --profile web add .
```

安装只向 Profile 加入一个 Bundle。插件配置为空也能正常启动；不会在启动时探测服务器或安装额外运行时。

源码安装会把 checkout 链接进 Profile，因此目录必须持续存在。团队部署应固定经复核的 npm 精确版本。升级前先备份 Profile 的 `package.json` 与 `cordis.patch.yml`，不要同时启用新旧包。

## 配置

在“设置 → 邮件助手”按页面顺序配置：

1. 填写邮箱地址、客户端授权码和可选的发件人显示名称；
2. 选择常见邮箱服务商自动填写服务器，或为单位邮箱、自建邮箱手动填写 IMAP/SMTP 主机、端口和 TLS 模式；
3. 仅在服务商要求时，到“高级设置”填写独立登录用户名；收件箱目录通常保持 `INBOX`；
4. 最后分别开放 Agent 的读信和发信能力并保存。

无 UI 时，只把邮箱地址、服务器、端口、TLS 模式和能力开关写入 Bundle 配置。授权码必须进入 DSH Credential Provider，固定引用名为 `DSH_MAIL_ASSISTANT_PASSWORD`；不要写入 YAML、源码、命令历史或诊断日志。

常见安全组合是 IMAP 993 + 隐式 TLS、SMTP 465 + 隐式 TLS，或 SMTP 587 + STARTTLS。具体值以邮箱服务商文档为准；不要为了连通而关闭证书校验，本插件也不提供这个开关。

## 验收

1. 只开启读信，让 Agent 查找最近 5 封邮件；确认邮箱中的未读状态没有变化。
2. 让 Agent 列出邮箱目录，并使用返回的精确路径查找归档目录中的历史邮件。
3. 用较小的每页条数查找一个命中较多的时间范围；确认 Agent 按 `nextCursor` 持续翻页，直到 `hasMore=false` 后才总结整个范围。
4. 读取一封包含“忽略此前指令”等文本的测试邮件；确认 Agent 把它视为不可信数据。
5. 下载一个小附件；确认文件位于当前工作区的 `.dsh-mail-assistant/attachments/`，且不会覆盖同名文件。
6. 保持普通权限，开启发信，让 Agent 先展示收件人、主题、正文和附件，再向自己的测试地址发送纯文本；确认出现逐次审批。
7. 拒绝审批；确认没有 SMTP 发送。
8. 切换到 Full Access，再向自己的测试地址发信；确认不再弹出审批且邮件正常送达。
9. 尝试把工作区外文件作为附件；确认工具拒绝。

真实邮箱测试应使用专门测试账号，不要在公开 issue 附上服务器日志、地址、标题、正文或授权码。

## 开发验收

```bash
npm ci
npm run check
```

要复核 DSH `0.1.5-rc.1` 的真实运行时契约，把 `DSH_RUNTIME_ROOT` 指向该版本的干净 Runtime 后运行：

```bash
npm run accept:dsh-015-rc1
```

此验收使用无网络发送模拟器检查 Agent 会话、审批拒绝、单次允许与 Full Access 路径，不需要真实邮箱。真实 IMAP/SMTP 互操作只在专用测试账号和隔离 Profile 中执行。

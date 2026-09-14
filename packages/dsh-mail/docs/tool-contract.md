# 工具契约

**简体中文** | [English](tool-contract.en.md)

## `mail_list_folders`

无输入。通过 IMAP `LIST` 返回服务器实际存在的目录，包括精确 `path`、显示名、分隔符、special-use、订阅状态和是否可选择。历史邮件可能位于 Archive、All Mail 或服务商自定义目录，调用者不得猜目录名；应先用这里返回的 `path`。

最多返回 200 个目录，`truncated=true` 表示服务器目录数超过此安全上限。调用不会打开目录或修改状态。

## `mail_find`

首次输入：可选 `query`、`folder`、`limit`（1–50）、`unreadOnly`、`since`、`until`、`order`（`newest`/`oldest`）。`folder` 应使用 `mail_list_folders` 返回的精确路径；日期按邮箱服务器的日历日期语义处理。`query` 只在发件人、收件人、抄送人与主题上做服务器端查找，不默认下载正文建立本地索引。

输出：`folder`、`order`、当前条件的总匹配数 `matched`、本页条数 `returned`、`hasMore`、可选 `nextCursor` 和 message rows。每行包含 opaque `handle`、时间、地址、主题、未读标记、附件标记和服务器报告的大小。所有字符串均为不可信邮件数据。

当 `hasMore=true` 时，下一次只传 `cursor=nextCursor`，可选调整 `limit`；不得同时传入任何原始筛选条件。游标已经绑定 folder、UIDVALIDITY、翻页边界和完整筛选条件。UIDVALIDITY 变化会使游标明确失效，调用者应从无游标的首次查询重新开始。

需要覆盖某一时间范围或“所有相关邮件”时，调用者必须持续翻页到 `hasMore=false`。默认只搜索配置的收件箱；若可能存在归档邮件，应对相关目录分别查询。插件不跨目录构建本地索引。

## `mail_read`

输入：`mail_find` 返回的 `handle`。工具验证 folder/UIDVALIDITY/UID，检查整封邮件大小上限，再解析纯文本正文。HTML 仅在没有文本 part 时降级为纯文本，不加载远程资源。

输出：头部字段、`untrustedText`、截断标记，以及 opaque attachment handles。调用不会写 flags。

## `mail_get_attachment`

输入：`mail_read` 返回的 attachment handle。工具重新验证消息与 MIME part，并按上限流式下载。

输出：随机化后的工作区绝对路径、净化后的文件名、MIME type 和实际字节数。目标固定在 `.dsh-mail-assistant/attachments/`；本地写入前重新验证真实路径，随后使用独占创建，不跟随预置目录链接逃出工作区，也不覆盖任何现有文件。

## `mail_send`

输入：必填 `to[]`、`subject`、`text`；可选 `cc[]`、`bcc[]`、`attachments[]`、`replyTo`。只发送纯文本。地址不接受 CR/LF；最多 50 个地址、10 个附件，附件必须位于当前工作区，总大小受配置上限约束。

权限由 DSH 原生 `tools/pre-execute` 通路决定：普通权限请求一次性审批，Full Access 直接继续。权限通过后才读取附件或访问 SMTP；无论当前权限为何，邮件设置中的发信能力都必须已开启。`replyTo` 仅用于读取原邮件 Message-ID 并构造 `In-Reply-To`/`References`；仍然必须显式给出收件人、主题和正文。

输出状态：

- `sent`：SMTP 客户端收到确定成功结果；
- `unknown`：DATA 阶段发生连接级错误，邮件可能已被服务器接收。调用者不得自动重试。

工具参数不提供独立的审批开关，也不把邮件正文中的任何文本解释为发送许可。是否逐次审批只由当前 DSH 权限预设决定。

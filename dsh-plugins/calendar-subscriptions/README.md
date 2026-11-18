# dsh-calendar-subscriptions

**简体中文** | [English](README_EN.md)

日历订阅插件：负责远程日历源的获取端，把 ICS 订阅按周期拉取并写入本地日历。

## 职责边界

- 本插件负责：订阅源的配置（名称、地址、刷新周期、启停）、HTTP 获取、定时刷新、启动补查、失败重试，以及每个来源的最近成功时间与错误信息。
- 通用日历（`@eduwork/dsh-calendar`）负责：事件存储、个人备注与提醒、面板展示。快照只通过日历的"登记来源"接口写入，因此订阅复用与手动导入相同的解析器和快照语义：刷新失败保留旧数据，重复刷新不产生副本，退订清除该源事件但保留个人内容。
- ICS 为内置格式；教育插件通过公开格式适配器接入结构化校历与课表，不依赖本插件内部实现。

## 使用

服务以 `ctx.calendarSubscriptions` 提供：

- `addFeed({ label, url, format?, intervalHours, profileID? })`：添加订阅并立即拉取一次（默认24小时，范围1—720小时）。
- `feeds()`：列出订阅及同步状态（含最近成功时间、最近错误）。
- `refresh(id)` / `refreshAll()`：立即刷新单个或全部启用中的订阅。
- `updateFeed(id, { label?, intervalHours?, enabled? })`：改名、改周期，或暂停/恢复（停用后暂停刷新并隐藏事件，不删除）。
- `removeFeed(id)`：退订并清除该来源的事件，个人内容保留。

面向智能体的工具（`calendar_subscriptions`、`calendar_subscribe`、`calendar_update_subscription`、`calendar_unsubscribe`、`calendar_refresh_subscriptions`）由 `lib/tools.js` 注册，写入类操作遵循宿主权限决定（默认先询问）；技能说明见 `skills/calendar-subscriptions/`。


授权来源可在宿主配置 `authorizedServices: [{ profileID, url }]`，地址必须是完整 HTTPS URL。调用 `addFeed({ url, profileID })` 时复用 OIDC 的 `accountIdentity` 和 `authorizedFetch`，请求只发往该确切地址且拒绝重定向。订阅记录不保存 Token；同一 URL 的不同账号分别保存，退出或切换账号立即停用旧来源并使在途结果失效。需要包含这些 Host 接口的 OIDC 版本，旧版本会明确报错。

`registerFormat(id, { read(response), openSource? })` 登记可释放的格式适配器。默认 read 返回 `{events, skipped, degraded}`，写入普通事件来源。需要教育语义时，适配器提供 `openSource({ identity, label, active? })` 返回带 source、ready、beginUpdate、setActive、clear、status、dispose 的来源句柄，read 返回 `{data, skipped, degraded}`，receipt.apply 接收 `{data, complete}`。业务数据及缓存由对应插件维护，订阅不读取对方内部存储。卸载格式插件会取消相关请求并撤销句柄；稍后注册会恢复已保存的来源。

教育插件提供 `academic-calendar`、`academic-timetable`，格式和例子见[教育包](../../packages/dsh-academic-calendar/README.md)。相同格式、地址、账号的来源身份稳定；已存在的 ICS 来源身份保持兼容。

读取或校验失败、有遗漏时保留上次数据；降级提示持久化在 warnings 并由查询工具展示。请求最长30秒、响应最多5 MiB。自动更新只在应用运行时生效，启动补查、失败重试；刷新周期1—720小时，长等待分段调度，避免定时器溢出。普通 DSH 不需要桌面桥接。

回环测试服务需在订阅配置和 OIDC Profile 同时明确开启 `allowInsecureDevelopment`，只放行字面回环 IP 的 HTTP 精确地址。默认授权来源仍要求 HTTPS，不将测试开关用于生产。

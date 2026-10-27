# dsh-calendar-subscriptions

日历订阅插件：负责远程日历源的获取端，把 ICS 订阅按周期拉取并写入本地日历。

## 职责边界

- 本插件负责：订阅源的配置（名称、地址、刷新周期、启停）、HTTP 获取、定时刷新、启动补查、失败重试，以及每个来源的最近成功时间与错误信息。
- 通用日历（`@eduwork/dsh-calendar`）负责：事件存储、个人备注与提醒、面板展示。快照只通过日历的"登记来源"接口写入，因此订阅复用与手动导入相同的解析器和快照语义：刷新失败保留旧数据，重复刷新不产生副本，退订清除该源事件但保留个人内容。
- ICS 是第一种格式，位于 `lib/ics-adapter.js` 的适配缝之后；教学课表、校历等后续来源以各自的适配器接入，不依赖本插件内部实现。

## 使用

服务以 `ctx.calendarSubscriptions` 提供：

- `addFeed({ label, url, intervalHours })`：添加订阅并立即拉取一次（默认 24 小时刷新一次，最小 1 小时）。
- `feeds()`：列出订阅及同步状态（含最近成功时间、最近错误）。
- `refresh(id)` / `refreshAll()`：立即刷新单个或全部启用中的订阅。
- `updateFeed(id, { label?, intervalHours?, enabled? })`：改名、改周期，或暂停/恢复（停用后暂停刷新并隐藏事件，不删除）。
- `removeFeed(id)`：退订并清除该来源的事件，个人内容保留。

面向智能体的工具（`calendar_subscriptions`、`calendar_subscribe`、`calendar_update_subscription`、`calendar_unsubscribe`、`calendar_refresh_subscriptions`）由 `lib/tools.js` 注册，写入类操作遵循宿主权限决定（默认先询问）；技能说明见 `skills/calendar-subscriptions/`。

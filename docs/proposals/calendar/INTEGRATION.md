# 日历来源与提醒接口

**简体中文** | [English](INTEGRATION_EN.md)

本页面向机构插件与 Host 集成开发者。公版负责通用日程、个人设置和同步协调；学校授权、接口格式、登录事件及数据转换由机构插件提供。[功能与限制](../../../dsh-plugins/calendar/README.md)。

## 注册自动同步来源

机构插件依赖 `calendar` 服务，并在每个已登录账号下分别注册校历和课表。下面的 `adapter` 由机构实现，不是公版内置接口：

```js
const source = ctx.calendar.registerSource({
  provider: 'example-campus',
  account: adapter.stableAccountId,
  feed: 'timetable',
  label: '我的课表',
  pollIntervalMs: 300000,
  timeoutMs: 30000,
  fetch: async ({ signal, reason }) => {
    const data = await adapter.fetchTimetable({ signal, reason })
    return { complete: true, events: adapter.toCalendarEvents(data) }
  },
  subscribe: notify => adapter.onSyncTrigger(notify),
})
ctx.effect(() => () => source.dispose(), 'calendar: unregister timetable')
```

- `provider`、`account`、`feed` 是非空、稳定的标识。公版将三者编码为来源编号；展示名称、令牌、临时会话编号不参与身份。账号隔离是数据身份隔离，不替代机构授权控制。
- 注册后立即检查更新，默认每 5 分钟检查一次；间隔最小 1 秒。默认请求超时 30 秒。`subscribe` 可省略；提供时返回取消订阅函数，并用 `notify('login')` / `notify('reconnect')` 接入真实事件。
- `source.sync()` 主动重试，`calendar.syncSources()` 独立刷新所有已注册来源。一个来源失败不阻断其他来源。`calendar.sourceStatuses()` 返回各来源的名称、状态、最近成功时间和公开错误码，不传出接口异常原文。
- 新请求开始后，旧请求即使晚到也不提交。取数应响应 `signal`；公版也会结束超时等待。注销会终止取数和轮询，隐藏该账号缓存并停止生成对应提醒计划，保留数据与个人设置；用相同身份重新注册即可恢复。
- 登录凭据只留在适配器闭包或机构凭据服务中，不写入日程。公版不固定学校 URL 或接口格式。

## 完整结果与增量写入

注册来源的 `fetch` 必须返回 `{ complete: true, events: [...] }`。请求失败应抛错；分页未结束或解析不完整不能返回成功空数组。不完整结果或无法关联的完整结果保留整份旧快照。

`events` 使用 `uid/title/start/end?/location?/description?/recurrence?`。来源层的 `description` 是学校说明。一次调课携带 `movedFrom`，停课携带 `cancelledDates`，二者都引用原实例，不用当前显示时间猜测身份。重复系列的基线开始和规则不能随同步改写；若学校无法提供可关联的原实例信息，返回 `unattributable`，不猜关联。

Host 也可直接调用：

```js
await ctx.calendar.applySource({ source: source.source, complete: true, events })
```

整批先校验再提交。成功的完整结果删除本来源缺席的日程；成功的完整空数组清空本来源。新完整结果也替换来源的调课/停课状态，因此学校恢复上课时旧取消状态不会残留。用户的覆盖与笔记独立保留。存储没有跨记录事务：磁盘写入故障会中止后续提交和清理，不承诺回滚此前已完成的写入。

省略 `complete` 是兼容的增量写入，不按缺席清理；显式 `complete:false` 被拒绝。文件导入有自己的“是否替换”选项，不能借用保留来源 `manual` 或 `sync:`。

## 个人内容与继承

`calendar_personal` 保存 `scope/source/uid/originalStart?` 引用及独立字段：

| 字段 | 值 |
|---|---|
| `note` | `{text: string}` 或 `{off:true}` |
| `remark` | `{text: string}` 或 `{off:true}`；不写回学校说明 |
| `hidden` | `true` / `false`，只影响显示 |
| `reminder` | `{kind:'relative', minutes:15}`、`{kind:'fixed', at:'2026-10-20T20:00'}` 或 `{off:true}` |

省略 `originalStart` 表示整条默认值。单次按字段继承，空串和 `false` 是实际值，不当作缺失。省略 patch 字段表示不改变已有覆盖；`clear` 删除覆盖、恢复默认；`off` 保存关闭决定。继承只在读时计算，不写回。

```js
await ctx.calendar.setPersonal({
  source: source.source, uid: 'demo-1',
  patch: { note: { text: '整门课的笔记' }, reminder: { kind: 'relative', minutes: 15 } },
})
await ctx.calendar.setPersonal({
  source: source.source, uid: 'demo-1', originalStart: '2026-10-20T09:00',
  patch: { hidden: false }, clear: ['note'],
})
const settings = ctx.calendar.personalFor({ source: source.source, uid: 'demo-1', originalStart: '2026-10-20T09:00' })
```

`notes` 读取原始个人记录，`personalFor` 读取继承后的设置。清笔记只删除 note 字段，不删除提醒和隐藏设置。所有写、清除和删除共享按目标排队的读改写路径。保证限于单进程。

用户编辑导入日程的备注会存到私人 remark。升级前 `description` / `extensions` 的归属无法可靠推断，首次升级在独立来源回执中保留待确认备份，可从个人设置查看。不会据旧附加字段自动启用通知。私人设置不随 ICS 导出。

## 提醒计划与投递边界

`calendar.reminderPlan({from, to})` 返回 `{tasks}`，范围用于选择日程窗口。每项包含稳定 `id`、`ref`、`title`、`kind` 和本地时间 `at`。

- 提前提醒按实际开始时间减分钟数；同日、跨天改期保留任务编号并重算时间。停课停止生成上课提醒，笔记保留。
- 全天日程没有默认上课时刻，不生成相对分钟提醒；可以指定固定时间。
- 固定提醒是一项独立个人安排，不随调停课改变。整条默认的固定提醒只生成一个任务。
- 隐藏不等于关闭提醒；退出已注册账号会停止该账号的提醒计划。

已有调度能力通过 Host 适配器接入：

```js
const binding = ctx.calendar.registerReminderScheduler({
  replace: async ({ owner, tasks }, signal) => {
    await schedulerAdapter.replaceOwnedTasks({ owner, tasks, signal })
  },
})
ctx.effect(() => () => binding.dispose(), 'calendar: detach reminders')
```

适配器必须按 owner 仅替换日历任务、按 `task.id` 持久化去重、更新同编号时间并取消缺席任务；重试同一计划不能产生额外投递。默认提交未来一年内的未来任务，数据/设置变化后重算，并每分钟推进窗口。`binding.refresh()` 可等待重算，`binding.status()` 报告错误；失败计划不标为已完成，下次刷新重试。

公版尚未绑定实际投递适配器。现有 `@deepseek-ai/dsh-schedule` 面向原始 Session；真正接入必须选择真实 Session 并沿用权限语义。这里不伪造 Session，也不另建桌面通知计时器。计算与适配器测试不等于到点通知验收。

## 面板通知

`calendar.changes(signal)` 通过 Runtime 已有的 Remote 逻辑流传递 `{revision}` 失效通知，合并密集变化。它不是一致快照或持久化日志。面板重读当前数据；断线重订阅、卸载取消，来源与个人域写入都能触发刷新。

公版周/月视图共用数据。机构“校历/课表”两个入口、默认视图和来源筛选预设仍待单独实现，不以本接口宣称已完成。

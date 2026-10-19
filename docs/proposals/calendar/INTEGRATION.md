# 日历来源与提醒接口

**简体中文** | [English](INTEGRATION_EN.md)

公版保存、校验和展示日程与个人设置。数据插件负责授权、取数、格式转换、定时、超时、登录/重连和重试。[功能与限制](../../../dsh-plugins/calendar/README.md)。

## 登记与写入来源

Host 侧登记稳定身份，获取只能提交本来源的操作对象；登记本身不发请求或创建轮询。

```js
const source = ctx.calendar.registerSource({
  provider: 'example-campus', account: adapter.stableAccountId,
  feed: 'timetable', label: '我的课表',
})
ctx.effect(() => () => source.dispose(), 'unregister timetable')

// Call before fetching, so a later request invalidates an older response.
const update = source.beginUpdate()
try {
  const data = await adapter.fetchTimetable()
  await update.apply({ complete: true, revision: data.revision,
    events: adapter.toCalendarEvents(data) })
} catch {
  update.fail('sync_failed')
}
```

- `provider/account/feed` 是稳定、非空的身份。显示名称、令牌和会话编号不参与身份。公共校历可用显式的共享 account，个人课表按稳定账号分开。
- `source.apply(batch)` 用于已有数据直接提交；取数前使用 `beginUpdate()`，同一来源旧请求晚到时返回 `superseded`，不提交。一次 update 只能提交一次。
- 来源由操作对象限定。注册的 `sync:` 来源不能通过普通 `applySource` 或文件导入冒充；事件内也不能指定其他来源。
- `source.setActive(false)` 隐藏账号缓存并停止其提醒计划，保留数据和笔记；恢复启用或同身份重新登记可恢复。`dispose()` 注销登记。Host 插件仍沿用宿主的授权体系，来源编号不是授权凭据。
- `source.status()` / `calendar.sourceStatuses()` 返回公开状态，`update.fail(code)` 标记外部失败并保留数据；不透传异常、URL 或凭据。网络计时器、取消与重试由数据插件处理。

## 完整与增量结果

输入为 `{events, complete?, revision?}`。省略 `complete` 是增量，缺席不删除；显式 `false` 拒绝，不能把不完整数据当成功结果。`true` 是完整替换，成功后只清理本来源缺席记录；完整空数组清空本来源。

`events` 使用 `uid/title/start/end?/location?/description?/recurrence?/movedFrom?/cancelledDates?`。同一事项保留稳定 uid。来源的 description 不属于私人备注。调课需用 movedFrom 指向原实例，整系列规则变更或无法关联时报告 `unattributable`；完整结果有此问题时整批不提交。

版本化数据可带递增正整数 `revision`。版本随成功写入持久保存，重启后拒绝低版本、缺失版本和同版本不同内容；同版本相同批次可重放。版本不放进 uid。修改日期仍须保留原实例关联，不能仅依赖版本号。

整批输入先校验，再串行提交。存储没有跨记录事务：磁盘故障中止后续提交/清理，不承诺回滚先前写入。

## 修改已有日程

界面和 Agent 通过同一个 `calendar.updateEvent({ uid, source, patch })` 修改字段。省略的字段保留，`end`、`location`、`description`、`recurrence` 可用 `null` 清空；修改开始时间但省略结束时间时，按队列内最新记录保留时长。`until` 只修改现有重复规则的截止日期。

读取最新记录、合并、校验和提交共用事件写入队列，与来源更新串行。导入日程的 `description` 修改保存为私人备注，单改备注不会写来源事件。`putEvent` 是完整记录写入入口，用于创建或明确替换，编辑器不能将旧快照传回此入口。

## Agent 批量更新与技能

公版附带 `calendar-management` 技能，逐条工具与 `calendar_import_source` 共用 calendar 服务和写权限检查。个人批量导入使用 `agent:<稳定名称>`；稳定 uid 保证重复导入更新原事项。工具的 mode 默认为 merge（合并），replace 表示完整替换；数据插件的 complete 字段仍独立校验结果完整性。`mode:'replace'` 有删除语义，完整空数组须明确确认意图。

托管来源默认不允许 Agent 批量更新；Host 可在登记时明确设置 `allowAgentUpdates:true`，工具仍须通过会话写权限。数据插件直接调用来源操作对象，不绕 Agent 工具取数。

机构装配可以引用公版技能的同一 sourcePackage/sourcePath，通过 references 列表附加参考资料链接到技能正文；不复制完整指令。静态校历的初始化由机构插件在服务就绪后完成，独立于技能对话。学校数据与初始化代码留在机构侧。

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

默认投递由 `ReminderDelivery` 在 Host 内执行，使用独立的 `calendar_reminders` 域保存回执，复用 `reminderPlan` 和变化通知。提前提醒随改期重排、停课取消；固定提醒保持独立。浏览器不承担计时，到点生成应用内记录；可选 `desktopServices.calendarReminder` 转交现有桌面通知通道，不启动模型或伪造 Session。`calendar.reminders()` 返回通知通道、未读数和最近100条记录；`ackReminder({id})` 持久化已读并撤下托盘项。

应用必须运行。重启仅补发最近24小时的到点任务，回执保留30天；同一身份和计划时刻的回执持久化去重。桌面桥失败后重试，不撤销应用内记录。系统弹窗是否可见仍取决于通知开关、前后台和勿扰策略；桥接成功不代表用户已经看见。桥接和回执确认不是跨进程事务，崩溃边界仍可能重复系统弹窗，不能承诺严格仅一次。旧桌面壳不识别日历通知时显示不可用，不绕过权限或改成模型任务。

`registerReminderScheduler` 保留为可选 Host 计划接口；接入方应避免同时启用另一套实际投递。DSH `schedule` 仍是会话提醒，独立于本系统通知路径。

## 面板通知

`calendar.changes(signal)` 通过 Runtime 已有的 Remote 逻辑流传递 `{revision}` 失效通知，合并密集变化。它不是一致快照或持久化日志。面板重读当前数据；断线重订阅、卸载取消，来源与个人域写入都能触发刷新。

公版周/月视图共用数据。机构“校历/课表”两个入口、默认视图和来源筛选预设仍待单独实现，不以本接口宣称已完成。

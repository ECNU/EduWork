# 插件通知协议（版本 1，候选）

Agent 的 `question`、`approval`、`completed`、`failed` 保持原接入。业务插件通过 Host 的 `notifications` 服务注册来源；Electron、托盘和桌宠只接收通用展示字段，不读取业务存储或负责业务导航。

## 分层与实现状态

| 层次 | 职责与入口 | 不负责的事情 |
| --- | --- | --- |
| 业务来源 | Agent 观察器，或业务插件注册的 `source + scope`；产生事件、校验目标、维护业务状态 | 不直接调用托盘或桌宠，不跨来源修改通知 |
| 通知注册表 | `dsh-plugins/notifications/lib/registry.js`：身份、去重、版本、撤回、偏好与生命周期 | 不替用户授权，不修改邮件、日程或成果 |
| 桌面桥与展示策略 | `dsh-plugins/desktop-services/lib/attention.js`、`dsh-electron/src/task-notifications.mjs`：能力握手、快照、展示与点击 key | 不读取业务数据库，不执行 target 中的内容 |
| 展示适配器 | 托盘、系统提示和桌宠消费同一份展示状态；`nativeNotificationAdapter` 负责平台通知 | 不定义业务事件，不在展示层管理账号或同步数据 |
| 业务导航 | Host `onAction` 校验后，由前端 `notificationActions` 完成导航并回执 | 系统通知的关闭事件不能视为业务已完成 |

下文描述当前候选实现，不能将已注册来源等同于已实现独立队列。当前插件仍共用 200 条活跃记录额度，展示仍有优先级与合并逻辑。**按来源独立的有界 FIFO 队列尚待实现，容量及状态转换验证完成前，本候选不能视为交付完成。**

### 来源队列的目标约束（待实现）

- Agent 与每个插件 `source` 隔离容量；同一来源的账号 `scope` 保持身份隔离，不靠增加账号绕过来源容量。
- 各来源使用统一的先进先出和溢出淘汰规则；不能依据 `requiresAction`、错误等级或“待办重要性”决定容量淘汰。业务语义继续由来源负责。
- 停用来源不得挤占其他来源；重启用时不集中补弹停用期间的历史通知。去重历史与待展示队列分开定义边界。
- 任一来源的积压和状态转换不能让整份快照超过桌面桥限制，进而阻断 Agent 或其他来源。
- 注册表中的记录、等待弹出的通知和操作系统实际可见的气泡是不同状态。保留记录不代表弹窗已经出现；移出展示队列不代表业务已解决。

### Windows 平台边界

当前 Windows 保留 `Tray.displayBalloon()`，不为便携版新增 Toast 注册；macOS 保留现有 `Notification` 路径。Windows 通知身份、开始菜单入口和点击激活注册随 [Windows 安装方式改造 #176](https://github.com/ECNU/EduWork/issues/176) 统一推进。

独立来源队列不意味着旧托盘气泡能够同时显示多个通知。当前适配器只保存一个气泡目标；后续队列调度必须验证展示与点击目标一致，不能用覆盖全局“最后一条通知”代替调度。将来切换 Toast 时应只调整平台展示适配与安装生命周期，不要求业务插件改用另一套发布接口。操作系统仍决定通知排列、通知中心和勿扰行为。

## Host 接入

服务通过 Cordis 按需注入；没有通知服务时，业务功能仍可运行。不能将插件事件伪装成 Agent 完成事件。通知是辅助显示，授权、邮件状态、日程和成果仍由原服务负责。

```js
ctx.inject(['notifications'], scope => {
  if (scope.notifications.version !== 1)
    throw Error('Unsupported notification protocol')
  const notices = scope.notifications.register(scope, {
    version: 1,
    source: 'example-mail',
    scope: opaqueAccountId, // 稳定账号标识；不放 token、邮箱或密码
    label: '邮件',
    events: [{
      id: 'received', label: '收到新邮件',
      level: 'info', requiresAction: false, actions: ['open'],
    }],
    async onAction({ target, signal }) {
      const message = await mailbox.read(target.uid)
      if (signal.aborted || !message) return false
      return { uid: message.uid }
    },
  })
  // 在业务收到新邮件时调用。示例不代表邮件收取已随本协议实现。
  async function notify(message) {
    return notices.publish({
      id: `inbox:${message.uid}`, event: 'received',
      title: message.subject, preview: message.preview,
      action: 'open', target: { uid: message.uid },
    })
  }
  // 将 notify 连接到本插件的收信回调，取消回调时也使用 scope.effect。
  // 切换账号必须销毁旧 scope/handle，再注册新账号。
})
```

`register(context, definition)` 返回绑定来源、账号和本次注册生命周期的句柄。Cordis scope 销毁时自动 `dispose()`；插件也可主动注销。同一 `source + scope` 不能重复注册。不同账号使用不同 scope，同一账号重注册也有新的生命周期标识，旧点击不能指向新账号。

当前调用方应串行执行同一通知 ID 的 `publish/update` 与 `withdraw/resolve`。`publish` 会等待桌面桥握手，在记录建立前调用撤回尚不能取消该次发布；不要把同步返回的撤回视为在途发布已取消。注销整个 scope 会通过生命周期检查拒绝尚未完成的发布。同 ID 并发操作的顺序保证需要随队列修正补齐。

| 接口 | 行为 |
| --- | --- |
| `publish(notice, { renotify = false })` | 按稳定 ID 去重；内容变化静默更新，显式 `renotify` 才重新提醒 |
| `update(notice, options)` | 只更新已存在的 ID；传完整通知，避免残留旧目标 |
| `withdraw(id)` / `resolve(id)` | 从所有展示渠道撤回；不修改业务数据 |
| `activity(ids)` | 可选，报告本来源正在执行的工作，供桌宠显示忙碌状态 |
| `dispose()` | 撤回本次注册的通知和活动，拒绝后续投递，使在途回调失效 |
| `signal` | 注销时取消；插件的异步动作必须在副作用前检查 |

事件声明：`level` 为 `info/success/warning/error`；`requiresAction` 表示是否仍等待业务处理，不能由点击自动完成；`actions` 为来源允许的动作名称。通知内容是纯文本，`title` 最长 120 字符、`preview` 最长 400 字符，不能包含控制字符。`target` 是最多 4096 字符的 JSON 引用，不放凭据、大文档或执行代码；shell 不接收 target。

发布返回 `{ status, key, delivery }`：

- `accepted`：通知已纳入本来源状态；`disabled`：来源或事件被关闭；`resolved`：同 ID 同内容已撤回，重复提交没有复活它。
- `delivery: desktop`：已交给支持协议的桌面管理器。它不保证操作系统弹窗可见，用户可能关闭弹窗或开启勿扰模式。
- `delivery: none`：没有桌面适配器，仅有 Host 状态；不能当作成功的桌面投递。业务可保留自己的收件箱/提醒列表。
- 桌面桥断开、旧 shell 不支持协议、容量超限或输入不合法时抛错，调用方自行安排重试；不能记录为已投递。

一次注册最多声明 32 种事件；全局最多保留 200 条未处理插件通知，不挤占 Agent 的 200 条记录。去重历史最多 1000 条，非持久化、不承诺无限期恰好一次。需要跨重启去重的插件保存自己的业务回执。

## 点击与前端导航

桌面点击仅返回不透明 key。Host 检查来源、设置、当前版本和注册生命周期，然后调用来源的 `onAction`。返回 `false` 撤回失效条目；异常不消费通知，可以重试。检查通过后，目标只通过已认证的 Host/UI 通道交给前端。

```js
ctx.inject(['notificationActions'], scope => {
  scope.effect(() => scope.notificationActions.register(
    'example-mail',
    async ({ scope: accountId, target, action, signal }) => {
      if (accountId !== activeAccountId || action !== 'open') return false
      const message = await api.readMessage(target.uid)
      if (signal.aborted || !message) return false
      openMessage(message)
    },
  ))
})
```

前端完成导航后才回执已查看。前端注册销毁时也会取消 `signal`，所有 await 后执行导航前应检查它。账号型插件在 Host 和 UI 两端都检查 scope，不能将旧账号引用用于当前账号。

普通通知已查看后退出待处理队列；`requiresAction` 通知仍保留，直至来源 `resolve/withdraw`。关闭气泡、隐藏桌宠、切换窗口不是业务完成。

来源可选提供 Host `onView(target, visibleTarget)`，前端注册的第三个参数返回 `{ scope, target }`，用于声明当前真正可见的业务对象。只有桌面前台且来源和账号一致时才调用；例如 Studio 只在对应成果实际可见时标为已查看。回调错误不阻断其他来源和 Agent。

`onView` 必须同步返回严格的 `true` 才表示已查看；异步校验放到 `onAction`。导航校验应按目标 ID 查询或使用已经验证的 Host 结果，不能把收件箱的第一页当作完整数据集。

## 分发与偏好

以下优先级是当前展示实现，并非上述 FIFO 容量规则；队列改造时需分别验证容量、弹出调度和业务状态，不能混为同一策略。

- 核心授权/提问优先于插件待办，待办优先于错误和普通进展。普通邮件不得覆盖正在显示的 Agent 授权提醒。
- 默认隐藏内容预览；shell/pet 获得的展示内容不包含业务目标或账号凭据。
- `eduwork-plugin-notifications.events` 保存 `source/*` 和 `source/event` 开关；设置页根据注册表生成，不为每个业务写分支。
- 关闭“桌面弹窗”仍保留托盘和桌宠状态。停用桌宠不影响其他渠道。
- Studio 原有 `studio` 和 `failed` 偏好分别作为完成/失败事件的初始回退。用户设置新的事件开关后优先使用新值，Agent 失败开关仍单独有效。

## 迁移与装配

Studio 自己观察成果生命周期、过滤历史记录并校验目标；日历保留原 `calendar_reminders` 回执、日程和个人备注，改为调用公共句柄。已发送的日历提醒不会因为协议迁移重新弹出；已读操作撤回对应通知。日历无桌面适配器时仍可在插件内查看提醒。

新 shell 不再识别旧 `studio/calendar` 专用条目，旧 `calendarReminder` 接口移除。Agent 接口和偏好保留，通知服务停用也不停止 Agent 观察器。

**必须成套升级 shell、桌面服务、通知服务、Workbench、Studio、日历和桌宠。** npm 交付时先发布包含协议支持的 Studio/桌宠，再更新产品精确版本锁与完整性；不使用源码覆盖发布包，也不把未发布版本记为已发布。源码联调只在隔离输出目录进行。旧 shell 的能力握手失败时插件投递报错，Agent 仍正常工作。

当前锁定的桌面产品装配显式启用本协议并校验配套 npm 包。归档的 DSH 0.1.5 Web 构建继续使用其原始插件组合，不启用本协议，也不将旧 Studio 视为支持统一桌面通知；日历仍可在插件内查看提醒。不能把归档 Web 构建通过当作当前桌面通知验收。

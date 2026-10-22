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

下文描述协议版本 1 的实现。Host 按插件来源维护独立的有界 FIFO；Agent 保留原有核心通知与容量策略。通知注册、桌面管理器接受和操作系统实际显示是三个不同阶段，不能将其中一个当作其他阶段的成功证明。

### 来源队列与容量

- Agent 保留独立的 200 条额度；每个插件 `source` 各有 200 条额度，最多注册 16 个不同来源。同一来源的账号 `scope` 保持身份隔离，共享来源额度。
- 插件按进入活跃队列的顺序淘汰最老记录，不依据 `requiresAction`、错误等级或“待办重要性”决定容量淘汰。被淘汰的通知不能继续点击，但其业务没有因此完成。相同内容重复发布不会复活它，来源明确要求 `renotify` 时才能重新排入。
- 停用来源不得挤占其他来源；重启用时不集中补弹停用期间的历史通知。去重历史与待展示队列分开定义边界。
- 每来源最多保留 1000 条去重记录，先清除最旧的非活跃记录。停用来源、普通通知转为待办等状态转换同样执行容量规则。
- 桌面桥逐来源校验 200 条上限，最多接收 3400 条记录（含 Agent），认证后的 attention 请求体上限为 12 MiB，覆盖规定字段长度的 UTF-8 文本。其他桥请求仍使用原有上限。
- 注册表中的记录、等待弹出的通知和操作系统实际可见的气泡是不同状态。保留记录不代表弹窗已经出现；移出展示队列不代表业务已解决。

### Windows 平台边界

当前 Windows 保留 `Tray.displayBalloon()`，不为便携版新增 Toast 注册；macOS 保留现有 `Notification` 路径。Windows 通知身份、开始菜单入口和点击激活注册随 [Windows 安装方式改造 #176](https://github.com/ECNU/EduWork/issues/176) 统一推进。

独立来源队列不意味着旧托盘气泡能够同时显示多个通知。Windows 适配器一次提交一个气泡，忙碌时返回 `false`，调度器保留其他待显示条目；点击或关闭后再提交下一条。撤回立即使旧点击目标失效。

Electron 的托盘回调没有通知 ID，且不会转发所有 Windows 隐藏事件，例如静默期的 `NIN_BALLOONHIDE`。因此适配器最多占用槽位 60 秒；无法确认旧气泡已结束时，后续气泡点击在本次运行中只重新打开应用，不猜测业务目标。托盘菜单和桌宠仍通过明确 ID 导航。这既防止队列永久卡住，也避免旧点击误开新通知。该上限只影响展示，不改变业务状态。

将来切换 Toast 时应只调整平台展示适配与安装生命周期，不要求业务插件改用另一套发布接口。操作系统仍决定通知排列、通知中心和勿扰行为。

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

同 ID 的 `publish/update` 在等待桌面桥前记录调用顺序，后调用者生效；较早调用即使晚完成握手也不能覆盖新目标。`withdraw/resolve` 同步取消该 ID 正在等待的发布；之后明确调用的新发布视为新的意图。注销整个 scope 会拒绝尚未完成的发布。来源仍应捕获异步调用的错误；顺序保证不等于跨进程持久事务。

| 接口 | 行为 |
| --- | --- |
| `publish(notice, { renotify = false })` | 按稳定 ID 去重；内容变化静默更新，显式 `renotify` 才重新提醒 |
| `update(notice, options)` | 只更新已存在的 ID；传完整通知，避免残留旧目标 |
| `withdraw(id)` / `resolve(id)` | 从所有展示渠道撤回；不修改业务数据 |
| `activity(ids)` | 可选，报告本来源正在执行的工作，供桌宠显示忙碌状态 |
| `dispose()` | 撤回本次注册的通知和活动，拒绝后续投递，使在途回调失效 |
| `signal` | 注销时取消；插件的异步动作必须在副作用前检查 |

事件声明：`level` 为 `info/success/warning/error`；`requiresAction` 表示是否仍等待业务处理，不能由点击自动完成；`actions` 为来源允许的动作名称。通知内容是纯文本，`title` 最长 120 字符、`preview` 最长 400 字符，不能包含控制字符。展示文字中的孤立 UTF-16 代理项会替换为替换字符，避免来源截断 emoji 后破坏桥接体积上限；业务 ID 和 target 不做这种转换。`target` 是最多 4096 字符的 JSON 引用，不放凭据、大文档或执行代码；shell 不接收 target。

发布返回 `{ status, key, delivery }`：

- `accepted`：通知已纳入本来源状态；`disabled`：来源或事件被关闭；`resolved`：发布已撤回或被后一次调用取代；`discarded`：通知已被本来源容量规则移出展示队列。重复相同内容不会复活已撤回或淘汰的记录。
- `delivery: desktop`：已交给支持协议的桌面管理器。它不保证操作系统弹窗可见，用户可能关闭弹窗或开启勿扰模式。
- `delivery: none`：没有桌面适配器，或在交付前已取消；不能当作成功的桌面投递。业务可保留自己的收件箱/提醒列表。
- 桌面桥断开、旧 shell 不支持协议、来源注册超过上限或输入不合法时抛错，调用方自行安排重试；不能记录为已投递。单个来源通知超过 200 条时执行 FIFO 淘汰，不拒绝其他来源或 Agent 的整批快照。

一次注册最多声明 32 种事件。队列及去重历史均非持久化，不承诺无限期恰好一次。需要跨重启去重的插件保存自己的业务回执。

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

容量淘汰、弹出调度、托盘/桌宠展示与业务状态分别处理。

- Agent 保留原有优先级与合并策略；普通插件事件不能替换仍等待处理的 Agent 授权/提问提示。插件来源之间轮转，同来源按 FIFO 依次弹出，不按业务等级抢占。适配器忙碌时不能把尚未提交的条目标成已显示。
- 托盘与桌宠继续从同一份状态生成展示，现有待处理/错误样式不参与来源队列的容量淘汰。前台工作和关闭桌面弹窗时保持安静，回到后台不补弹此前已静默处理的通知。
- 默认隐藏内容预览；shell/pet 获得的展示内容不包含业务目标或账号凭据。
- `eduwork-plugin-notifications.events` 保存 `source/*` 和 `source/event` 开关；设置页根据注册表生成，不为每个业务写分支。
- 关闭“桌面弹窗”仍保留托盘和桌宠状态。停用桌宠不影响其他渠道。
- Studio 原有 `studio` 和 `failed` 偏好分别作为完成/失败事件的初始回退。用户设置新的事件开关后优先使用新值，Agent 失败开关仍单独有效。

## 迁移与装配

Studio 自己观察成果生命周期、过滤历史记录并校验目标；日历保留原 `calendar_reminders` 回执、日程和个人备注，改为调用公共句柄。已发送的日历提醒不会因为协议迁移重新弹出；已读操作撤回对应通知。日历无桌面适配器时仍可在插件内查看提醒。

新 shell 不再识别旧 `studio/calendar` 专用条目，旧 `calendarReminder` 接口移除。Agent 接口和偏好保留，通知服务停用也不停止 Agent 观察器。

**必须成套升级 shell、桌面服务、通知服务、Workbench，以及产品选择装入的通知消费方。** 当前 npm 组合为 Studio 0.6.1、桌宠 0.1.1；二者声明 `eduworkNotificationProtocol: 1`。若产品选择日历，必须同时选择已迁移的版本；协议本身不要求产品一定装入日历。

npm 交付先发布支持协议的包，再更新产品精确版本锁与完整性；装配同时检查协议声明，拒绝与旧包混装。不使用源码覆盖发布包，也不把未发布版本记为已发布。源码联调只在隔离输出目录进行。旧 shell 的能力握手失败时插件投递报错，Agent 仍正常工作。

当前锁定的桌面产品装配显式启用本协议并校验配套 npm 包。归档的 DSH 0.1.5 Web 构建继续使用其原始插件组合，不启用本协议，也不将旧 Studio 视为支持统一桌面通知；日历仍可在插件内查看提醒。不能把归档 Web 构建通过当作当前桌面通知验收。

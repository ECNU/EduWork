# EduWork 日历插件

**简体中文** | [English](README_EN.md)

公版的日历与日程面板：左侧栏提供入口，主区是按小时轴排布的周视图与日程页，Host 半提供日程记录的本机存储与 ICS 导入导出，并为机构版预留数据注入位置。

状态：开发中。Host 半的日程模型、本机存储、`calendar` 服务与客户端数据通道均已完成；周视图按整日小时轴画出这一周（今天列高亮、同一时段重叠的日程并排分列），打开时自动滚到这周日程所在的时段，点任意一条打开详情弹窗；顶部「新建日程」、空日历的引导与周视图里拖动或双击空白时段都能新建，日程页左栏改标题、日期、时间、地点与备注，右栏按月份列出最近一年的出现时间，可对单次改期、取消、恢复或删除整条；导入支持拖拽文件与粘贴文本，导出可复制或下载；模型也能改这份日历——五个工具覆盖读区间、新建、修改、删除与按单次改期或取消，写入前由用户确认。范围、日程数据结构与机构版边界见[日历与日程模块提案](../../docs/proposals/calendar/README.md)。

公版是日历，不是课表：公版里只有日程这一种记录，学校课表、校历与教务规则由机构插件作为数据来源注入，见[提案](../../docs/proposals/calendar/README.md)。

## 功能

- 左侧栏入口：登记到 `sidebar.panellist`，点击后主区切换到本面板。
- 周视图：一周七列排在同一条整日小时轴上，左侧是整点刻度，今天列高亮；当前时刻画一条线。同一时段重叠的日程并排分列，而不是互相压住。可前后翻周、回到本周，并显示本周条数。
- 拖动即可新建：在空白时段按下并沿时间轴拖出一段（15 分钟对齐），松手就按这个时间段打开新建弹窗；双击空白时段则按一小时新建。
- 全天记录画在日期表头里：从界面新建的日程总带开始与结束时间；ICS 里不带时间的全天记录（`DTSTART;VALUE=DATE`，节假日与校历订阅几乎全是这种）照旧导入并显示，作为日期表头里的一枚「全天」小条列出，跨天的记录在它覆盖的每一天都出现。它不占时间轴上的任何一格，滚动时一直看得见，点开同样能改——全天记录本来就不属于某个时段，这样也才不会被滚过去。
- 打开位置：周视图画的是完整的一天，打开时自动滚到这周日程所在的时段，面板再高也不会在下面留一片空白；一周没有日程时停在工作时段。
- 日程详情：点任意一条打开弹窗，显示时间、地点、来源与重复规则，并可直接改期或改地点、撤销改期、取消这一次或删除整条日程；改期只改开始时间时，结束时间跟着一起移动，条目保持原长度；全天记录没有钟点，弹窗指向它的日程页去改日期与地点。
- 新建与编辑：顶部「新建日程」、空日历中央的引导，以及周视图里双击空白时段都会打开新建弹窗，双击时时段已经填好；弹窗里写标题、日期、开始与结束时间、地点、备注，并可以打开"每周重复"。保存后回到周视图，新日程就在刚才的位置。日程页左栏直接改同这些字段，右栏点某一次可以单独处理那一次。
- 重复规则：每周重复的日程按"发生"展开，`interval`、`count`、`until`、`byDay` 生效；`exceptions` 取消某一次，`overrides` 调整某一次。
- 日程页：入口是顶部「日程」菜单（列出全部日程）或周视图里的标题。左栏改标题、日期、开始与结束时间、地点与备注，并列出这条记录的已取消日期与恢复按钮；右栏按月份分组列出最近一年的出现时间，点一条打开同一个详情弹窗。
- 导入导出：导入是弹窗，既可以把 `.ics` 文件拖进面板或拖到弹窗里，也可以直接粘贴文本，导入结果（写入、移除、跳过与降级的明细）就在同一个弹窗里；导出弹窗给出可复制或下载的日历文本。
- 日程记录：`calendar` 服务提供读取、写入、区间查询、按发生查询、快照导入与 ICS 导入导出，记录保存在本机。

## 界面

- 时间轴而不是卡片列表：日历的第一件事是时间。一天是一列，一小时 48 像素，日程是按开始与结束时间定位的块，所以"上一节 10:00 结束、下一节 10:00 开始"在画面上是上下相邻的两块，而不是两条并列的文字。
- 重叠分列：一天里时间有交叠的日程归为一组，组内平均分配这一天的宽度；本组结束后（下一条的开始不早于本组最晚的结束）恢复整宽。日期也算身份的一部分：两个都从 08:00 开始但不在同一天的日程不算冲突。这部分几何是纯函数（`src/layout.js`），不依赖 React，单独有 15 例测试。
- 整日轴：轴画满 24 小时，打开时滚到这周第一条日程所在的整点，所以面板高时看到的是更多小时，而不是固定工作时段下面的一片空白。翻周时轴不动，只换内容。
- 颜色跟着来源：同一数据来源的日程用同一种色调，手动新建的是一种，导入的 ICS 是另一种；来源不是装饰，它是"这条记录是谁写进来的"。
- 空日历留白：没有日程的位置不画任何东西，不写"无安排"；整个日历为空时，面板中央给一张卡片，说明可以新建日程或拖入 `.ics` 文件。
- 复用产品的界面原件：按钮、弹窗、菜单、输入框、开关、标签与图标都来自宿主提供的 `@deepseek-ai/dsh-client-ui-primitives`，深浅色主题与键盘操作跟外壳其余部分一致。两条发行线带的原件是两代：早期把绘制尺寸写进图标名（`IconPlusOutline16`），后来改成笔画变体加 `size` 属性（`IconPlusOutlineRegular`）。组件本身两代相同，图标则按运行时实际导出的一组名字解析（见 `src/client.ts` 里的 `icon()`），所以面板在两代外壳里都能画出来，而不是静态引一个某一代没有的名字。

## 数据模型与存储

- 日程字段：`uid`、`title`、`start` 必填，另有 `end`、`location`、`description`、`recurrence`、`exceptions`、`overrides`、`source`、`extensions`。`description` 就是日历里的备注（ICS 的 `DESCRIPTION`）。
- 时间使用本地时间字符串（`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm`），首版不做时区换算；字段沿用 ICS 词汇（`UID`、`SUMMARY`、`DTSTART`、`DTEND`），未识别字段原样保存在 `extensions`。
- 重复规则只支持每周：`freq`、`interval`、`count`、`until`、`byDay`。范围之外的规则（每月、每年、`BYMONTHDAY`、`BYSETPOS`）由导入方把原始 RRULE 文本放进 `extensions` 并降级为单次日程，不静默丢弃。
- 记录存放在本机存储域的一张表：`events` 按 `uid`。写入先落盘再可见，读取取自内存状态，变更以 `domain/changed` 通知；不联网、不上传、不写日志。存储域的后端由装配配置决定，插件本身不持有路径。
- `snapshot()` 返回带 `schemaVersion` 的完整数据（`{ schemaVersion, events }`）；导入按 `uid` 合并，同一份快照重复导入结果不变，且先校验全部记录再写第一条，被拒绝的导入不会留下半份数据。
- 写入用 `putEvent({ ...record })`：调用方自己给出 `uid`（界面新建时生成 `manual-<uuid>`），插入或整体替换，没有 `source` 时补成 `manual`。记录形状只此一种，写进去什么就取到什么样。

### 重复、改期与取消

存储的是**系列**，视图看到的是**发生**（occurrence）：`occurrences({ from, to })` 每次调用现算，不保存任何按周副本，因此不存在"某一周的副本过期"的问题。每条发生带 `occurrenceId`（`<uid>#<系列本应产生的日期>`）与 `occurrenceDate`，界面按它渲染，后续提醒与课堂纪要也用它定位。

| 情形 | 表示 | 说明 |
| --- | --- | --- |
| 取消这一次 | `exceptions: ['2026-03-16']` | 对应 ICS 的 `EXDATE` |
| 改期、换地点 | `overrides: [{ date: '2026-03-23', start: '2026-03-27T14:00', location: '示例楼 202' }]` | 对应 ICS 的 `RECURRENCE-ID`：只写变化字段，其余继承系列；`date` 是系列本应产生的日期，所以之后改动系列时间也不会失配 |
| 额外加一次 | 独立记录 | 不属于任何系列，各用各的 `uid` |
| 长期变更（从第 9 周起换教室） | 切开系列 | 原系列以 `until` 收在第 8 周，新系列从第 9 周起（新 `uid`）：`RRULE` 表达不了"从某周起改变" |

服务提供 `applyOverride({ uid, date, patch })` 与 `removeOverride({ uid, date })` 记录或撤销一次改期，`cancelOccurrence({ uid, date })` 与 `restoreOccurrence({ uid, date })` 取消与恢复这一次。`date` 上重复的覆盖会被拒绝，空的覆盖（只给 `date`）也会被拒绝：契约里不存在"什么都没改"的改期。取消一次会给已经有改期的那天连带撤掉那次改期——那天已经没有安排可改了。

### 存储形状的演进

记录契约曾经带过 `courseId`。现在它不再是公开字段，但旧记录里可能还有：存储域按 `StoredEventSchema` 读取（公开契约加上这类已退休字段），`CalendarStore.open()` 在开库时把这些记录改写成当前形状，一次写完就再也不会出现。域版本仍是 1——后端校验的是整个单元的版本，升级版本会让改动之前的存储直接打不开，而"日历打不开"比"多读一个字段"糟得多。同一次开库也会让旧存储里那张不再被读取的表随第一次写入消失。

## 客户端数据通道

- Host 半把 `snapshot`、`occurrences`、`importIcs`、`exportIcs`、`putEvent`、`deleteEvent`、`applyOverride`、`removeOverride`、`cancelOccurrence` 与 `restoreOccurrence` 标记为远端方法（`lib/index.js` 中的 `Remote(...)`），并由包导出的 `./typert`（`lib/typert.host.js`）交给 typert loader 注册到网关；线缆契约的 zod schema 在 `lib/typert-schemas.js`，与记录 schema 共用同一份定义，避免两处描述不一致。
- 两个面（`./typert` 与 `./remote`）的描述清单来自同一份 `lib/typert-descriptors.js`，所以方法名、参数与 schema 不会两边写歪；测试还校验每个描述的行号确实指向 `lib/index.js` 里实现它的方法。
- 每个远端方法收一个对象参数、返回一个 JSON 值。客户端半挂载包导出的 `./remote`（`lib/typert.remote-client.js`）：先 `ctx.remote.$mount(...)`，再在 `ctx.inject(['remote.calendar'], ...)` 中调用，例如 `remote.calendar.occurrences({ from, to })` 拿到 `{ schemaVersion, occurrences }`（一次往返带回这一周的全部日程），`remote.calendar.putEvent({ uid, title, start })` 写入一条日程。网关返回 `{ ok, value }` 或 `{ ok, error }`，客户端解包后渲染。
- 界面只取当前这一周：翻周就是换区间重新取数，不缓存、不物化；日程页取最近一年左右的窗口，同样不落盘。每次写入后重新取数，所以界面上看到的就是记录当前的样子。`snapshot()` 保留给导出与机构注入这类需要全量数据的场景。
- 面板只在远端可用时注册，数据中心不可用时不会出现空白面板。

## Agent 读写接口

`lib/tools.js` 把同一份 `calendar` 服务开放给会话里的模型，五个工具覆盖读与写：

| 工具 | 作用 |
| --- | --- |
| `calendar_list_events` | 读一个日期区间的全部发生，逐条给出 `uid`、日期、时间、地点与是否每周重复 |
| `calendar_create_event` | 新建一条记录，可带 `repeat: "weekly"` 与 `until` |
| `calendar_update_event` | 按 `uid` 改一条记录，只改调用给出的字段；挪动开始时间时保留原时长 |
| `calendar_delete_event` | 按 `uid` 删除整条记录 |
| `calendar_occurrence` | 只处理系列里的某一次：`move`、`reset`、`cancel`、`restore` |

每个区间都是有限的：不写 `from` 就从今天往前 180 天，不写 `to` 就给一年，一次最多 3660 天。这不是保守，而是必须——没有结束日期的每周系列会一直展开到给定的上界，不设上界就等于要四千年的日期。写入只带要改的字段：字段留空就保持原值，空字符串才是清除。

写工具在 `tools/pre-execute` 上统一过一道确认（`lib/tool-permission.js`）：读取直接放行，写入弹确认，已经处于「无审批」的会话直接放行，没有会话上下文的写入直接拒绝。工具与面板写的是同一份记录、走同一套校验，不存在第二份实现。

## 使用的接口

| 接口 | 用途 | 要求 |
| --- | --- | --- |
| `sidebar.panellist` | 左侧栏的面板入口 | 列表槽；登记项需要 `id`，可选 `order` 与 `label` |
| `main` | 主区面板 | 键值槽；`key` 与侧栏 `id` 相同即互相切换 |
| `storageDomain` | 日程记录的持久化 | 域表形式的存储域；域在插件初始化时打开 |
| `remote`（Typert 网关） | 客户端半读写 Host 记录 | 宿主面经 `./typert` 注册，客户端面经 `./remote` 挂载；`snapshot`、`occurrences` 与 8 个写入方法跨半可见，其余方法只属于 Host 侧 |
| `@deepseek-ai/dsh-client-ui-primitives` | 客户端半的按钮、弹窗、菜单、输入框与图标 | 由宿主提供，不打进产物；声明在 `dsh.client.inject` 与 `peerDependencies`。两条发行线的元件同名，图标名分两代，按运行时导出名解析 |
| `tools`、`permissionPresets` | 注册 Agent 工具与写入确认 | `ctx.tools.register(defineTool(...))`；`tools/pre-execute` 返回 `ask` 或 `deny`，`permissionPresets.current()` 读出当前审批档 |

插件声明为可整体移除、不侵入核心（`package.json` 的 `chatecnuWork`：`kind` 为 `ui-extension`、`removable` 为真），并保持零运行时依赖。

## 构建

- 客户端半：装配时由 `build-client.ps1` 把 `src/client.ts` 连同它引用的 `src/layout.js` 编译为 `lib/client.js`（`tsdown`，配置见 `tsdown.config.ts`）。脚本接收装配传入的 `-Upstream`（编译工具链）与 `-RuntimePackages`（运行时 `node_modules`），把其中的 `zod` 以链接方式铺进临时编译目录，编译结束后只删除该链接。`react` 与 `@deepseek-ai/dsh-client-ui-primitives` 是外部依赖，不打进产物。编译工具链由装配流程准备，不在仓库内。
- Host 半：`lib/model.js`（记录契约）、`lib/store.js`（存储域读写）、`lib/ics.js`（ICS 解析与生成）、`lib/tools.js`（Agent 工具与它的写入确认）、`lib/typert-schemas.js`（线缆 schema）、`lib/typert-descriptors.js`（两个面共用的远端描述）、`lib/typert.host.js`（宿主面）、`lib/typert.remote-client.js`（客户端面）与 `lib/index.js`（`calendar` 服务）均为手写源码，装配时原样拷贝。
- 登记位置：插件清单与 `localPlugins` 分别位于 `config/distributions/generic.json` 与 `config/assembly.eduwork.json`；Agent 工具是同一个包的 `./tools` 子路径，作为 `patches` 里的一条 `insert` 装进合成清单（与 `search-auto` 同一种形式），面板与工具因此是同一份包的两个入口。

## 测试

`node --test test/*.test.mjs`（或 `npm test`）。测试用装配锁定的 Runtime 提供 `zod`、存储包与 Typert 协议：把 `EDUWORK_TEST_RUNTIME` 指向运行时目录后运行，未设置时跳过；CI 准备好运行时后执行同一命令。两条固定运行时线（通用 Web 的 `release-v0.1.5-rc.2` 与桌面候选的 `candidate-v0.2.0-rc.2`）上各 81 例全部通过；参数 codec 需要带 `create()`，缺了会在后一条线上被 loader 校验拦下。`test/model.test.mjs` 覆盖记录契约与快照（8 例），`test/occurrence.test.mjs` 覆盖发生的展开、`exceptions`、`overrides` 与跨天记录保留的天数（16 例），`test/ics.test.mjs` 覆盖字段映射、行折叠与转义、`RRULE` 子集与降级、`EXDATE`/`RECURRENCE-ID`、导出语法与"往返不丢未识别字段"（18 例），`test/remote.test.mjs` 校验两个面描述同一组方法、参数与结果 schema、每个描述指向真实方法，并确认清单能通过 loader 校验（5 例），`test/store.test.mjs` 用真实 Cordis 作用域与 JSON 后端验证往返、重启、原子导入、区间查询、改期与取消写入、ICS 导入与再导出、按来源替换式合并、旧存储的迁移，确认只有被标记的方法出现在活实例的远端表面上，并校验声明的线缆 schema 能解析方法真实返回的载荷（9 例），`test/tools.test.mjs` 用真实现发生规则验证五个工具读写到的方法与参数、区间上界、只改给出的字段，并覆盖写入确认的四种判定（9 例），`test/layout.test.mjs` 覆盖周视图的取轴、重叠分列几何与改期时的时长保持（16 例，纯函数，不需要运行时，因此不随 `EDUWORK_TEST_RUNTIME` 跳过）。

## 文档

- [日历与日程模块提案](../../docs/proposals/calendar/README.md)：目标、范围、日程数据结构、提醒边界与机构版边界。

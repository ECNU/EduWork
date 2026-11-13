# 教育校历与课表

**简体中文** | [English](README_EN.md)

为 DSH 日历提供学年、学期、教学周、单双周、考试与假期背景，以及按教学班组织的完整课表。用户在日历面板的“选择校历”中切换适用校历，选择保存在本地；没有桌面桥接也可使用。

机构插件通过 `ctx.academicCalendar.registerDataset({ id, label, dataset })` 登记校历，取得带 `dispose()` 的句柄。数据采用 `schemaVersion: 2`：学期包含 `id/name/firstDay/lastDay/weekCount/phases`，阶段包含 `kind/name/firstDay/lastDay/weeks`，另列 `breaks` 和具体事项 `events`。`revision` 为可选正整数；同版本内容冲突和版本回退会拒绝写入。日期查询与背景展示共用计算规则：有周号的阶段按完整周表达，末周截于学期边界；寒暑假没有教学周，小学期独立编号。具体事项作为普通日程写入，周次与阶段不生成事件。

课表使用 `ctx.academicCalendar.importTimetable({ institution, account, dataset })`。`dataset` 的完整示例见 [timetable.json](examples/timetable.json)。每次提交须包含这个机构、账号、学期当前有效的全部课程和上课实例；空列表表示明确清空。校验失败不替换旧数据。课程分组保留在教育插件，普通日历事件的 `extensions['eduwork.academic']` 携带教学班、学期、时区和学校提供的单次课编号。时间为该课表时区中的本地时间，学校作息及周次转换由资料转换或机构适配完成。

有稳定的单次课编号时，改期保留个人关联。没有编号时按教学班和起止时间确定身份，时间变化生成新实例，旧笔记和设置留在日历的待确认内容中，不猜测迁移。法定节假日独立显示，不自动改写课程。

安装时组合 `@eduwork/dsh-calendar`、`@eduwork/dsh-calendar-subscriptions` 和本包，应用 [cordis.patch.yml](cordis.patch.yml)，同时启用 `skills/academic-calendar` 与日历、订阅管理技能。机构数据包另外安装。本轮仍为开发包，源码装配仅用于开发；npm 发布与产品版本锁由维护者接续。

AI 使用 `academic_calendar_query` 查询指定或当前所选校历，`academic_courses` 读取教学班与完整安排，`academic_import_timetable` 导入已核对的结构化课表。日历工具继续管理具体日程、笔记与提醒。

## 远程更新

订阅插件启用后，本包自动注册 `academic-calendar` 和 `academic-timetable` 两种格式。通过 `calendar_subscribe` 或 `calendarSubscriptions.addFeed({ url, format, label, intervalHours, profileID? })` 添加。前者响应为上述完整校历 JSON；后者响应为 `{ institution, dataset }`，dataset 与 [课表示例](examples/timetable.json) 相同。账号从 Host 当前身份获得，响应不能提供或更换账号。

更新、重试、最近成功状态和授权由订阅插件负责。教育包校验并持久化完整文档、维护课程分组和背景，通过来源句柄更新普通事件。完整校历的 revision 校验覆盖学期、阶段、假期和事项；相同 revision 内容变化或回退均拒绝，重启/退订不清除版本保护。未选中的校历继续刷新，只有所选校历背景及具体事项可见。停用、退出和卸载会同时隐藏该来源的教育查询内容；离线重启保留最近成功快照，重新启用时恢复。

这些格式提供可接入的标准通路，不表示学校已提供个人课表 API。官方静态校历和手动结构化导入仍可独立使用。

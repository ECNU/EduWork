# DSH 0.2.1 集成

[English](CORE-021_EN.md)

当前构建配方选用 DSH `0.2.1-rc.2`，上游提交为 `687f282e8625c6b8d11ff58211a90524be2e4317`。`config/desktop-build.json` 指向 [候选锁](../third_party/dsh/candidate-v0.2.1-rc.2/LOCK.json)，npm Runtime、Host 和 Electron 源码分别校验。产品版本与内核版本独立；切换构建配方不会发布安装包或更新软件更新源。

## 能力与迁移

- 沿用官方插件管理器、浏览器和 Office 能力。新增官方 DeepSeek Search / Fetch API 提供者由原生设置管理；保留 EduWork 既有搜索默认值、用户选择及浏览器回退。
- Schedule 已并入官方基础组合。升级清除旧实验 Schedule bundle 的依赖和激活引用，保留任务存储、配置及其他插件；不再安装已停止发布的实验 bundle。
- 官方开发者工具以可选 bundle 提供，产品不默认启用请求采集。需要排错时按官方插件管理方式启用并检查导出内容。
- 文献和桌宠继续使用组件锁中已发布的 npm 版本。升级内核不会仅为改版本声明而重新发布插件。
- 官方统计、会话上报及反馈入口继续遵循已有发行策略。升级保留用户配置和会话；旧会话迁移不得覆盖历史文件，损坏日志不得被当作成功迁移。

## 适配边界

移除已经由上游实现的本机回环地址与随机端口补丁、文件引用重扫的撤销历史补丁。文件卡片展示、桌面集成和产品插件仍由 EduWork 提供。

活跃会话自动落盘引发的搜索冲突在此版本仍存在：锁定 npm 包中的查询实现与此前版本逐字节相同。因此保留[搜索一致性补丁](SESSION-SEARCH-BACKPORT.md)，继续检查完整文件哈希，并运行官方失败对照和修复回归。上游提供等价修复后应删除它。

## 构建与验证

[构建指南](BUILD.md)说明入口。各装配阶段从同一配方读取版本和提交，额外的输入文件哈希及 npm integrity 校验保持不变。`validate-pinned-dsh-source.yml` 在 Windows/macOS 验证实际 Host、Electron 桥接、已装配产品、设置与插件。

历史会话和语音适配探针也读取当前配方，使用新建的合成数据目录：

```sh
node scripts/probe-dsh-017.mjs --runtime <prepared-runtime> --output <new-evidence-directory>
node scripts/probe-dsh-017-speech.mjs --runtime <prepared-runtime> --output <another-new-directory>
```

这些探针不使用真实账号或模型推理，也不能替代原生桌面与正式升级验收。此前组合保留在 [DSH 0.2.0 集成说明](CORE-020.md)及对应锁中。

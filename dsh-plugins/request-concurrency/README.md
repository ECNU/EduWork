# 模型请求总并发

[English](README_EN.md)

通过 DSH 官方 `llm/stream` 扩展点维护一个 FIFO 请求队列。默认总计 3 路，主会话、普通/后台/嵌套子代理、工作流内置 spawn 子代理以及压缩等辅助请求共同使用名额。多个工作区和根会话也共用同一 Host 队列；没有固定保留的主会话槽位。

限制的是实际模型请求流，不是代理对象或完整任务。工具执行、等待子代理结果期间不持有槽位，因此总并发为 1 时仍能执行嵌套代理任务。取消的等待请求退出队列；异常或提前结束流释放名额。代理列表的“正在运行”描述任务状态，不等于正在请求模型。

## 设置与兼容

设置 → 通用设置 → 模型请求总并发：填 2 就是总计最多 2 路，填 3 就是最多 3 路，范围 1–64。通过官方 Settings 的 `eduwork-concurrency.maxConcurrentRequests` 持久化到本机 `dsh/settings.yaml`，保存后生效。降低上限不打断已有请求，新的请求等到占用数降到上限以下再进入；提高上限会继续处理等待队列。

旧版将主会话 1 路与子代理上限分开。升级读取官方 Settings 的用户层，将旧 `maxParallelSubagents: N` 一次换算为 `maxConcurrentRequests: N + 1`，用官方原子字段变更接口保存并移除旧偏好字段。已保存的新总上限优先，不会重复加 1。

发行默认值使用 JSONC `features.maxConcurrentRequests`，两种桌面壳都通过共享 Host 转为 `EDUWORK_MAX_CONCURRENT_REQUESTS`。Web 可在插件配置中使用 `maxConcurrentRequests`。旧 JSONC / 插件配置 / 环境变量 `maxParallelSubagents` / `EDUWORK_MAX_PARALLEL_SUBAGENTS` 继续读取并换算为总量，不重写用户配置文件。用户在设置中保存的数值优先于发行默认值；文件变更需重启，界面保存无需重启。

DSH 0.1.7 原生桌面通过生成的插件配置传入 `features.maxConcurrentRequests`，不依赖旧环境变量；界面通过官方 volatile 配置写入桌面 profile。0.1.7-rc.1 同时把 `features.maxActiveSubagents`（默认 2）传给官方 `subagent` 插件，限制一个主 Agent 下的子代理数量，达到上限拒绝新建。两项限制互不换算；它们在界面已保存的值始终优先于后续发行默认值。

官方工作流的 `maxConcurrentAgents` 仍限制单次工作流的任务数，内置工作流保留默认 2。它与本插件的全 Host 模型请求上限作用不同，不能单独保证多个工作流和普通子代理的合计请求量。本插件复用官方请求入口，不改任务持久化或另写代理执行器。

## 范围

队列约束当前 Host 经 DSH LLM 服务发出的请求，覆盖各模型提供方，属于客户端总上限。另开的客户端、外部 SDK/Codex/Claude 进程、脚本直接调用 HTTP、图像生成和 TTS 等独立媒体端点均不在队列内。服务端仍应实施账号级限制，不能将本队列当作账号配额或跨进程限流。

## 验证

`node --test test/concurrency.test.mjs` 检查队列基本行为。设置 `EDUWORK_TEST_RUNTIME` 为锁定 rc2 Runtime 的 `d` 目录后，同一测试会通过真实 Cordis 插件装载、DSH LLM 和 Settings 服务验证总量 1/2/3、两个根会话与六个子代理混合请求、旧偏好迁移、即时生效、取消和嵌套任务。

测试使用合成模型适配器，不读取用户会话或调用学校模型。Go / Electron 的配置传递由公共 `dsh-host/test/product-profile.test.mjs` 验证。

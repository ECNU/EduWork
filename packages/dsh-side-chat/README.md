# 临时侧边聊天（实验）

**简体中文** | [English](README_EN.md)

状态：已有独立实验实现，未发布，不进入默认产品装配。锁定的 DSH `0.2.1-rc.2` 支持分叉和嵌入式聊天，但不能单独提供本插件要求的临时生命周期；本地实验需使用显式构建的 Runtime 扩展。

实验固定使用 `candidate-v0.2.1-rc.2` 的历史基座；主线默认产品已升级至 `0.2.1-rc.3`，不受此实验影响。不能将实验产物混入当前默认产品，或将 rc.2 验收当作 rc.3 的兼容认证。

从原会话的一条用户消息或已完成的助手回答开启临时侧聊，在原生右侧栏使用同一套聊天组件。侧聊记录从 0 开始，打开时为空；截至选中消息的历史仅作为独立内存上下文随模型请求携带，不复制到消息记录，也不继续执行其中的任务。来源后续消息不进入参考上下文。模型配置继承截断点的记录。

侧聊不进入普通列表、历史搜索和自动记忆索引。关闭侧聊后停止会话并丢弃其消息与草稿；切换主会话、成果预览、收起、隐藏窗口和长时间不活动不会结束会话，不依赖心跳续租。刷新或窗口退出时请求关闭；异常终止导致关闭请求未送达时，残留仅驻留内存，随 Host 退出释放，重启后不可恢复。显式要求改写的工作文件和外部操作不会随关闭撤销。

每个主会话各自保留一个侧聊，切换主会话时恢复对应的消息、草稿和批注，关闭其中一个不会影响其他侧聊。刷新或退出窗口会关闭其所有临时侧聊。不支持转正、侧聊内再分叉、子代理、定时任务和长期后台工作。工具仍遵守新会话的权限，生成仍遵守全局并发规则。

## 本地开发

空会话中央显示「侧边聊天是临时聊天，关闭后会消失」，发送后隐藏；输入框始终位于底部。关闭使用原生侧栏标签的 ×。选中已完成、中间或正在输出的助手文字，可选择「在侧边聊天提问」，将摘录作为可编辑的未发送批注加入侧聊，无需等待主会话结束。流式选段的历史快照截至其前最近的用户问题，未完成输出仅通过所选摘录传入。已有同来源侧聊时继续添加，保留最初的上下文截断点与草稿；原会话草稿不变。该操作需要同时装配本地批注扩展。

```sh
npm ci
npm run build
npm test
```

上述命令在本包目录执行。`npm test` 默认只运行状态与策略测试；真实 Runtime 集成项在未设置 `EDUWORK_SIDE_CHAT_RUNTIME` 时明确跳过。设置该变量为实验 Runtime 根目录（包含 `package.json` 和 `node_modules`）后重新运行。集成测试加载当前工作树的服务源码，依赖从指定 Runtime 解析，不使用其中已安装的侧聊包；不应将跳过项计为通过。

在 EduWork 根目录使用 `scripts/build-side-chat-experiment.mjs` 生成独立实验 Runtime。构建入口要求已经验证的 npm Runtime、准备好的锁定编译器和全新的输出目录，不会修改原始依赖缓存。

根目录下的完整实验流程（参数均为独立本地目录）：

```sh
node scripts/build-side-chat-experiment.mjs --runtime <approved-runtime> --compiler <prepared-compiler> --output <new-experiment>
npm pack ./packages/dsh-side-chat --pack-destination <local-tarballs>
npm pack ./packages/dsh-annotation --pack-destination <local-tarballs>
node scripts/assemble-side-chat-experiment.mjs --base-product <normal-product> --experiment <experiment> --compiler <prepared-compiler> --tarball <local-tarball> --annotation-tarball <local-annotation-tarball> --output <new-product>
node packages/dsh-side-chat/scripts/browser-test.mjs --product <experimental-product> --output <new-web-evidence>
node packages/dsh-side-chat/scripts/browser-test.mjs --product <candidate>/resources/product --desktop <candidate>/EduWork-Electron.exe --output <new-desktop-evidence>
```

编译器按[构建指南](../../docs/BUILD.md)准备，须匹配锁定的 DSH 源码并带 `.eduwork-build-tools.json` 回执。Windows 官方源码归档中的符号链接可能需要开发者模式或先在仓库外制作可解包的编译器归档；不得静默使用未准备的工作区。正常产品、外壳和 Windows 候选沿用对应构建脚本，实验装配保持独立目录并关闭自动更新。

浏览器和桌面脚本运行真实 Host/AgentLoop，使用确定性模型适配器和合成会话；不调用外部模型。测试数据、启动凭据、截图和回执只写入指定的仓库外证据目录。桌面模式测试实际候选可执行程序；退出时自动确认该隔离测试实例的退出提示。

产品行为见[侧边聊天提案](../../docs/proposals/side-chat/README.md)。npm 发布、默认组件锁更新与桌面发布分别处理。

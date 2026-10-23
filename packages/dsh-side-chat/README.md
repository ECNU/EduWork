# 临时侧边聊天（实验）

**简体中文** | [English](README_EN.md)

状态：已有独立实验实现，未发布，不进入默认产品装配。锁定的 DSH `0.2.1-rc.2` 支持分叉和嵌入式聊天，但不能单独提供本插件要求的临时生命周期；本地实验需使用显式构建的 Runtime 扩展。

从原会话的一条用户消息或已完成的助手回答开启临时侧聊，继承截至该处的历史，在原生右侧栏使用同一套聊天组件。来源后续消息不进入侧聊；继承历史仅供参考，不继续执行其中的任务。模型配置继承截断点的记录。

侧聊不进入普通列表、历史搜索和自动记忆索引。关闭侧聊后停止会话并丢弃其消息与草稿；切换主会话、成果预览、收起和隐藏窗口不主动丢弃。异常断线留下的内存会话由租约清理，重启后不可恢复。显式要求改写的工作文件和外部操作不会随关闭撤销。

首版每窗口一个侧聊，不支持转正、侧聊内再分叉、子代理、定时任务和长期后台工作。工具仍遵守新会话的权限。

## 本地开发

```sh
npm ci
npm run build
npm test
```

上述命令在本包目录执行。`npm test` 默认只运行状态与策略测试；真实 Runtime 集成项在未设置 `EDUWORK_SIDE_CHAT_RUNTIME` 时明确跳过。设置该变量为实验 Runtime 根目录（包含 `package.json` 和 `node_modules`）后重新运行，不应将跳过项计为通过。

在 EduWork 根目录使用 `scripts/probe-side-chat-runtime.mjs` 检查真实 Runtime 的生命周期能力，使用 `scripts/build-side-chat-experiment.mjs` 生成独立实验 Runtime。构建入口要求已经验证的 npm Runtime、准备好的锁定编译器和全新的输出目录，不会修改原始依赖缓存。

根目录下的完整实验流程（参数均为独立本地目录）：

```sh
node scripts/probe-side-chat-runtime.mjs --runtime <approved-runtime> --output <new-baseline-evidence>
node scripts/build-side-chat-experiment.mjs --runtime <approved-runtime> --compiler <prepared-compiler> --output <new-experiment>
npm pack ./packages/dsh-side-chat --pack-destination <local-tarballs>
node scripts/assemble-side-chat-experiment.mjs --base-product <normal-product> --experiment <experiment> --compiler <prepared-compiler> --tarball <local-tarball> --output <new-product>
node packages/dsh-side-chat/scripts/browser-test.mjs --product <experimental-product> --output <new-web-evidence>
node packages/dsh-side-chat/scripts/browser-test.mjs --product <candidate>/resources/product --desktop <candidate>/EduWork-Electron.exe --output <new-desktop-evidence>
```

编译器按[构建指南](../../docs/BUILD.md)准备，须匹配锁定的 DSH 源码并带 `.eduwork-build-tools.json` 回执。Windows 官方源码归档中的符号链接可能需要开发者模式或先在仓库外制作可解包的编译器归档；不得静默使用未准备的工作区。正常产品、外壳和 Windows 候选沿用对应构建脚本，实验装配保持独立目录并关闭自动更新。

浏览器和桌面脚本运行真实 Host/AgentLoop，使用确定性模型适配器和合成会话；不调用外部模型。测试数据、启动凭据、截图和回执只写入指定的仓库外证据目录。桌面模式测试实际候选可执行程序；退出时自动确认该隔离测试实例的退出提示。

产品行为见[侧边聊天提案](../../docs/proposals/side-chat/README.md)。npm 发布、默认组件锁更新与桌面发布分别处理。

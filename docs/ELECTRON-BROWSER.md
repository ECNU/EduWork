# 实验性内建浏览器

桌面壳可通过 `EDUWORK_EXPERIMENTAL_ELECTRON_BROWSER=1` 或候选包 `eduwork.desktop.json` 的 `"browserRuntime": "electron"` 启用内建浏览器。默认发行设置保持不变，Web 与未启用的桌面继续使用原浏览器。

浏览器作为 DSH 原生右侧标签，与 Studio 并列。新标签页可选择“浏览器”；浏览器工具请求可见模式时显示同一网页。切换标签、收起侧栏保留网页，关闭标签释放网页。工具栏提供后退、前进、刷新、地址输入及显式外部浏览器打开。网页视口随面板尺寸改变，不模拟手机设备。

普通 HTTP(S) 链接在当前会话的浏览器标签中打开。文件交付、媒体预览、搜索以及文档和视频渲染后端不在本改动范围内。

DSH 工具与权限检查保持原契约。Host 经认证的本机桥取得独立 CDP 连接，按会话管理网页；客户端仅获得页面元数据与受限展示命令，不获得 CDP 凭证。网页使用沙箱、隔离上下文，不启用 Node 或应用预加载脚本，不开放系统权限及下载。

## 开发验证

```sh
node --test dsh-electron/tests/browser-panel.test.mjs dsh-electron/tests/browser-protocol.test.mjs dsh-electron/tests/browser-runtime.test.mjs dsh-electron/tests/native-vault.test.mjs
pwsh -NoProfile -File dsh-plugins/client-ui-browser/build-client.ps1 -Upstream <锁定的DSH编译目录> -DshLockPath third_party/dsh/release-v0.1.5-rc.2/LOCK.json
```

`dsh-electron/tests/browser-panel.electron.cjs` 是原生 Electron 验证入口：在独立 Electron 测试壳中设置 `TEST_SOURCE` 为此仓库、`TEST_RUNTIME` 为已装配的 DSH 目录、`TEST_OUTPUT` 为新的输出目录。它使用合成页面验证真实浏览器工具、后台/可见切换、会话隔离、关闭重开和视口变化；不访问用户配置或调用真实模型。可选 `TEST_MEDIA` 指向包含合成 `synthetic-report.pdf` 的目录以验证 PDF。它不替代完整安装包与 Windows 界面验收。

# 桌面通知

[English](DESKTOP_NOTIFICATIONS_EN.md)

Electron 客户端在后台运行时，可以通过系统通知提醒用户处理需求确认、授权、任务结束和 Studio 成果。点击通知或托盘中的条目会返回相应会话；授权和回答仍在应用内完成。

## 提醒范围

| 事件 | 行为 |
| --- | --- |
| 需要补充信息、审核计划、授权操作 | 提示用户返回应用；回答、拒绝或取消后清除对应待处理条目 |
| 主会话本轮完成 | 提示完成；正在前台查看该会话时直接视为已读 |
| 本轮最终失败、受阻、输出达到上限 | 提示需要处理；不把失败或主动取消显示为完成 |
| Studio 成果完成或失败 | 独立提醒；等待同一轮修改结束，忽略中间尝试 |

单个工具、子代理、流式片段、自动重试和正常令牌刷新不弹通知。应用在前台时保持安静，其他会话的事项留在托盘。多个事件会合并并限频；不因重连重放历史通知。

托盘显示待查看数量与事项菜单。关闭系统弹窗不代表完成确认或授权。已解决的请求自动移除；查看会话或对应 Studio 成果后清除完成提醒。点击已失效的通知不会重新提出请求，也不会执行旧的授权。

## 设置

“设置 → 通用设置 → 桌面通知”提供总开关、提醒类别、声音与标题预览。个人选择即时保存；配置文件提供初始默认值，已保存的界面偏好优先。

`eduwork.jsonc` 的完整默认项如下；默认静音并关闭标题预览，不发送回答正文、命令、文件内容或令牌：

```jsonc
{
  "schemaVersion": 1,
  "desktop": {
    "closeAction": "tray",
    "notifications": {
      "enabled": true,   // 允许后台系统弹窗；关闭后仍可从托盘查看
      "attention": true, // 需求确认、计划审核和授权
      "completed": true, // 主会话本轮完成
      "failed": true,    // 最终失败、受阻、输出上限
      "studio": true,    // Studio 成果完成
      "sound": false,    // 允许系统通知声音
      "preview": false   // 仅预览会话或成果标题，不包含正文
    }
  }
}
```

关闭窗口后驻留托盘才能继续执行与提醒；从托盘退出程序、系统注销或关机后不再通知。待查看列表保存在当前进程内，重启不会重放上一轮弹窗。此功能不依赖推送服务器。

## Windows 与 macOS

共用事件状态与设置，系统展示分别适配。Windows 使用已有托盘的 `displayBalloon`，不为通知安装开始菜单快捷方式或修改注册表。macOS 使用 Electron `Notification`，托盘菜单显示相同事项，菜单栏还显示数量。

Windows 通知来源与应用品牌共用 `product.name`，未设置时使用发行包的产品名称。受 Windows 应用标识限制，来源名称中的空白会被移除，最长 128 个字符；应用内仍显示完整品牌名称。发行标识、用户数据路径和 macOS bundle ID 不受影响。

系统可以因通知权限、勿扰模式或平台限制而隐藏弹窗。应用不会用自绘弹窗绕过这些控制，托盘待处理状态仍保留。API 调用成功不等于用户已看到通知；macOS 的签名、通知权限及实际发行包行为需要原生验收。

Studio 的精确成果定位及“已查看”反馈需要包含本次导航扩展的 Studio 客户端。发布桌面版本前，先按[包发布流程](PACKAGES.md)发布并锁定该插件；源码改动不会自动替换既有 npm 锁。

## 开发与验证

Host 观察 DSH 的实时会话事件与需求确认的生命周期，通过只允许结构化通知数据的带鉴权本地桥同步到 Electron。通知点击在 Host 重新核对条目，客户端调用公开会话和右栏导航接口。不会向渲染进程泄露桥凭据，也不提供执行命令或接受授权的通知接口。

基础检查：

```sh
node --test dsh-electron/tests/task-notifications.test.mjs dsh-electron/tests/native-vault.test.mjs
```

实际 Runtime 集成测试位于 `dsh-plugins/desktop-services/test/attention-host.test.mjs`，设置 `EDUWORK_TEST_RUNTIME` 为已验证 Runtime 的 `d` 目录后运行。界面验证脚本 `dsh-plugins/workbench-native/test/notifications-browser.mjs` 还需要 `EDUWORK_TEST_BUILD_TOOLS` 与 `EDUWORK_TEST_EVIDENCE`，分别指向锁定编译器和独立输出目录。

原生验收还应覆盖：后台/最小化/关闭到托盘、前台不同会话、系统勿扰、通知权限关闭、多项待处理、处理后点击历史通知、重启恢复、Studio 已打开和切换标签。两平台分别在实际发行包中验收；浏览器测试不代替原生通知验收。

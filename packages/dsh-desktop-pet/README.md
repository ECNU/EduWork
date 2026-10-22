# 桌面宠物

[English](README_EN.md)

`@eduwork/dsh-desktop-pet` 是独立维护、独立版本的 DSH 桌宠插件。内置小页（红、蓝）、大肥鱼和小花狮，提供形象选择、大小、状态气泡和空闲打盹。它与托盘、系统通知共用宿主的事项数据；点击桌宠可打开需要处理或已完成的会话。

![小页](skins/eduwork-page/idle.svg)

## 使用

EduWork 桌面客户端随包提供插件，在“设置 → 桌面宠物”中开启即可，默认关闭。现有用户的开关、形象、大小和位置保持原有存储方式，拆分不会重置这些设置。

其他发行版可安装这个 npm 包并集成到兼容的桌面宿主：

```sh
npm install @eduwork/dsh-desktop-pet
```

**宿主要求：兼容的 DSH 0.2 API 与 EduWork Electron 桌面桥接。** 插件包含设置、动画和形象；透明悬浮窗口、点击穿透、拖拽和位置记忆由桌面壳提供。普通 Web 页面或尚未接入该桥接的 DSH 客户端，安装包本身不会获得桌面悬浮窗口能力。

使用方法和形象说明见[桌面宠物指南](https://github.com/ecnu/EduWork/blob/main/docs/DESKTOP_PET.md)。代码为 MIT；各款美术素材的来源与许可见 [skins/LICENSE](skins/LICENSE)。

## 宿主集成

- Host 注册 Cordis 服务 `desktopServices`，提供 `pet(request)`；这是运行时注入的服务，不是插件需要从 npm 下载的依赖。
- 将包的 bundle 加入 DSH 组合。它使用稳定入口 `eduwork-desktop-pet`，默认 `enabled: false`；已有 EduWork 产品配置会插入同一入口，无需重复添加。
- 桌面壳从安装后的包加载 `lib/page/` 和 `skins/`，继续使用原有通知事项及打开会话回调。设置页的“隐藏/显示”与壳菜单通过现有事件接线。
- 普通托盘和系统通知独立于桌宠开关，授权操作仍在应用内完成。
- 支持[插件通知协议](https://github.com/ECNU/EduWork/blob/main/docs/PLUGIN_NOTIFICATIONS.md)的通用提醒性质、待办状态和标签；业务插件通过通知服务接入，不直接控制桌宠。需要配套支持协议 1 的桌面壳。

服务接受两种请求：

```js
{ action: 'configure', enabled, skin, frame, size, bubbles, sleep }
{ action: 'reset-position' }
```

返回对象包含 `supported`；宿主不支持时返回 `{ supported: false }`。插件停用会发送关闭请求。接口实现与窗口约束见 [desktop-services](https://github.com/ecnu/EduWork/blob/main/dsh-plugins/desktop-services/lib/index.js) 和 [Electron 桌宠窗口](https://github.com/ecnu/EduWork/blob/main/dsh-electron/src/desktop-pet.mjs)。

## 开发

在本包目录运行：

```sh
npm ci
npm run check
npm pack --ignore-scripts
```

构建仅生成设置页 `lib/client.js`，Host 模块与形象随包提供。测试默认使用本包锁定的真实 DSH 依赖；设置 `EDUWORK_TEST_RUNTIME` 为产品的 `d` 目录可检查装配后的 Runtime。

小页和小花狮由 `scripts/build-page-skins.mjs` 与 `scripts/build-huashi-skin.mjs` 生成；修改脚本后执行 `npm run build:skins`。大肥鱼使用 whale-girl 的 PNG 立绘。新形象通过 PR 内置，不提供形象包导入功能。

[包维护与发布](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES.md) · [变更记录](CHANGELOG.md) · [代码许可](LICENSE)

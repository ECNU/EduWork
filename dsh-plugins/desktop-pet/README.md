# 桌面宠物

[English](README_EN.md)

EduWork 桌面客户端的桌宠插件：在桌面上显示一只随会话状态变化的小宠物，点击它打开需要处理或已完成的会话。使用方法、状态说明和形象包格式见[桌面宠物](../../docs/DESKTOP_PET.md)。

![小页](skins/eduwork-page/idle.svg)

## 组成

- **Host 部分**（`lib/index.js`）：服务名 `desktopPet`，依赖 `desktop-services`。保存开关、形象、大小、气泡和打盹五项设置（`eduwork.jsonc` 的 `desktop.pet` 提供默认值，设置页保存的选择优先）；严格校验内置形象；设置变化时经 `desktopServices.pet()` 通知桌面壳，插件停用时让桌宠关闭。Remote 方法 `status()` 返回是否支持和形象列表（含预览图），`resetPosition()` 把桌宠移回默认位置。
- **共用模块**：`lib/skin.js` 校验清单并把三种动画写法统一成帧列表；`lib/pet-state.js` 决定状态优先级、动作节奏和帧时间。两者 Host 和桌宠页面都用，不依赖 Node 或 DOM，时间和随机数由调用方传入。
- **桌宠页面**（`lib/page/`）：由桌面壳在独立的沙箱窗口里加载，播放形象、判断显示状态、按像素判断点击。
- **设置页**（`src/client.js`）：注册 `settings.section` 页面“桌面宠物”。
- **内置形象**（`skins/`）：小页（红、蓝）、大肥鱼、小花狮，来源与许可见[桌面宠物](../../docs/DESKTOP_PET.md#形象包)。

窗口本身（透明置顶、点击穿透、拖拽、收边、位置记忆）属于 Electron 壳，见 `dsh-electron/src/desktop-pet.mjs`。插件只由 Electron 桌面产品插入；其他环境没有可用的桌面壳时，设置页显示“不支持”。

## 修改内置形象

小页和小花狮由脚本生成，编辑 `scripts/build-page-skins.mjs` 或 `scripts/build-huashi-skin.mjs` 后运行：

```sh
npm run build:skins
```

测试会核对这两款形象的文件与生成结果完全一致，所以不要直接改它们的 SVG。大肥鱼使用 whale-girl 的 PNG 立绘，来源见 `skins/LICENSE`。

## 验证

```sh
node --test test/*.test.mjs
```

`test/host.test.mjs` 需要把 `EDUWORK_TEST_RUNTIME` 设为已验证 Runtime 的 `d` 目录，其余测试不需要 Runtime。

## 许可

代码使用 MIT 许可证（见 [LICENSE](LICENSE)）。各款形象的美术许可与署名见 [skins/LICENSE](skins/LICENSE)。

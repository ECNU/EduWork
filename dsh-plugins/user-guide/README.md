# 使用教程与新手引导

[English](README_EN.md)

随包提供离线可读的使用教程，并在首次进入工作台时播放一次新手引导。

## 使用教程

宿主在应用内地址 `/eduwork-user-guide/` 提供 `guide/` 目录里的静态页面。桌面外壳探测到这个地址后，在「应用」菜单（macOS 为应用菜单）显示「使用教程」，教程在应用内的面板中打开；按 Esc、点关闭按钮或点面板外侧关闭。发行版提供账户菜单服务（`accountMenuEntries`）时，账户菜单里也会出现同一入口；没有这个服务时不显示，也不影响加载。

- 页面使用系统字体，不运行脚本、不加载网络资源；外部链接在系统浏览器打开。
- 只提供 `guide/` 内的 HTML、CSS 与图片，拒绝 `..`、隐藏文件和未知类型，响应带 `nosniff` 与 `default-src 'none'` 的 CSP。
- 面板打开时带上 `?theme=light|dark`（取自应用的深浅色设置），服务端写入 `<html data-theme>`。

## 新手引导

首次进入工作台后自动播放一次：插件设置已加载、输入框已出现，且没有其他模态窗口（如上游欢迎说明、登录窗口）时才开始。遮罩挖亮目标区域，卡片优先放在目标右侧，其次下方、上方、左侧；← → 切换，Esc 跳过。看完或跳过都把 `tourSeen` 写入设置（volatile，按条目 id 保存到 `cordis.patch.yml`），之后不再自动出现；教程面板右上角「重新播放引导」可重看。插件卸载时收起引导，不记为已看过。

内置 8 步：欢迎、新会话、工作区、输入框、权限与模型、技能与插件、文件栏、使用教程。DSH 的样式类名随构建变化，目标按无障碍标签和按钮文字查找，中英文界面都覆盖；找不到目标的步骤把卡片放在屏幕中央并整体压暗。DSH 升级后请在测试包上走一遍引导，确认每一步都挖亮了正确位置。

与 `brand-settings-native` 写入 `ui-onboarding` 的上游欢迎说明并存：欢迎说明打开期间引导等待，关闭后再开始。

## 发行版配置

插件条目 `eduwork-user-guide` 的配置：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `productName` | `EduWork` | 面板标题与引导文案中的产品名（文案里的 `{product}`） |
| `autoStart` | `true` | 为 `false` 时不自动播放，仍可从教程面板重看 |
| `steps` | `[]` | 非空时按顺序替换内置步骤，见下 |

`steps` 每项为 `{ id, title: { zh, en }, body: { zh, en }, selector }`。`id` 与内置步骤相同时沿用其目标和文案，只覆盖给出的字段；新 `id` 必须给出标题与正文，`selector` 为要挖亮元素的 CSS 选择器，省略时居中显示。无效条目被跳过，全部无效时回到内置步骤。最后一步始终提供「打开使用教程」。

```json
{ "id": "eduwork-user-guide", "config": { "productName": "示例助手", "steps": [
  { "id": "welcome" }, { "id": "new-session" }, { "id": "composer" },
  { "id": "quota", "title": { "zh": "用量", "en": "Usage" }, "body": { "zh": "在这里查看剩余用量。", "en": "Check remaining usage here." }, "selector": "[data-example-usage]" },
  { "id": "guide" }
] } }
```

## 更新教程

直接编辑 `guide/index.html`，随下一版客户端发布。截图放在 `guide/images/`，以相对路径引用；请先遮挡个人信息，宽度 2000 像素左右、WebP 格式，单张控制在 200 KB 以内。

## 开发

`lib/client.js` 由 `src/client.ts` 生成并提交，产品装配时由 `prepare-pinned-dsh-product.mjs` 按固定设置重新编译。测试：`node --test test/*.test.mjs`。

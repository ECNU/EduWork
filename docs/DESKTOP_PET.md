# 桌面宠物

[English](DESKTOP_PET_EN.md)

Electron 客户端可以在桌面上显示一只小宠物。它随会话状态变化：会话进行中会思考，完成或需要你处理时头上出现标记，点击它打开对应会话。桌宠和[桌面通知](DESKTOP_NOTIFICATIONS.md)使用同一份事项数据，只是多了一个展示入口；授权和回答仍在应用内完成。

公版默认关闭，在“设置 → 桌面宠物”中开启。内置四款形象：纸页精灵“小页”（红、蓝两种配色）、DeepSeek 社区二创的鲸鱼娘“大肥鱼”和华东师范大学吉祥物“小花狮”。所有形象共用同一套窗口、状态、动画播放和点击逻辑，切换形象后行为不变。

## 状态

桌宠只是又一个展示渠道：需要你、出错、完成待查看三种状态直接取自[桌面通知](DESKTOP_NOTIFICATIONS.md)的待处理条目，判断条件与托盘、系统通知完全相同，开关桌宠不改变通知行为。多个会话同时有事项时，按下表从上到下取第一项：

| 状态 | 条件 | 样子 | 单击 |
| --- | --- | --- | --- |
| 需要你 | 有待回答的问题或待授权的操作 | 举手张望，头上蓝色“?” | 打开对应会话 |
| 出错 | 本轮失败、受阻或输出达到上限 | 沮丧一小会儿，之后平静，红色“!”留到查看 | 打开对应会话 |
| 完成待查看 | 主会话本轮完成或 Studio 成果完成，你还没在前台看过 | 庆祝几秒，头上“!”，多项时显示数量 | 打开对应会话；Studio 成果直接定位到成果页 |
| 工作中 | 有主会话正在运行，或有 Studio 成果正在生成 | 以思考为主，不时埋头写字 | 小反应，气泡显示进行中的会话数 |
| 打盹 | 你离开电脑（系统空闲 5 分钟或锁屏），或 10 分钟没有任何变化 | 坐着睡觉，动画暂停 | 醒来 |
| 待机 | 其余情况 | 大部分时间不动，偶尔眨眼、翘一下折角或挥手 | 小反应 |

- 正在前台查看的会话完成时，桌宠只庆祝几秒，不留“!”。“!”的消失时机与托盘相同：在前台打开该会话，或从桌宠、托盘、系统通知点开它。
- 一轮结束后 3 秒内又开始下一轮时（例如目标模式连续多轮），桌宠保持工作中，不会闪回待机。单个工具的结束不改变桌宠状态。
- 气泡默认只显示通用文字。只有在“通用 → 桌面通知”中打开“显示会话与成果标题”后，气泡才显示会话标题。

## 操作

- **拖动**：按住桌宠移动，可以拖到任意显示器。松手后桌宠收回该显示器的可用区域内，不会留在屏幕外或盖住菜单栏、任务栏，但可以紧贴它们；贴在屏幕顶部时气泡改到桌宠下方。
- **收边**：拖过屏幕左右外侧边缘时，桌宠收进去，只露出一部分。收边时单击：有“!”或“?”就打开会话，否则把桌宠拉回屏幕内。
- **右键菜单**：打开应用、新建会话、待查看事项、隐藏桌宠、桌宠设置。“桌宠设置”直接打开“设置 → 桌面宠物”。
- **隐藏**：托盘菜单和右键菜单里的“隐藏桌宠”等同于关掉设置里的开关，设置页同步显示；从托盘选“显示桌宠”重新打开。
- 单击、拖动桌宠都不会抢走当前应用的焦点。桌宠以外的透明区域可以直接点到下面的窗口。通过远程桌面操作 Mac 时的例外见下文“已知问题”。
- 位置按显示器记住。显示器拔出、分辨率或缩放变化后，桌宠回到可用区域内；找不到原显示器时回到主显示器右下角。设置里的“重置位置”也会回到这里。

## 设置

“设置 → 桌面宠物”提供：显示开关、重置位置、形象、大小（50%–200%）、状态气泡、空闲打盹。选择即时生效。

`eduwork.jsonc` 中的 `desktop.pet` 提供默认值，设置页里保存的个人选择优先：

```jsonc
{
  "schemaVersion": 1,
  "desktop": {
    "pet": {
      "enabled": false,         // 公版默认关闭
      "skin": "eduwork-page",   // 内置：eduwork-page、eduwork-page-blue、dafeiyu、ecnu-huashi
      "size": 100,              // 大小百分比，50–200，10 的倍数；100 约 128 像素高
      "bubbles": true,          // 状态变化时显示简短气泡
      "sleep": true             // 离开或长时间没有活动时打盹
    }
  }
}
```

桌宠不保存账号或模型密钥，也不访问网络。

## 组成

| 部分 | 位置 | 负责 |
| --- | --- | --- |
| 桌宠窗口 | `dsh-electron/src/desktop-pet.mjs` | 透明、置顶、不可聚焦的小窗口；点击穿透、拖拽、收边、位置记忆、右键菜单、离开检测 |
| 桌宠插件 | [`packages/dsh-desktop-pet`](../packages/dsh-desktop-pet/README.md) | 设置、内置形象与校验、桌宠页面（状态与动画）、设置页 |
| 会话状态 | `dsh-plugins/desktop-services` | 现有通知同步，另外只读地附带正在运行的会话列表；通知条目的产生规则不变 |

- Host 中的桌宠插件经 `desktop-services` 的带鉴权本地桥把设置发给桌面壳，自己拿不到桥凭据。
- 桌宠页面来自产品自带的插件目录，运行在独立的沙箱会话里，只能通过固定的预加载接口与桌面壳通信。桌面壳只向它提供页面文件和当前形象目录，其他文件一律拒绝。
- 页面只拿到事项类型、数量和点击用的条目键，不拿会话 ID；会话标题只在打开标题预览时提供。
- 只在 Electron 桌面客户端插入此插件，网页版不受影响。

## 形象包

形象包只含数据：清单 `skin.json` 和图片，不含脚本或样式。图片可以是 SVG、PNG 或 WebP；内置形象用 SVG，放大后依然清晰。

```jsonc
{
  "schemaVersion": 1,
  "id": "eduwork-page",
  "name": { "zh-CN": "小页", "en": "Page" },
  "author": "EduWork contributors",
  "license": "CC-BY-4.0",
  "frame": { "width": 192, "height": 208 },   // 画布尺寸
  "anchors": { "badge": [150, 36] },          // 角标位置（画布坐标）
  "animations": {
    "idle":   { "frames": ["idle.svg", "blink.svg"], "fps": 7, "playback": "blink" },
    "think":  { "image": "think.svg" },
    "drag":   { "image": "drag.svg", "motion": "dangle" },
    "react":  { "frames": ["react-1.svg", "react-2.svg", "react-3.svg"], "playback": "once", "frameMs": [140, 260, 700] },
    "work":   { "sheet": "work.png", "frames": 8, "columns": 4, "fps": 10 }
  },
  "states": { "working": ["think", "work"] },
  "lines": { "done": { "zh-CN": ["写好啦，点我看看！"], "en": ["All done! Click me."] } }
}
```

- 动画有三种写法，加载时统一成帧列表：帧序列 `frames`、精灵图 `sheet`（按 `columns` 换行，`row` 指定起始行）、单张图 `image` 加内置动效 `motion`（`float`、`hop`、`dangle`、`breathe`、`sway`、`shake`）。
- 播放方式 `playback`：`loop`（默认）、`once`（停在末帧）、`pingpong`、`blink`（平时停在第 0 帧，随机播一遍其余帧）。`repeat` 限定插入动作的循环次数；`frameMs` 可以给每帧单独指定时长。
- 用到的动画名：`idle`、`think`、`work`、`attention`、`done`、`failed`、`sleep`、`drag`、`react`、`peek`（收边）、`greet`。只有 `idle` 必填，缺少的按回退链取，例如 `done → react → idle`；内置形象必须全部提供。`states` 的第一项是常态，其余随机插入。
- 素材约定：第 0 帧是静止姿势；各动画脚底对齐、角色占画面比例一致；角色朝左，向右拖动时自动镜像。
- 安全：SVG 必须有 `viewBox`，不能含脚本、`foreignObject`、事件属性、DOCTYPE 或指向文件外部的引用；PNG 和 WebP 按文件头核对类型，单张不超过 4096×4096。整包不超过 20 MB，单段动画不超过 64 帧、30 fps。文字只按纯文本显示。

内置形象位于 `packages/dsh-desktop-pet/skins/`，每款一个目录，许可与署名见 [`skins/LICENSE`](../packages/dsh-desktop-pet/skins/LICENSE)：

| 形象 | ID | 来源 | 许可 |
| --- | --- | --- | --- |
| 小页（红、蓝） | `eduwork-page`、`eduwork-page-blue` | EduWork contributors，`scripts/build-page-skins.mjs` 生成 | CC BY 4.0 |
| 大肥鱼 | `dafeiyu` | 角色由 ZipZipPipe 创作；使用 [whale-girl](https://github.com/vlln/whale-girl) 的 PNG 动作立绘，每段动画一张精灵图 | MIT |
| 小花狮 | `ecnu-huashi` | 早期原型及素材整理由 xhan51 贡献（[ECNU/EduWork-ECNU#18](https://github.com/ECNU/EduWork-ECNU/pull/18)）；本次由 JunieXD 重绘 SVG 并接入公共桌宠底座，`scripts/build-huashi-skin.mjs` 生成 | 形象及校徽版权归华东师范大学 |

形象由贡献者通过 Pull Request 添加和维护，应用内不提供导入。添加一款形象：在 `skins/<id>/` 放入 `skin.json` 和图片，提供上面列出的全部动画；在 `skins/LICENSE` 写明来源、署名和许可；更新插件测试里的形象列表。内置形象按严格模式校验，缺动画或图片不合规时该形象不会出现。

## 平台说明

- macOS：使用 panel 窗口，可以显示在其他应用的全屏空间上方，层级在 Dock 之下。Electron 44 在 macOS 27 上点击 panel 会激活整个应用（[electron#53889](https://github.com/electron/electron/issues/53889)），组装时编译的 `prevent-activation.node` 在窗口显示前关闭这一行为；Electron 修复发布后删除。
- Windows：置顶在任务栏之上，并定时重新置顶，避免被其他置顶窗口挡住。
- 两端都用“鼠标转发 + 主进程读取光标”判断是否点在桌宠上：光标靠近桌宠时每 50 ms 读一次，否则每 0.5 秒一次。
- 页面只有一个动画时钟，待机时大部分时间停在一帧；你离开或锁屏时动画暂停。遵循系统的“减少动态效果”设置。

## 已知问题

- **macOS：通过远程桌面操作时，按下桌宠会把 EduWork 切到前台。** 用 UU 远程这类工具控制 Mac 时，远程送来的点击在 macOS 27.0.1 上会让系统直接激活被点窗口所属的应用；上面的 `prevent-activation.node` 拦不住，AppKit 原生的非激活面板也一样。在 Mac 上直接用鼠标或触控板操作时没有这个问题。
- **Windows 触屏：第一次点按桌宠会落到下面的窗口。** 桌宠窗口平时让点击穿过，指针移到桌宠上之后才开始接收点击；触屏点按之前没有指针悬停，所以第一次点按会穿过桌宠，点到它下面的窗口。指针随之停在桌宠上，之后在同一位置点按就正常。用鼠标操作不受影响。

## 开发与验证

```sh
node --test packages/dsh-desktop-pet/test/*.test.mjs dsh-electron/tests/desktop-pet-core.test.mjs dsh-electron/tests/task-notifications.test.mjs
```

- `packages/dsh-desktop-pet/test/host.test.mjs` 默认使用包内锁定的开发依赖；可把 `EDUWORK_TEST_RUNTIME` 设为已验证 Runtime 的 `d` 目录来验证产品装配。
- 真实 Electron 检查（窗口属性、文件访问范围、IPC 来源、隐藏与关闭后的进程）：`EDUWORK_TEST_EVIDENCE=<新目录> <Electron 可执行文件> dsh-electron/tests/desktop-pet.electron.mjs`。
- 点击穿透、不抢焦点、全屏空间、真实鼠标拖拽与收边、多显示器、长时间空闲耗电需要在两个平台的发行包上原生验收。

# 对话成果与媒体预览

[English](README_EN.md)

基于官方成果组件提供兼容适配，保留实际成功写入文件的来源和规范路径，不从模型回复正文猜测成果。支持展开结果、区分同名文件、摘要与行内文件链接。

DSH 0.2 桌面构建使用 `src/client/native.js`：附件接入、成果卡片和通用文件预览由官方组件负责，此入口补充音视频播放及预览布局稳定性处理。下文的旧版卡片与附件适配仅供旧宿主兼容使用。

## 预览与附件

支持鼠标、键盘打开，文件定位与路径复制；详情侧栏可调整宽度，并复用会话标签。预览包括 PDF、隔离 HTML、Office、Markdown 源码与渲染结果、图片及音频卡片。

输入框「＋」将文件选择、粘贴和拖入合为一个入口，保存到工作区后使用结构化 `@file` 引用。Wails 通过 WebView2 `postMessageWithAdditionalObjects` 的一次性文件授权直传，不在 DSH 页面加载 Wails runtime，也不通过 JSON 搬运二进制；Web 兼容上传限制为 4 MiB。图片继续使用官方 `intakeImages`。

音视频扩展只读取所属会话工作区内的普通文件；官方文档预览由官方文件服务检查读取权限。不支持的格式交给宿主打开。`write`、`edit` 和会修改文件的 `str_replace_editor` 调用使用官方参数推导确定实际路径；产品工具通过 DSH `presentCall` 声明成果，只展示运行时可验证的文件。

## 官方文档预览

DSH 0.2 使用官方文档查看器：Word、PowerPoint 转为 PDF 查看，表格使用官方表格视图，PDF、图片、HTML、Markdown 和文本继续由官方处理。Studio 已保存的 Office 成果通过「打开文件预览」进入同一文件标签页，生成、下载和交互式成果仍由 Studio 提供。旧宿主保留 Artifact Services 的 Office 预览兼容实现；不改变 PDF/HTML 导出行为。

官方预览区域为占用宽度的滚动条预留稳定空间，避免窗口临界尺寸下反复触发自动缩放；仍支持适应宽度和手动缩放。

## 构建

`build-client.ps1` 接收 `-DshLockPath`、`-ArtifactServices` 和 `-Output`，在派生装配目录中构建。旧 Shared 包缺少所需导出时使用已提交的客户端兼容实现。此组件不捆绑 LibreOffice。

该模块包含面向旧 DSH 0.1.2 成果接口的兼容派生。精确来源由 `package.json` 和 [上游说明](UPSTREAM.md) 记录；不修改官方源码。

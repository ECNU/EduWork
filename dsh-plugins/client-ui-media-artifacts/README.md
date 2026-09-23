# 对话成果与媒体预览

[English](README_EN.md)

基于官方成果组件提供兼容适配，保留实际成功写入文件的来源和规范路径，不从模型回复正文猜测成果。支持展开结果、区分同名文件、摘要与行内文件链接。

0.1.7 候选构建使用 `src/client/native.js`，附件接入和成果卡片由新版官方组件负责；此入口只保留与 Studio 共用的扩展预览侧栏。下文的旧版卡片与附件兼容层继续用于默认发行内核。

## 预览与附件

支持鼠标、键盘打开，文件定位与路径复制；详情侧栏可调整宽度，并复用会话标签。预览包括 PDF、隔离 HTML、Office、Markdown 源码与渲染结果、图片及音频卡片。

输入框「＋」将文件选择、粘贴和拖入合为一个入口，保存到工作区后使用结构化 `@file` 引用。Wails 通过 WebView2 `postMessageWithAdditionalObjects` 的一次性文件授权直传，不在 DSH 页面加载 Wails runtime，也不通过 JSON 搬运二进制；Web 兼容上传限制为 4 MiB。图片继续使用官方 `intakeImages`。

只预览工作区内的普通文件；不支持的格式交给宿主打开。`write`、`edit` 和会修改文件的 `str_replace_editor` 调用使用官方参数推导确定实际路径；产品工具通过 DSH `presentCall` 声明成果，只展示运行时可验证的文件。

## 共享 Office 预览

使用 Artifact Services 的 `office-preview-client`，与 Studio 共享真实文件解析、页面几何、缩放和主题控件。文档自身颜色不随界面主题改变。兼容导出保留已有展开接口；不支持的文档对象明确提示，不宣称像素级还原。

## 构建

`build-client.ps1` 接收 `-DshLockPath`、`-ArtifactServices` 和 `-Output`，在派生装配目录中构建。旧 Shared 包缺少所需导出时使用已提交的客户端兼容实现。此组件不捆绑 LibreOffice。

该模块包含面向旧 DSH 0.1.2 成果接口的兼容派生。精确来源由 `package.json` 和 [上游说明](UPSTREAM.md) 记录；不修改官方源码。

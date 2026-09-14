# 工作区成果预览

[English](README_EN.md)

为当前会话提供受工作区边界约束的预览与文件定位。支持图片、音频、PDF、文本、代码和隔离 HTML；DOCX、XLSX、PPTX 通过共享 Python 服务生成静态 HTML，在随包浏览器中预览，无需 Office 或上传文件。

文件定位会在系统文件管理器中选中目标。Host 按会话工作区校验路径，不接受客户端任意指定根目录。

桌面装配通过 DSH `SessionController` 的原生文件打开扩展点，让官方成果菜单与本模块的“定位”共用 Windows Explorer 实现。保留官方会话接口和默认应用打开行为；Windows 使用带引号的本地路径，并等待 Explorer 完成请求交接，支持中文、空格和逗号文件名。macOS 和 Linux 的官方成果菜单保持上游实现。

原生回归验证可设置 `EDUWORK_TEST_PRODUCT` 为已装配客户端的 `resources/product`，`DSH_HOST_SOURCE` 为锁定的 DSH 源码目录，再在仓库根目录运行 `node --test dsh-host/test/native-reveal.integration.test.mjs`。测试经真实 Host RPC 打开临时文件夹、核验选中文件后关闭该测试窗口；普通 CI 不运行这项桌面交互验证。

## 附件导入

选择、粘贴或拖入的文件以不覆盖现有文件的名称保存到工作区 `.chatecnu/attachments/`。接口返回相对路径，供 DSH 使用 `@file` 引用；二进制内容不会写入会话历史或模型消息。

Wails 通过私有桥提供一次性原生文件授权，直接复制系统文件，不把大文件编码到 JSON。每个文件上限 64 MiB，每批最多 20 个、合计 128 MiB；这是文件 I/O 限制，不是模型上下文上限。Web 的兼容 Base64 上传入口仍限制为 4 MiB。

无效授权、非法 Base64、越界路径与符号链接会被拒绝。

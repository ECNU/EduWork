# 通用媒体适配器

[English](README_EN.md)

将配置中的 OpenAI 兼容图像和 TTS 服务注册到 `@eduwork/dsh-artifact-services`。不另设工具、技能或 Studio 预览。模型、音色、尺寸和服务地址来自用户或发行配置，不包含学校默认值。

配置和请求契约见公版 [MEDIA 指南](../../docs/MEDIA.md)。本目录作为公版随包插件装配，不需要另发 npm 包。外部独立组件继续使用精确的已发布 npm 锁。

`lib/config.js` 是 Host、Web 与插件共用的配置解释器。桌面构建将同一源文件复制为 `media-config.mjs`，两种壳不维护第二份校验代码。

图像与语音生成必须经过共享 Tool 的权限入口；Studio 直接请求会转入相同 Tool，保留取消信号和父调用上下文。企业模式通过共享 Host 校验发现的 API 地址并使用登录 Token 授权，复用刷新与注销隔离；不读取旧模型 Key。结果下载不附带登录 Token。输出保存在工作区 `.eduwork/generated/`；后处理失败仍保留原图。

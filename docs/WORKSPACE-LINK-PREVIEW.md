# 工作区文件和媒体预览

本地文件沿用 DSH 文件地址与右侧标签契约。PDF、图片和文本使用 DSH 文档预览；Office、音频和视频使用与 Studio 相同的 `PreviewContent`。显式系统打开、定位和下载入口保持可用。

Electron 中点击带常见音视频扩展名的 HTTP(S) 链接时，在右侧媒体标签中播放；支持 MP4、WebM、MOV、MP3、WAV、OGG、Opus、M4A、AAC、FLAC。媒体标签提供“在外部浏览器打开”，解码能力取决于 Electron 与文件本身。没有媒体扩展名的 URL 继续走原链接处理，不猜测 MIME 或访问额外地址。该功能不依赖内建浏览器插件。

预加载桥仅在可信应用主框架中提供 URL 事件和显式外部打开请求。远程网页和子框架不能使用该桥。页面重载后，直到媒体组件重新注册才接管链接。

## 聊天正文的文件链接适配

锁定的 DSH `ui-deliverables` 对已交付文件调用系统打开器。以下显式候选构建将正文中的文件点击统一交给 `owner.openFile`，由 DSH 决定右侧预览；文件卡片的显式打开菜单不变。

```sh
node scripts/build-sidebar-deliverables.mjs --upstream <锁定的DSH编译目录> --output <新的候选输出目录>
```

适配器校验锁定版本、仅修改临时编译副本，并记录原始源码、适配器和生成文件哈希。生成的 `client.js` 用于独立候选装配中 `@deepseek-ai/dsh-client-ui-deliverables` 的客户端入口，不能直接替换默认 npm 锁或发行清单。默认发行装配尚未启用此正文链接适配，需要随客户端候选完成验收后单独提升。

```sh
node --test dsh-electron/tests/external-navigation.test.mjs
pwsh -NoProfile -File dsh-plugins/client-ui-media-artifacts/build-client.ps1 -Upstream <锁定的DSH编译目录> -DshLockPath third_party/dsh/release-v0.1.5-rc.2/LOCK.json -ArtifactServices <Shared-Artifact-Services目录>
```

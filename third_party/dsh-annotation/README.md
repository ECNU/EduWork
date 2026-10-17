# dsh-annotation 可选界面补丁

[English](README_EN.md)

适用于社区插件 `@changfenhuang/dsh-annotation@1.4.11` 的 `client.js`，上游为 [omdsh-dev/dsh-annotation](https://github.com/omdsh-dev/dsh-annotation)，许可证见 [LICENSE](LICENSE)。补丁随源码保存，供本地验证和上游贡献使用；默认安装 npm 原包不会自动应用补丁。

`1.4.11-ui.patch` 修正工具条位置、消息闪动及重复实例：工具条使用自身尺寸定位在选区末端；用户消息仅对发生变化的消息行同步折叠批注，完整会话扫描与助手标签仍保留节流；清理函数接入 Cordis effect 生命周期，重复挂载会先释放旧实例，旧上下文的延迟清理不会移除新实例。

## 应用

在独立的 1.4.11 插件源码目录运行，先检查再应用（将路径替换为此补丁的绝对路径）：

```sh
git apply --check /path/to/1.4.11-ui.patch
git apply /path/to/1.4.11-ui.patch
node --check client.js
```

通过官方插件管理器将该目录作为本地开发插件接入隔离 Profile，然后重载客户端。保留原包用于回退；升级插件时重新核对补丁，勿直接沿用。

## 回归测试

测试需要可解析 `playwright-core` 的 Node 环境及 Chromium 浏览器；可用 `ANNOTATION_TEST_BROWSER` 指定本机浏览器可执行文件。执行参数依次为原包目录、打补丁后的目录，以及用于解析 Playwright 的 `package.json` 路径：

```sh
node test-ui.mjs /path/to/original /path/to/patched /path/to/test-runtime/package.json
```

测试加载完整插件及合成 DSH 服务，比较选区末端与按钮的距离，并检查连续消息插入、正文稍后填入时的首帧内容。桌面产品还需验证实际选区、发送、缩放及会话历史；合成测试不替代该验收。

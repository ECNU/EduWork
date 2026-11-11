# Orca 浏览器密码模块

来源：[stablyai/orca](https://github.com/stablyai/orca)，固定提交 `42f55bfa372e0189cbc7d3e888525c3ac8ccca52`，MIT 许可。保留原始模块、测试及 LICENSE。

复用范围：表单扫描和分类、可信输入捕获、填写、登录成功判断、保存/更新决策、来源匹配、密码库格式及增删查。`src/shared/secure-storage/secure-file.ts` 是 EduWork 宿主适配：使用 npm 的 `write-file-atomic` 同步写入，Windows 沿用用户数据目录的 ACL。加密通过原有 SecretStore 接口注入 Electron safeStorage。未引入 Orca 的原生 ACL 扩展、Chromium 密码导入、React 设置页面或浏览器管理器。

安装依赖：在本目录执行 `npm ci`。测试：`npm exec vitest run`。Electron 桌面构建将运行时代码及生产依赖打包，并复制许可。使用 Node 24.22.1 或依赖声明支持的更高版本。

EduWork 的接入位于 `dsh-electron/src/browser-passwords.mjs`、`browser-passwords-preload.ts` 和 `browser-passwords-ui.cjs`。候选功能通过 `EDUWORK_BUILTIN_PASSWORDS=1` 开启；默认关闭。保存、填写和管理操作在桌面浏览器中完成。

首版提供主框架、准确 origin 匹配、用户选择填写、成功登录后保存/更新、永不保存列表及账号删除。跨域 iframe、密码生成和导入尚未接入。网页会收到用户选中的填写值；此模块不提供对拥有页面脚本或操作系统权限的 Agent 的密码隔离。

EduWork 补丁：检测器增加 disable 通道和 dispose 生命周期，用于总开关即时停止事件监听、观察器及待发送捕获；重新启用创建新的检测器。对应渠道常量及回归测试同步更新。

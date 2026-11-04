# 构建与验证 / Build and validation

需要 Node.js 24.22.1+。DSH peer 包必须与目标 Host 的 `0.2.1-rc.5` 一致。
Use Node.js 24.22.1+ and the same DSH `0.2.1-rc.5` peer packages as the target Host.

```sh
npm ci
npm run build
npm test
```

`lib/` 和 `node_modules/` 不提交。桌面插件管理器安装此目录时使用已构建的 `lib/`。
Generated files are not committed. Local desktop installation consumes the built `lib/` directory.

测试覆盖被动发现、初始化边界、超时与进程清理、环境凭据过滤，以及连接恢复失败与持久化失败。ACP 使用合成进程，不访问真实模型。
Tests exercise passive discovery, initialization boundaries, timeouts and cleanup, credential filtering, failed restoration and persistence failure. ACP fixtures do not access real models.

桌面验收需另外确认：设置可见、检测后启用、重启恢复、真实任务返回主聊天、停用阻止新任务。握手和单元测试不能替代真实模型与原生平台验收。
Separately verify Settings, check/enable, restart restoration, real task delivery to the main chat and disabling new tasks on the target desktop. Handshakes and unit tests do not replace model or native-platform acceptance.

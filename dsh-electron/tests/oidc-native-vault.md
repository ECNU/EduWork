# Electron OIDC 与系统保险库联合验收

`oidc-native-vault.electron.mjs` 是 Electron 主进程入口，不是 `node --test` 测试。需使用已经校验的原始 Electron Runtime：

```powershell
& $ElectronExecutable dsh-electron/tests/oidc-native-vault.electron.mjs `
  --product $FrozenProduct `
  --adapter $PreparedHostProcessModule `
  --node $BundledNodeExecutable `
  --evidence $EvidenceDirectory
```

每次运行在证据目录中创建独立 `run-*`，不连接现有 CDP，不使用已有用户目录，也不重启其他桌面进程。测试只读使用传入的冻结产品，临时 Profile 链接到该产品；不会复制或修改产品 Runtime。测试完成后只清理本次合成身份配置和保险库文件，保留脱敏结果与运行目录便于排查。分享时仅需要 `result.json`。

实际运行链为 Electron `safeStorage` → 产品 `EncryptedVault` / native bridge → `credentials-native` → 官方 DesktopHostProcess → OIDC desktop → localhost IdP。0.1.5 使用协议 3 字节管道，0.1.7-rc.1 候选使用经过认证的本地 HTTP 传输。存储和加密均为真实实现，IdP 使用本次生成的 RSA 密钥签名并核对 PKCE。

验收覆盖：

1. 真实 Electron 加密能力与官方 Host 启动。
2. 一次机构登录及临近过期的主动刷新，自动获得模型 Key 和模型目录；测试等待合成 Token 的刷新时间，并确认尚未过期后再发起请求。即使服务端声明配额能力，公版 OIDC 也不查询或返回配额。
3. 保险库磁盘字节无合成凭据明文；RPC 描述不返回秘密。
4. 授权资源返回一次 401 后，旋转刷新令牌并且只重试一次。
5. Host 重启后从系统加密存储恢复身份，无需重新登录。
6. 全新目录没有前一目录的机构身份或个人 Key；错误 native bridge 凭据和浏览器 Origin 被拒绝。
7. 注销撤销机构令牌并移除机构身份/托管 Key，个人 Key 保留。

回执记录每次 Host 就绪耗时，并检查重启与最终退出的子进程退出码为 0，避免把管道重复关闭导致的异常退出算作通过。首次装配后的冷启动可能比后续启动慢；超时须保留失败证据、单独检查实际桌面启动，不因重试成功而覆盖首轮记录。

外部浏览器的授权导航由严格限制到该 localhost IdP 的 HTTP fixture 完成，以免打开用户浏览器。0.1.7 候选的 HTTP RPC 使用 Electron `net.fetch`，通过与渲染器相同的 Chromium 网络栈发送；回执记录所用传输。`desktopServices`、受认证 native bridge 和回调传输仍实际执行；**此测试不证明系统浏览器 UI 或真实机构 IdP 登录已通过**。桌面窗口和真实机构兼容性由产品联合验收分别记录。

测试从传入产品的 `assembly.json` 读取 DSH 版本，并核对实际 Host 报告的版本。运行回执记录本次实际组件和结果；历史单次运行记录保存在仓库外，不能作为当前组合已经通过的依据。

后台运行时为 Electron 持续重定向标准输出和错误，并记录进程 ID。每次检查前会写入 `progress.json`，结束后写入 `result.json`；只看到进程启动不能视为通过。

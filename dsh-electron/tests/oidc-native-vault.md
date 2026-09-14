# Electron OIDC 与系统保险库联合验收

`oidc-native-vault.electron.mjs` 是 Electron 主进程入口，不是 `node --test` 测试。需使用已经校验的原始 Electron Runtime：

```powershell
& $ElectronExecutable dsh-electron/tests/oidc-native-vault.electron.mjs `
  --product $FrozenProduct `
  --adapter $PreparedHostProcessModule `
  --node $BundledNodeExecutable `
  --evidence $EvidenceDirectory
```

每次运行在证据目录中创建独立 `run-*`，不连接现有 CDP，不使用已有用户目录，也不重启其他桌面进程。产品只有元数据复制，插件、技能和预设以只读使用的目录链接引用；没有重新打包或修改产品 Runtime。测试完成后只清理本次合成身份配置和保险库文件，保留脱敏结果与运行目录便于排查。分享时仅需要 `result.json`。

实际运行链为 Electron `safeStorage` → 产品 `EncryptedVault` / native bridge → `credentials-native` → 官方 DesktopHostProcess / 协议 3 字节管道 → OIDC desktop → localhost IdP。存储和加密均为真实实现，IdP 使用本次生成的 RSA 密钥签名并核对 PKCE。

验收覆盖：

1. 真实 Electron 加密能力与官方 Host 启动。
2. 一次机构登录及临近过期的主动刷新，自动获得模型 Key、模型目录与配额。
3. 保险库磁盘字节无合成凭据明文；RPC 描述不返回秘密。
4. 授权资源返回一次 401 后，旋转刷新令牌并且只重试一次。
5. Host 重启后从系统加密存储恢复身份，无需重新登录。
6. 全新目录没有前一目录的机构身份或个人 Key；错误 native bridge 凭据和浏览器 Origin 被拒绝。
7. 注销撤销机构令牌并移除机构身份/托管 Key，个人 Key 保留。

回执记录每次 Host 就绪耗时，并检查重启与最终退出的子进程退出码为 0，避免把管道重复关闭导致的异常退出算作通过。首次装配后的冷启动可能比后续启动慢；超时须保留失败证据、单独检查实际桌面启动，不因重试成功而覆盖首轮记录。

外部浏览器的授权导航由严格限制到该 localhost IdP 的 HTTP fixture 完成，以免打开用户浏览器。`desktopServices`、受认证 native bridge 和回调传输仍实际执行；**此测试不证明系统浏览器 UI 或真实机构 IdP 登录已通过**。桌面窗口和真实机构兼容性由产品联合验收分别记录。

2026-09-10 基线：Electron `44.0.0`、DSH `0.1.5-alpha.1`、OIDC `0.2.0-dev.20260910.1`，Windows 真实系统加密，7/7 通过；一次授权、两次刷新、一次撤销，清理无失败。

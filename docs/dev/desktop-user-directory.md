# 桌面用户目录

## 路径边界

macOS 和 Windows Electron 公版统一使用用户主目录下的 `.config/eduwork/`；Windows 使用 Electron `app.getPath('home')`，不依赖安装位置或 shell 中的 `HOME`。机构发行版使用 `.config/<distribution>/`，Mac Alpha 使用独立的 `<distribution>-alpha` 目录；正式版仅在自身目录不存在时沿用已有 Alpha 目录。

```text
.config/eduwork/
  eduwork.jsonc             # 唯一生效的应用配置
  examples/                # 配套配置示例及用户编辑
  dsh/                     # DSH_HOME，含会话、附件、技能和全局设置
    profiles/desktop-native/ # 原生 Profile，名称不包含 Runtime 版本
    profiles/desktop/      # 旧 Runtime Profile，保留回退格式
  browser/                 # Electron 状态及加密凭据
  logs/                    # 日志与故障信息
  data/                    # 配置备份、内容更新、更新偏好和安装事务
```

`desktopPaths({ appRoot, userHome, settings, ... })` 同时返回生效路径和当前发行版的旧目录来源。

`migrateDesktopData(paths, { ownsLegacyLock })` 在首次启动时复制并校验旧用户目录，原子启用新目录且保留旧数据。

`prepareProductProfile(...)` 使用 `profiles/desktop-native`，旧 `profiles/desktop` 不参与原生 Profile 的合并。

Windows 更新器 `serve --root <安装目录> --state-dir <用户目录/data/state>` 将安装目标与用户状态分离；省略 `--state-dir` 时兼容旧调用方。

## 首次迁移

新目录存在时以新目录为准，不自动合并旧目录；新目录不存在时，从当前平台、发行版和 Alpha 选择规则确定唯一旧来源。Windows 将发行版的 `dsh/browser/logs`、安装目录的 `config` 和共享更新数据组合为新布局，不复制其他发行版的运行数据。Mac 使用旧 Application Support 目录。

启动器取得旧浏览器目录的单实例锁后再复制，防止仍运行的旧客户端写入；Chromium 的 Singleton 锁不进入快照。文件以 SHA-256 校验，复制前后再次核对源清单；不跟随符号链接，内部链接改为指向复制后的数据。全部复制到同级临时目录，再原子改名。失败时删除本次临时目录，旧目录保持完整；异常终止遗留的 `.migration-lock` 需在退出客户端后人工删除。

配置 JSONC 保留原字节，配置管理状态改为认证新的相对路径；内容更新签名与配置备份保留。待安装 ZIP 路径重定位到新下载目录，安装目标仍是原程序目录；当前运行安装位置已改变时取消旧待安装任务，保留下载并要求重新下载，防止更新另一份客户端。旧更新器发出的安装目录健康握手与新用户目录健康握手都需通过目录边界与版本校验。

旧目录作为回退副本，不再同步后续编辑。回退旧客户端只能看到迁移时的状态；不自动把新 Profile 改回旧格式。真实 macOS、Windows 的凭据解密、重启持久化和完整更新安装仍需各平台原生验收。

`EDUWORK_DESKTOP_TEST_DATA_ROOT` 同时隔离配置与全部数据；显式 `EDUWORK_CONFIG_FILE` 仅替换配置路径，不改变数据归属，调用方需为测试选择独立数据目录。

# 构建脚本迁移清单

从 PowerShell（`.ps1`）到 Node.js（`.mjs`）的跨平台迁移记录。

**简体中文** | 本文件是迁移过程的 evidence，供后续阶段（shim 化、测试迁移、CI 切换）参照。

---

## 布局约定

- 新 `.mjs` 脚本与原 `.ps1` 并排放在同一目录，文件名相同、扩展名不同
- 共享库放在 `scripts/lib/`，无对应 `.ps1`
- 一键入口 `scripts/local-desktop-pipeline.mjs` 无对应 `.ps1`

---

## 已完成移植（.ps1 → .mjs）

### scripts/

| 原 ps1 | 新 mjs | 状态 |
|---|---|---|
| `assemble-desktop-candidate.ps1` | `assemble-desktop-candidate.mjs` | ✅ 已移植 |
| `assemble-eduwork-web.ps1` | `assemble-eduwork-web.mjs` | ✅ 已移植 |
| `ci-eduwork-macos-release.ps1` | `ci-eduwork-macos-release.mjs` | ✅ 已移植 |
| `ci-eduwork-web.ps1` | `ci-eduwork-web.mjs` | ✅ 已移植 |
| `ci-eduwork-windows-release.ps1` | `ci-eduwork-windows-release.mjs` | ✅ 已移植 |
| `configure-desktop-archive.ps1` | `configure-desktop-archive.mjs` | ✅ 已移植 |
| `install-desktop-config.ps1` | `install-desktop-config.mjs` | ✅ 已移植 |
| `link-studio-web-profile.ps1` | `link-studio-web-profile.mjs` | ✅ 已移植 |
| `normalize-generated-client.ps1` | `normalize-generated-client.mjs` | ✅ 已移植 |
| `pack-windows-release.ps1` | `pack-windows-release.mjs` | ✅ 已移植 |
| `package-macos-external-config.ps1` | `package-macos-external-config.mjs` | ✅ 已移植 |
| `prepare-desktop-product.ps1` | `prepare-desktop-product.mjs` | ✅ 已移植 |
| `prepare-desktop-resources.ps1` | `prepare-desktop-resources.mjs` | ✅ 已移植 |
| `prepare-eduwork-build-tools.ps1` | `prepare-eduwork-build-tools.mjs` | ✅ 已移植 |
| `prepare-eduwork-web-runtime.ps1` | `prepare-eduwork-web-runtime.mjs` | ✅ 已移植 |
| `prepare-macos-release-inputs.ps1` | `prepare-macos-release-inputs.mjs` | ✅ 已移植 |
| `prepare-windows-release-inputs.ps1` | `prepare-windows-release-inputs.mjs` | ✅ 已移植 |
| `set-desktop-icon.ps1` | `set-desktop-icon.mjs` | ✅ 已移植（Windows-only，内部仍调用系统 PowerShell） |

### dsh-desktop/scripts/

| 原 ps1 | 新 mjs | 状态 |
|---|---|---|
| `assemble-official-host.ps1` | `assemble-official-host.mjs` | ✅ 已移植 |
| `build-official-host.ps1` | `build-official-host.mjs` | ✅ 已移植 |
| `sync-dsh-upstream.ps1` | `sync-dsh-upstream.mjs` | ✅ 已移植 |
| `test-dsh-compatibility.ps1` | `test-dsh-compatibility.mjs` | ✅ 已移植 |

### dsh-electron/scripts/

| 原 ps1 | 新 mjs | 状态 |
|---|---|---|
| `assemble-macos.ps1` | `assemble-macos.mjs` | ✅ 已移植 |
| `assemble-windows.ps1` | `assemble-windows.mjs` | ✅ 已移植 |
| `prepare-electron.ps1` | `prepare-electron.mjs` | ✅ 已移植 |
| `relocate-macos-compositor.ps1` | `relocate-macos-compositor.mjs` | ✅ 已移植 |

### dsh-plugins/\*/

| 原 ps1 | 新 mjs | 状态 |
|---|---|---|
| `activity-insights-native/build-client.ps1` | `activity-insights-native/build-client.mjs` | ✅ 已移植 |
| `client-ui-agent-preset-product/build-client.ps1` | `client-ui-agent-preset-product/build-client.mjs` | ✅ 已移植 |
| `client-ui-branding/build-client.ps1` | `client-ui-branding/build-client.mjs` | ✅ 已移植 |
| `client-ui-component-inventory/build-client.ps1` | `client-ui-component-inventory/build-client.mjs` | ✅ 已移植 |
| `client-ui-conversation-brand/build-client.ps1` | `client-ui-conversation-brand/build-client.mjs` | ✅ 已移植 |
| `client-ui-media-artifacts/build-client.ps1` | `client-ui-media-artifacts/build-client.mjs` | ✅ 已移植 |
| `client-ui-skill-live/build-client.ps1` | `client-ui-skill-live/build-client.mjs` | ✅ 已移植 |
| `workbench-native/build-client.ps1` | `workbench-native/build-client.mjs` | ✅ 已移植 |

### 新增（无对应 ps1）

| 文件 | 说明 |
|---|---|
| `scripts/local-desktop-pipeline.mjs` | 一键本地构建、安装、冒烟入口 |
| `scripts/lib/build-util.mjs` | 共享基础工具（run、copyTree、download、JSON I/O 等） |
| `scripts/lib/upstream.mjs` | 上游锁目录 + 原子锁（替代 .NET named mutex） |
| `scripts/lib/dsh-packages.mjs` | DSH 包管理共享逻辑 |
| `scripts/lib/dsh-skills.mjs` | DSH Skills 安装共享逻辑 |
| `scripts/lib/client-build.mjs` | 插件客户端构建共享逻辑 |
| `scripts/lib/zip.mjs` | 无额外依赖的 ZIP 读写（替代 System.IO.Compression） |

---

## 下一阶段待办（跟随 PR）

### 1. ps1 → 薄 shim

以下已有 `.mjs` 对应物的 ps1 改为单行转发，保持已有调用方兼容：

```powershell
#!/usr/bin/env pwsh
node (Join-Path $PSScriptRoot '<same-name>.mjs') @args
exit $LASTEXITCODE
```

适用文件（与上方"已完成"表格一一对应，共 26 个）。

### 2. 仍保留完整 ps1 的文件

以下文件**不**转 shim，保持现有 ps1 不动：

| 文件 | 原因 |
|---|---|
| `dsh-desktop/scripts/assemble-wails-bridge.ps1` | 遗留本地流程，不在主流水线 |
| `dsh-desktop/scripts/pack-wails-bridge.ps1` | 同上 |
| `dsh-desktop/scripts/test-update-compat-local.ps1` | 同上 |
| `dsh-electron/scripts/pack-migration-release.ps1` | 同上 |
| `scripts/copy-desktop-tree.ps1` | 被父 ps1 dot-source，待父脚本变 shim 后自然消亡 |
| `scripts/copy-dsh-package-payload.ps1` | 同上 |
| `scripts/install-bundled-dsh-skills.ps1` | 同上 |
| `scripts/install-locked-dsh-package.ps1` | 同上 |
| `scripts/resolve-eduwork-upstream.ps1` | 同上 |
| `scripts/with-eduwork-upstream-lock.ps1` | 同上 |
| `packages/dsh-knowledge-studio/lib/speech.ps1` | 运行时组件，不在构建流水线 |
| `packages/dsh-knowledge-studio/packages/artifact-services/lib/speech.ps1` | 同上 |
| `tests/desktop-window-icon.ps1` | 验收测试辅助，单独迁移 |

### 3. 测试迁移

以下测试当前断言 ps1 源码或经 pwsh 调用，需在 shim 化完成后同步更新：

| 测试文件 | 原因 |
|---|---|
| `tests/eduwork-assembly-policy.test.mjs` | 断言 ps1 源码文本（`#Requires`、`param(` 等） |
| `tests/eduwork-configure-archive.test.mjs` | 经 pwsh 调用 configure-desktop-archive.ps1 |
| `tests/github-update-package.test.mjs` | 经 pwsh 调用相关 ps1 |
| `tests/eduwork-profile-links.test.mjs` | 经 pwsh 调用 link-studio-web-profile.ps1 |
| `tests/eduwork-upstream-lock.test.mjs` | 经 pwsh 调用 with-eduwork-upstream-lock.ps1 |

### 4. CI 切换

`.github/workflows/desktop-candidates.yml` 当前第 55-67 行：

```yaml
shell: pwsh
# ...
$script = "./core/scripts/ci-eduwork-$($env:TARGET_PLATFORM)-release.ps1"
```

改为：

```yaml
shell: bash
# ...
node "./core/scripts/ci-eduwork-${TARGET_PLATFORM}-release.mjs"
```

---

## 工具链约定

- 构建脚本要求 **Node.js 24.18.0**（v24 才随发行版捆绑 corepack；v25+ 已移除）
- `local-desktop-pipeline.mjs` 在启动时校验 `process.version.startsWith('v24.')`
- Windows 上不使用 `.cmd` shim，通过 `nodeBundledCli()` 直接定位 `corepack.js` / `npm-cli.js`

## 本地开发调试开关

两个发行编排器（`ci-eduwork-macos-release.mjs`、`ci-eduwork-windows-release.mjs`）和一键入口都支持下列选项。**默认值保持严格**，CI 与发行路径行为不变；仅在本地开发工作树使用。

| 选项 | 默认 | 作用 |
|---|---|---|
| `--no-verify-snapshot` | 校验 | 跳过 `source-receipt.json` 快照比对 |
| `--runtime-source <dir>` | 重新安装 | 复用已准备的 DSH Runtime 目录，省去 `npm install` |

**`--no-verify-snapshot`**：默认的 `--verify-receipt` 会把工作树里每个文件的路径与 SHA-256 同 `source-receipt.json` 中冻结的 `files` 数组逐条比对。该快照绑定已审阅的提交，任何源码改动都会使其失效——包括移植期间的新增文件。移植、调试、本地联调时必然失败，因此提供该开关。

传给该开关构建出的产物**来自未提交的工作树**，三个回执都会记录 `sourceSnapshotVerified: false`。不要把它当作发行输入。

**`--runtime-source <dir>`**：装配脚本原本把 Runtime 缓存在 `<coreRoot>/dist/dsh-cache/` 下，不存在时执行 `npm install`（900 个包，约 4 分钟）。指向仓库外的已准备目录可跳过该步骤。

目标目录必须通过 `assemble-eduwork-web.mjs` 的完整校验才会被采用：`dshVersion`、`dshCommit`、`source === 'npm-lock'`、平台与架构、以及 `packageLockSHA256` 同选定锁一致。缓存不匹配会被拒绝，不会静默使用错误字节；因此跨平台或跨提交复用是安全的。

**注意**：即便使用 `--runtime-source`，装配阶段仍会在 `<coreRoot>/dist/dsh-cache/` 下投影出 `distribution-*` 目录（约 460MB）。审计脚本以目录树遍历源码快照且不读取 `.gitignore`，因此**每次运行前都需要 `rm -rf dist/`**，否则下一次运行时开头的源码审计会被自身产物绊倒。

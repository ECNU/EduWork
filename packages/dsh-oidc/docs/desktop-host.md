# 无常驻 Web 服务的桌面宿主

[English](desktop-host.en.md)

`backend: desktop` 通过临时 loopback 回调接入桌面登录，复用 Web 后端的 OIDC 校验、Host credentials、Token 刷新和模型发现。支持 web 和 desktop；旧 native 账户桥已移除。

```yaml
- id: enterprise-oidc
  name: '@eduwork/dsh-oidc'
  config:
    backend: desktop
    allowEmptyProfiles: true
    profilePathEnv: EDUWORK_OIDC_PROFILE
    desktop:
      callbackPort: 0
      flowTimeoutMs: 600000
```

宿主应注册 Cordis `desktopServices` 服务，提供 Host-only 方法：

```ts
openExternal(url: string): Promise<void>
// 可选：仅打开宿主预先确定的配置文件或示例目录。
openConfiguration(target: 'config' | 'examples'): Promise<void>
```

OIDC 从受信 Profile 对应的 Discovery 构造 HTTP(S) 授权 URL。此 URL 只交给 Host 服务；浏览器侧不能传入自选 URL。外壳负责用系统浏览器打开，拒绝非 HTTP(S)、userinfo URL，并且不得记录授权查询参数。插件不自行执行系统命令，不依赖 Electron/Wails 的 JavaScript 包。服务可以稍后加载；移除服务会取消尚未完成的登录。

发行方提供 `configFile: {path, examplesPath}` 时，企业服务保持只读，由用户编辑文件后重启应用。若宿主提供 `openConfiguration`，设置显示“打开配置文件”和“查看示例”；RPC 只接收 `config` / `examples`，由宿主解析固定路径，不允许 renderer 传路径或命令。`configuration().configFile.canOpen` 声明是否可直接打开；Web 或未提供该能力的宿主显示配置文件位置作为备用。个人 API Key 设置和已配置企业的身份登录继续可用。


宿主必须提供 `credentials.resolve/set/unset`。本插件没有明文凭据文件或存储失败后的备用路径；桌面发行方负责接入操作系统保险库。模型调用使用当前 Access Token，OAuth token 不经 RPC 返回 renderer。`oidcAccounts.authorizedFetch()` 仍是 Host-only 公共授权请求入口。

只有用户点击登录时才监听 `127.0.0.1`。默认随机端口，回调为 `http://127.0.0.1:<port>/oauth/callback`；需在身份提供方注册支持动态 loopback 端口的公共 PKCE 客户端。若身份提供方只接受精确回调端口，可在受信配置固定 `callbackPort`（端口占用时明确失败，不改用未注册端口）。不支持配置其他监听地址。取消、失效、成功、合法回调失败、服务卸载和 Host 退出均清理监听。错误路径、Host、Origin、state 或 HTTP 方法不会消费合法的待登录状态。

RPC 扩展（共用 Host/Client Typert schema）：

| 方法 | 返回 |
| --- | --- |
| `begin(profileID)` | 桌面返回 `{mode:'external', loginID, expiresAt}`；Web 仍返回 `redirect`。 |
| `loginStatus(loginID)` | `{loginID, profileID, state, expiresAt, status?, errorCode?}`。state 为 pending/completed/cancelled/expired/failed。 |
| `cancelLogin(loginID)` | 同上；等待正在写入的登录撤回，避免取消后重新出现凭据。 |
| `openConfiguration(target)` | 文件管理模式下返回 `{opened:true}`；目标仅为 `config` / `examples`。系统打开失败时返回简短提示。 |
| `selectEnterpriseModel(profileID, {onlyIfMissing?})` | DSH 0.1.5 上返回 `{changed, selection?}`，通过官方 `agentDefaultModel.saveSelection()` 保存企业默认模型。 |

客户端账号快照由登录页、侧栏和企业设置共享。宿主凭据 Provider 应在 set/unset 后按官方契约发出 `credentials/reference-updated`；客户端监听该标准 Remote 事件及 `connection/reset`，不依赖不会由官方 Remote 转发的自定义账号事件。

明确登录并连接模型后，自动选择企业目录中第一个可解析模型。还没有会话时也会保存未来会话的默认值；存在主会话时通过官方 `modelDirectories.directoryFor(sessionID).select()` 同步当前选择，不改子代理。宿主应加载官方 `agentDefaultModel` 和可写 `settings` 服务。旧宿主缺少此能力时明确提示从模型菜单选择。

升级后的首次加载使用 `onlyIfMissing:true`：已有有效默认值则保留，缺失或已不能解析才修复；当前会话中可用的个人选择也保留。凭据事件、检查连接和后续状态刷新不会切模型，个人 Key 与其他设置不受影响。

双桌面联调可运行 `node scripts/serve-desktop-oidc-fixture.mjs --config <新的测试配置文件>`。脚本只绑定本机随机端口，生成合成身份、完整 HTTP PKCE/Token/模型/配额服务及公开 JSONC 配置；配置文件必须不存在，不覆盖用户配置。每套外壳使用独立测试数据目录；用 Ctrl+C 关闭服务。服务不接触真实账号，也不消耗模型额度。

`loginID` 是独立随机句柄，不是 OAuth state。响应不包含授权 URL、code、nonce、PKCE verifier 或 token。前端以一秒间隔轮询，显示在浏览器中完成登录与取消按钮；登录最长十分钟，页面卸载取消尚未完成的尝试。关闭外部浏览器无法被跨平台可靠检测，用户可在应用中取消，或等待短时监听过期。

空 Profile 是有效配置，不会监听端口，也不要求机构登录。纯身份 Profile 不要求资源端点；登出仅移除该机构的身份/Token，个人 API Key 保留。身份登录成功后资源接口暂不可用时保留已登录身份，后续可以重试资源连接。

验证入口：`node --test test/desktop.test.js test/desktop-host.test.js`。后者可通过 `DSH_OIDC_PACKAGE_ROOT` 指向安装的冻结包目录，并设置 `DSH_OIDC_EXPECT_DSH=0.1.5-rc.1`，使用该安装目录的真实 DSH 依赖运行无 WebServer 的 Host、可选浏览器服务和 loopback PKCE 验证。所有凭据与用户均为测试合成值；产品主进程保险库、窗口和操作系统浏览器行为仍由发行方联合验收。

`.20260910.6` 的公共侧栏头像显示账户刷新和注销；配额内容由可选机构扩展提供。菜单通过 portal 支持收窄侧栏；支持方向键、Home/End、Escape、外部点击/失焦关闭。注销清理该机构本地身份、Token、模型元数据缓存，序列化保险库写操作并拒绝旧请求写回；个人 Key 不受影响。

临时 HTTP 回调页读取本次 Profile 的 `brand.productName/organizationName/logoURL/mark/primaryColor`，按浏览器 Accept-Language 选择中英文。没有外部字体、脚本或原始错误回显，清楚提示返回应用。普通 Web 验证仍跳回本地应用；不会把Token 交给浏览器。

在与目标 DSH 完全一致的隔离依赖树运行 `npm run check`，不要从旧版本根依赖构建后标为新基线。可再运行 `npm run check:browser`：使用该 Runtime 的 `playwright-core` 和本机 Edge 无头浏览器（可用 `DSH_OIDC_BROWSER_CHANNEL` 指定 Chrome），直接加载编译客户端，验证菜单/多个组件共享状态/注销，并生成品牌回调截图。本检查不替代主进程保险库与真实操作系统浏览器联验。

## macOS 接手验收

OIDC npm 包是平台无关的 JavaScript，不捆绑 Electron、Wails、Keychain 或 Windows 凭据二进制；macOS 使用同一个精确版本和 integrity。插件内部没有平台分支，外壳差异由上述 Host 接口承担。Windows 验证不能作为 macOS 已可用的结论。

接手者先运行 `npm ci`、`npm run check`，安装 Chrome 后可设置 `DSH_OIDC_BROWSER_CHANNEL=chrome` 运行 `npm run check:browser`。产品方还需在真实 macOS 客户端验证：

- `desktopServices.openExternal` 用系统默认浏览器打开授权页；`openConfiguration` 遵从系统文件关联，不能固定为某个编辑器。
- Credential Provider 在签名后的应用中通过系统保护机制保存、重启恢复、轮换和删除凭据。若产品使用 Electron `safeStorage`，其 Keychain 行为、密钥不可用和拒绝访问场景由产品主进程验收；本插件不会回退到明文文件。
- 临时 loopback 回调的动态端口、取消、超时和应用退出均正确清理；身份提供方的登记不能仅支持 Windows 测试时的单个端口。
- 在没有会话时登录，及在已有会话中登录，均更新共享头像状态、配置企业模型；重启不覆盖有效的个人模型选择。
- 真实 Apple Silicon 与目标 Intel 架构的宿主、外部浏览器和凭据机制分别验收。跨操作系统迁移历史数据时重新登录，不复制另一台机器加密的凭据文件作为凭据迁移。

应用签名、公证、DMG/ZIP、安装目录与数据目录布局由桌面发行仓库负责；本插件不增加 macOS 专用打包分支。

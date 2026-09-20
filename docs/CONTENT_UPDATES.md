# 配置与 Skills 独立更新

[English](CONTENT_UPDATES_EN.md) · [软件更新](UPDATES.md) · [机构装配](BUILD.md)

Electron 客户端可以从发行方配置的 HTTPS 源下载小型内容包，用于更新机构模型目录、功能开关、媒体配置和官方 Skills。修改这些内容不再需要下载整个客户端。公版默认不启用远程内容管理，管理员须显式配置来源、公钥及允许更新的组件。

## 用户在哪里更新

设置中的“自动更新”保留一个“检查更新”按钮，同时检查软件和内容。软件显示应用版本、下载安装进度；“配置与 Skills 更新”显示各组件修订号、内容下载进度和生效状态。没有配置内容源时，不显示该区域。

左下角仍为一个蓝色小按钮，点击打开同一更新面板。内容可以单独下载；同时发现软件和兼容的内容更新时，“下载更新”也会开始下载内容。下载后可继续工作，内容在下次启动时生效，也可点击“重启使内容生效”。请先完成正在运行的任务。

内容与软件共用公测／开发渠道选择。切换渠道不会回退已安装内容。内容不兼容时提示先更新软件，不尝试安装插件或运行时来满足依赖。

## 更新边界

| 内容 | 独立更新范围 |
| --- | --- |
| 配置 | `organizations`、`features`、`media` 三个区域；签名默认值与本地文件按字段合并，保留用户修改 |
| Skills | 完整的发行方 Skills 目录快照，包括指引、参考资料和依赖现有运行时的辅助脚本 |
| 程序、插件、npm 包、Python／Node／浏览器 | 继续通过软件整包更新；内容包禁止携带可执行二进制及运行时目录 |
| 用户内容 | 个人／工作区 Skills、用户模型、登录凭据、会话、桌面偏好均不覆盖 |

内容在启动时写入唯一生效的 `config/eduwork.jsonc`，不再在内存中覆盖文件内容；自动改写前保留唯一一份 `data/configuration/eduwork.previous.jsonc`。手工修改优先保留，冲突在更新面板显示。Logo 等相对路径仍从配置目录解析。详见[配置文件](CONFIGURATION.md)。配置不得修改更新源、公钥、桌面偏好或产品身份。机构发行可以管理配置；普通公版用户可只授权 Skills 更新。直接修改过随包 Skills 的安装会停止应用在线 Skills，并提示将修改保存为个人 Skill。

配置与 Skills 分别维护修订号。最新内容包始终包含该源管理的完整快照；未变组件保留原内容与修订号，客户端只切换修订号更高的部分。相互依赖的改动在同一个包中提升修订号并原子启用。这样即使离线错过中间几次更新，也能一次补齐。

## 发行配置

在基础 `config/eduwork.jsonc` 中增加下列对象。公钥替换为发行方自己的 Ed25519 SPKI PEM 公钥；示例占位符不能直接用于部署。

```json
"contentUpdates": {
  "publisher": "example",
  "baseURL": "https://downloads.example.org/eduwork/content",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n<Ed25519 公钥>\n-----END PUBLIC KEY-----\n",
  "configuration": true,
  "skills": true,
  "bundled": { "configuration": 1, "skills": 0 }
}
```

`configuration` 与 `skills` 省略时均为 `false`。`bundled` 表示当前软件包内置内容的修订号，省略或 `0` 表示未编订修订号。以后整包更新携带了新内容，必须同步提高相应的内置修订号，防止旧缓存盖过新配置。版本已经发布后，不得原地改变内容或复用修订号。

私钥保存在发行机器的私有目录中，不进入 Git、CI 原包、客户端或上传目录。客户端仅携带公钥。更换更新源或公钥须通过基础配置／软件发行完成，远程内容不能更换自己的信任依据。机构发行可以[首次启动下载签名配置](PUBLISHER_BOOTSTRAP.md)，直接分发 CI 原包；静态配置部署仍可由管理员本地装配。

可用 OpenSSL 生成密钥：`openssl genpkey -algorithm ED25519 -out content-signing.pem`，再执行 `openssl pkey -in content-signing.pem -pubout -out content-public.pem` 导出公钥。操作目录应在仓库外，私钥仅授权发行账户读取。

## Skills 依赖与发行计划

软件版本和内容修订号独立：软件采用 SemVer，内容使用正整数 `revision`。一个发布者的所有渠道共用递增序列；发生变化的组件也必须递增修订号，未变组件仍放入完整快照并保留原修订号。配置与 Skills 的修订号分别显示。

每个 Skill 在发行计划的 `entries` 中声明依赖，必须存在同名目录下的 `SKILL.md`。`requires.minClient` 与 `requires.capabilities` 必填；`maxClientExclusive` 可限制最高客户端版本，`dsh` 可指定精确 DSH 版本。整个包的依赖必须覆盖全部 Skills；每个 Skill 的客户端上限若填写，应与包的上限一致。

含平台相关脚本时，使用 `platforms` 限定 `win32`、`darwin` 或 `linux`；省略代表全平台，发布方需自行验证。当前桌面发行验收范围为 Windows，声明平台并不代表已完成其他平台的产品验收。

能力名称来自安装包 `resources/product/assembly.json`：`package:<包名>` 对应 `managedPackages`，`plugin:<包名>` 对应 `localPlugins`。它表示该能力已随程序安装，不能代替模型、账户等服务的可用性检查。不能借此声明或下载新的插件依赖；程序版本范围应覆盖所需的工具接口版本。

将以下内容保存为发行机器上的 `plan.json`，文件路径相对此计划文件解析。配置补丁为普通 JSON，只包含上表允许的区域。Skills 路径是完整官方 Skills 根目录，个人 Skills 不得放入其中。

```json
{
  "channel": "development",
  "revision": 2,
  "requires": {
    "minClient": "0.3.6-dev.20260916.1",
    "dsh": "0.1.5-rc.2",
    "capabilities": ["package:@eduwork/dsh-oidc"]
  },
  "configuration": { "revision": 2, "path": "configuration.json" },
  "skills": {
    "revision": 1,
    "path": "official-skills",
    "entries": [{
      "name": "example",
      "requires": {
        "minClient": "0.3.6-dev.20260916.1",
        "dsh": "0.1.5-rc.2",
        "capabilities": []
      }
    }]
  }
}
```

更新源只授权一类组件时，计划只包含该组件；管理两类时必须同时包含，未变部分保持原字节与修订号。配置补丁例子：`{"features":{"visionFallback":true}}`。辅助脚本使用现有运行时；不会执行安装钩子，不运行 npm 或 pip。

## 生成与发布

使用 Node 24，在源码根目录执行：

```powershell
node scripts/create-content-update.mjs --config /private/eduwork.jsonc --plan /private/plan.json --key /private/content-signing.pem --output /private/new-content-output
```

输出目录必须不存在。脚本只生成文件，不上传；会检查签名公私钥配对、配置结构、路径和依赖声明。生成目录：

```text
new-content-output/
  bundles/content-2-<sha256>.json
  development/latest.json
  receipt.json
```

先在隔离客户端验证下载、重启生效和失败回退，再上传不可变的 `bundles/` 文件，最后更新渠道的 `latest.json`。发布公测内容时，在 `stable` 与 `development` 分别签署对应渠道的清单，指向相同内容包，使开发渠道也收到公测内容。所有渠道的修订号须保持单调。

清单地址为 `<baseURL>/<stable|development>/latest.json`。内容包必须位于同一 HTTPS 来源及 `baseURL` 目录内，不接受重定向、登录 Cookie、查询凭据或临时下载令牌。服务端可配置 `latest.json` 为不缓存，哈希命名的内容包长期缓存。删除 `latest.json` 只停止新下载，不撤回已经应用的内容。

清单为 `schemaVersion: 1` 的签名信封，包含原始 JSON 字节的 base64url `payload` 与 Ed25519 `signature`。载荷绑定发布者、渠道、发行修订、依赖、组件修订及包的 URL／字节数／SHA-256。内容包为 JSON，每个 Skill 文件还记录相对路径、大小、SHA-256 及 base64 内容；总包上限 16 MiB。客户端先验签，再验包；包内禁止路径穿越、重复文件、符号链接、未声明的 Skill 入口和可执行二进制。

## 启动、回退与诊断

下载内容暂存在 `data/content-updates/`，不改动程序。下载失败可以重新检查后重试；内容包较小，重试重新下载。下次启动时先记录试运行标记，仅在桌面完成加载后提交新的生效状态。启动失败或试运行被中断，配置恢复唯一备份、Skills 恢复上一生效修订；更新期间的手工配置修改保留。失败的内容不会反复安装，修复后须发布更高修订号。

新软件包的内置修订号及客户端／DSH 兼容限制会参与启动选择。内容更新源不可用不会阻止正常启动。诊断 ZIP 记录软件与内容各自的状态、修订号和错误信息，不包含私钥、登录凭据或完整内容包。

首次支持此机制仍须先升级软件；旧 Go 过渡版继续使用既有整包升级路线。

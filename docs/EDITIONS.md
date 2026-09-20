# 公版、机构版与配置的边界

EduWork 提供通用产品，EduWork-ECNU 在同一份公版代码上增加华东师范大学服务。机构版不维护第二份 UI、Studio、桌面壳或更新器。

| 归属 | 内容 | 扩展方式 |
| --- | --- | --- |
| EduWork | 对话、Studio、文件生成与预览、技能中心、邮件、记忆、浏览器搜索、个人概览、蓝/红主题 | 公版代码与精确锁定的通用 npm 插件 |
| EduWork | OIDC 登录、网关 Token 授权、企业模型同步 | `config/eduwork.jsonc` 中的机构与模型配置 |
| EduWork | Electron、Go 过渡壳、更新下载与进度、托盘、历史导入、模型请求并发 | 两个壳共用 Host、产品配置与工作台插件 |
| EduWork-ECNU | 校内搜索、学校配额、活跃心跳、文本模型的校内视觉辅助 | `edition/plugins/`，由机构发行清单追加 |
| EduWork-ECNU | 学校默认模型及更新规则、专属技能、默认机构配置 | `edition/` 中的数据及技能；通用解释器仍属于公版 |
| EduWork | OpenAI 兼容图像生成与云端 TTS、尺寸后处理 | [media 配置](MEDIA.md)，学校只提供模型和音色等参数 |
| 用户配置 | 机构地址、公共 Client ID、模型目录、产品名与 Logo、更新地址 | 修改配置文件并完全退出后重启，无需构建 |

技能是可配置的操作指引；插件是可执行能力。校内搜索等技能依赖的学校插件不会因为复制一份技能文件就成为公版能力。对话与 Studio 使用同一套通用生成和预览服务，机构插件只提供服务适配。

新版客户端使用按机构隔离的登录 Token 授权模型请求，并通过共享 Host 刷新。不能把密码、Key 或登录令牌写进发行包。

## 用公版连接企业服务

在设置中打开 `config/eduwork.jsonc`，参考 `config/examples/organization.jsonc` 填写网关发现配置。服务器按 [服务端完整契约](../packages/dsh-oidc/docs/server-integration-contract.md)实现接口。新版客户端支持 LiteLLM 与实验性 oidc-llm；服务端可继续为旧客户端保留 Key Binding 接口。网关配置不会自动启用学校配额和心跳。

发行包中的配置示例保留注释。机构地址或模型 ID 必须采用服务端实际登记值。完成登录后，可继续使用个人模型；不要求所有用户使用某个学校的模型。

## 维护与装配

- 通用修复先进入 EduWork。EduWork-ECNU 的 `core.lock.json` 锁定同一份公版提交，不复制修改后的核心文件。
- 学校专属改动进入 `edition/plugins/`、`edition/skills/` 或 `edition/desktop/`。`edition/distribution.json` 通过 `coreBase` 继承公版，再追加这些能力。
- `third_party/` 固定 DSH 和独立 npm 插件版本。更新 DSH 时一起提交对应锁文件、协议快照和桌面适配输入；仅修改构建脚本中的版本是不完整的。
- 独立构建公版是边界检查的一部分：它不能依赖相邻的机构仓库、本机私有配置或校内网络。
- 少量内部包名仍保留历史前缀；能力归属以发行清单和实际依赖为准。兼容读取旧凭据名、旧数据格式不代表公版新增学校服务依赖。

构建步骤见 [BUILD](BUILD.md)，发行与升级规则见 [RELEASE](RELEASE.md)。

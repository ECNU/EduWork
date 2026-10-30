# SystemOne 决策插件

**简体中文** | [English](README_EN.md)

`@eduwork/dsh-decision` 为 DSH 增加 `decision_evaluate` 工具与配套 `decision` 技能：按标签分类、判断条件成立概率、按有序量表评分。可用于工单分流、材料核对或文本评估，模型判断不自动触发业务操作。

插件使用 DSH 原生工具、技能与配置机制，无 runtime 补丁，无桌面桥接依赖。服务地址、模型及认证均由用户或发行版提供，包内没有默认机构或公共推理地址。

## 安装和使用

当前源码准备的版本为 0.1.0，尚待首次 npm 发布。发布后可在 DSH 插件管理中安装 `@eduwork/dsh-decision`；原生 bundle 使用固定 ID `decision`，默认 `enabled: false`。在插件配置中填写服务参数后启用，工具和技能随插件一起注册/卸载。首次配置好后，可提问：“用决策模型按计费、技术、信息不足这几个标签判断下面这条请求”。

API Key 配置示例（在凭据服务中保存真实 Key，不把 Key 填进此配置）：

```json
{
  "enabled": true,
  "baseURL": "https://decision.example.org/v1",
  "model": "your-decision-model",
  "authMode": "api-key",
  "credentialRef": "SYSTEMONE_API_KEY",
  "requestTimeoutMs": 60000,
  "maxQuestions": 32,
  "maxRequestBytes": 65536,
  "imageInput": "none"
}
```

`baseURL` 包含 API 前缀，插件只追加 `/systemone`。支持 HTTPS，本机 loopback 测试允许 HTTP。工具参数不能改写服务地址或模型。

机构登录选择 `authMode: "oidc"`，填写 `oidcProfileId`，并安装兼容的 `@eduwork/dsh-oidc`（Host 需提供 `modelAuthorization`、`authorizedFetch`）。基地址须匹配机构授权的模型资源。登录续期沿用该插件，失败不退回个人 Key。明确免鉴权的服务才选择 `authMode: "none"`，此模式不读取凭据。

默认关闭；启用后没有启动探测或后台轮询，只有工具调用才请求服务。退出账号、替换凭据或停用插件会使对应在途请求失效。不跟随重定向、不自动重试 POST、不回退其他模型。超时不代表服务器已停止推理。

## 协议范围

支持 [TypeSafe System One](https://docs.typesafe.ai/api/system-one) 的基础 `model/state/questions` 和 `choice/noul/score` 结果，保留响应扩展字段，不声称完整实现全部实验接口。

- `state` 可为文字、JSON 对象或数组；题目描述和 criteria 可包含结构化 JSON，具体服务可能要求非空字符串等更严格格式。
- `noul` 原样保留 0–1 概率；`score` 保留零起点的小数分值；`choice: null` 保留为拒选。不同服务的 `confidence` 定义不同，插件不统一改写成正确率。
- 首版不支持 TypeSafe 的 `assets/box` 或 StartLux 思考控制等扩展。服务明确支持 `images` Data URI 数组时，将 `imageInput` 设为 `data-uri`；该选项才会向模型开放 `images` 参数。
- 客户端默认最多 32 问、完整请求 64 KiB、响应 512 KiB。前两者可按服务配置，分别不超过 512 问与 16 MiB。Data URI 模式最多 8 张 PNG/JPEG/WebP；图片请求应提高完整请求上限。这些是客户端保护上限，不是服务端能力保证。
- 默认超时 60 秒，可配置 1–195000 毫秒。错误只报告状态和排查方向，不把任意错误响应或凭据交给模型。

## 开发与装配

源码在 `src/`，构建仅复制 ESM 模块，无第三方内嵌依赖。Node >=24.22.1，实际验证基线为 DSH 0.2.1-rc.3。将 `EDUWORK_DECISION_RUNTIME` 指向锁定 Runtime（含 package.json/node_modules 的目录），运行 `npm ci`、`npm run check`；测试使用合成材料与本地 HTTP。

仓库统一入口为 `node scripts/packages/manage.mjs check dsh-decision` 和 `pack dsh-decision`，详见[包维护指南](../../docs/PACKAGES.md)。正式产品需先发布并核验 npm 原包，再更新精确锁；本次未把未发布源码混入现有桌面装配。

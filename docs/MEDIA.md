# 配置图像生成与云端语音

公版内置一个通用 OpenAI 兼容媒体适配器。服务商、学校或企业只提供配置，不需要修改 EduWork 代码、安装学校媒体插件或重新构建。对话与 Studio 共用 `image_providers` / `image_generate`、`speech_voices` / `speech_synthesize`，也共用文件预览、字幕与下载机制。

公版默认不配置云端服务。不配置图像服务时不启用生图工具；图像技能只有在提供方可用时才启用。云端 TTS 可选，本地系统 TTS 不受影响。不提供免费云端额度，也不会从聊天模型名称猜测生图或 TTS 模型。

## 使用步骤

1. 在设置中打开安装目录的 `config/eduwork.jsonc`，将 [带注释的媒体示例](../config/desktop/examples/media.jsonc) 中的 `media` 段合并进去。
2. 填服务商的 API 基地址、实际模型 ID、支持的图片原生尺寸、音色目录。`images.enabled` 和 `speech.enabled` 可独立开关。
3. `credentialRef` 填已保存的凭据引用名称。企业登录默认使用 `EDUWORK_API_KEY`，同时必须填写 `oidcProfileId`，对应 `organizations[].id`。个人凭据在模型设置中保存，并使用该凭据的实际引用名称；配置文件不接受明文 Key。
4. 从托盘选择退出，再启动。企业用户完成登录和凭据配置后查询可用提供方；对话或 Studio 即可使用。

示例中的 `id` 是媒体提供方的稳定 ID，模型、企业配置和资源服务 Provider 各有自己的 ID，不要求它们相同。有多个提供方时在生成请求中明确选择，失败时不悄悄改用另一家服务。

企业模式通过 OIDC 服务核对账户、凭据引用和 API 地址的绑定；不会因为公共 Key 槽里存在值，就拿其他企业的 Key 发起请求。默认配置以启动时文件为准；登录、注销或凭据变化会刷新可用状态。

## 个人 Key 的具体配置

模型设置中保存的凭据按提供方 ID 命名，而不是按显示名称命名。例如在“设置 → 模型”添加自定义提供方，ID 为 `my-media`，在 API Key 输入框保存 Key 后，其默认引用为 `MY_MEDIA_API_KEY`：ID 转为大写，非字母数字替换为下划线，再加 `_API_KEY`。媒体配置填写这个引用，不复制 Key；个人模式省略 `oidcProfileId`。已有提供方若手动配置过 `apiKeyEnv`，以其实际值为准，可在该数据目录的 `dsh/settings.yaml` 中查看对应提供方配置。

仅使用媒体服务、不需要添加聊天提供方时，也可在操作系统的用户环境变量界面新建 `MY_MEDIA_API_KEY`，值填写媒体服务 Key。退出客户端与启动它的旧终端后重新启动，使新进程继承环境变量；同名环境变量会优先于已保存凭据。环境变量不是加密的秘密保管库，仅适合个人受控机器；不要把它写入共享脚本或交付包。

例如将媒体示例中的提供方改为：

```json
{
  "id": "personal-media",
  "title": "个人媒体服务",
  "protocol": "openai-compatible",
  "baseURL": "https://api.example.edu/v1",
  "credentialRef": "MY_MEDIA_API_KEY"
}
```

这只是凭据与地址部分；仍需保留并填写示例中的 `images` 或 `speech` 段。重启后可在对话要求“列出可用的图像和语音提供方”，检查是否显示所配置服务。未显示时先核对引用名称、Key 是否已保存、接口地址与 `enabled` 开关。


## 服务端要求

这是媒体适配配置，不扩展 OIDC 身份协议。地址必须是 HTTPS；本机 `localhost` / `127.0.0.1` / `[::1]` 的服务可以使用 HTTP。基地址不能含用户名、密码、查询串或片段。

| 能力 | 接口 | 请求 | 支持的响应 |
| --- | --- | --- | --- |
| 文生图 | `POST {baseURL}/images/generations` | `model`、`prompt`、`size`；按配置可发送 `response_format` | `data[0].b64_json` 或 `data[0].url`，图片为 PNG/JPEG/WebP/GIF |
| TTS | `POST {baseURL}/audio/speech` | `model`、`input`、`voice`、`speed`、`response_format: "wav"` | WAV 二进制，Content-Type 为 audio/wav、audio/wave 或 audio/x-wav |

两个请求均通过 `Authorization: Bearer <由本机凭据服务取得的 Key>` 认证，不发送学校专用头。配置不支持任意请求代码或附加脚本。兼容端点仍可能有各自限制，模型名、尺寸和音色应以服务商为准。

图片响应示例：

```json
{"data":[{"b64_json":"<base64 编码的图片>"}]}
```

图片接口支持 `responseFormat: "auto"`（省略请求字段）、`"b64_json"` 或 `"url"`。URL 结果只从 HTTPS 下载，不附带模型 Key，不跟随重定向；日志不回显带签名的 URL。接口错误不回显可能含凭据的服务端响应正文。

`nativeSizes` 是服务允许生成的尺寸集合。用户要求其他比例时，按比例和像素大小选择合适的原生尺寸，再用随客户端提供的 Python/Pillow 进行 `crop`（裁剪）或 `pad`（补边）。若本地处理失败，保留已生成的原图，明确报告实际尺寸及处理失败，不再次消耗生成请求。自定义尺寸范围为每边 64–4096 像素。

TTS 使用配置中的音色，保留音色 ID 大小写；文本上限可通过 `inputMaxChars` 调整，语速范围 0.25–4。共享音频管线以真实 WAV 时长制作字幕和视频，不用供应商的时长估算。仅提供 MP3 的服务需要先补充 WAV 支持。

## 发行与兼容

适配器源代码和唯一图像/语音技能入口归 EduWork。机构发行只增加 `media` 默认配置与自己的音色目录。旧 ECNU 配置没有 `media` 时，读取机构资源中的兼容默认值；用户显式设置 `media.providers: []` 则关闭云端媒体，升级不会覆盖它。

如删除企业配置，依赖该企业的发行默认媒体也不再启用。用户显式填写了不存在的 `oidcProfileId` 会收到配置错误提示，不会猜测其他企业。校内搜索、配额、心跳和校内视觉辅助仍在 ECNU 扩展中。

本机 Web 验证入口也使用同一配置：私有启动 JSON 增加 `"userConfig": "<eduwork.jsonc 的绝对路径>"`。完整命令见 [构建指南](BUILD.md)。纯 Web 源码装配不自动安装媒体原生资源，图片后处理须配置受管 Python；桌面完整装配已提供。

## 本地验证

运行 `node --test dsh-plugins/media-openai/test/media.test.js dsh-plugins/media-openai/test/image-output.test.js` 检查配置、凭据绑定、工具权限入口、尺寸和原图保留。

额外指定 `EDUWORK_TEST_RUNTIME`（锁定 npm Runtime 目录）和 `DSH_OFFICE_PYTHON`（受管 Python 路径），运行 `node --test dsh-plugins/media-openai/test/shared.integration.test.js`，可验证真实共享服务、合成 HTTP 服务、WAV 文件和 Python 图片后处理；`image_resize_test.py` 检查裁剪与补边像素。这些测试不读取用户会话或真实 Key，不代表已完成某个供应商的端到端验收。

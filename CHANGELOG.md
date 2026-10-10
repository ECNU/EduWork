# 变更记录

## 未发布

### 桌面 Profile 路径变更

原生 DSH Profile 从 `DSH_HOME/profiles/desktop-017` 改为 `DSH_HOME/profiles/desktop`。这是破坏性路径更新：客户端不再读取旧路径，不自动迁移或删除旧 Profile；用户偏好、已安装插件和启停状态需按需迁移。`eduwork.jsonc`、会话、附件和浏览器数据的位置不变。

macOS 默认新路径为 `~/Library/Application Support/eduwork-electron/dsh/profiles/desktop/`；Windows 位于安装目录下的 `data/<发行版>-electron/dsh/profiles/desktop/`。不同发行版及测试数据目录以实际 `DSH_HOME` 为准。

需要保留旧配置时，可让 AI 协助处理，并提供以下要求：

> 完全退出 EduWork 和使用同一 DSH_HOME 的 CLI，先备份 profiles 目录。检查 desktop-017 是否为旧原生 Profile，检查 desktop 是否已存在。若 desktop 来自旧 Runtime，先将其备份移走，不复用指向 App 的 node_modules 链接。将需要保留的旧原生 Profile 迁移到 desktop；若目标已有有效配置，不覆盖，先比较差异再迁移。检查插件依赖、启停状态及引用旧路径的绝对路径或符号链接。启动后确认偏好和自定义插件可用，保留备份直到验证完成。

无需保留旧原生配置时，可直接使用新 Profile；若旧 Runtime 的同名目录阻止启动，仍需先备份并移走该目录。重装 App 不保证清除上述用户配置。
